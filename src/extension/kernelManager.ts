// Jupyter kernel manager: prefers VS Code's Jupyter extension when present,
// falls back to the standalone Python subprocess otherwise.
//
// Live variable handoff uses pickle-to-temp-file. When the user asks to open
// a notebook variable, we ask the Jupyter kernel to `df.to_pickle(tmp)`, then
// the standalone Python subprocess loads that pickle and owns the dataframe
// for subsequent operations. This avoids any shared-memory trickery and
// works uniformly whether the user hit "Open in Kensa" from a cell output or
// from the command palette.

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { PythonBackend } from './pythonBackend';
import { pickWorkingNotebook } from './notebookResolver';

/** Minimal shape of the subset of `ms-toolsai.jupyter`'s exported API we rely
 *  on. The full surface is large and unstable; we keep our dependency surface
 *  small so a schema change doesn't break activation. */
export interface JupyterApi {
  getKernel?: (uri: vscode.Uri) => Promise<JupyterKernel | undefined>;
  kernels?: {
    getKernel: (uri: vscode.Uri) => Promise<JupyterKernel | undefined>;
  };
}

export interface JupyterKernel {
  executeCode?: (code: string, token: vscode.CancellationToken) => AsyncIterable<unknown>;
}

export class KernelManager {
  private backend: PythonBackend | null = null;

  constructor(
    private readonly extensionRoot: string,
    private readonly output: vscode.OutputChannel
  ) {}

  async ensureBackend(): Promise<PythonBackend> {
    if (this.backend) return this.backend;
    const configured = vscode.workspace.getConfiguration('kensa').get<string>('pythonPath', '');

    try {
      this.backend = await PythonBackend.create(this.extensionRoot, this.output, configured);
      return this.backend;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Unable to start Python backend: ${message}`);
    }
  }

  async getJupyterApi(): Promise<JupyterApi | null> {
    const ext = vscode.extensions.getExtension('ms-toolsai.jupyter');
    if (!ext) return null;
    if (!ext.isActive) {
      try {
        await ext.activate();
      } catch {
        return null;
      }
    }
    return ext.exports as JupyterApi;
  }

  /** Resolve a notebook hint to a concrete open `NotebookDocument`, logging
   *  the full decision to the output channel. Callers should use this at
   *  the start of a flow to get a stable notebook reference, then pass
   *  `notebook.uri` to every subsequent `extractVariableToPickle` /
   *  `listDataFrameVariables` call — that way the downstream resolver
   *  strict-matches against a URI that came from `notebookDocuments`
   *  directly, removing any drift between calls.
   *
   *  This fixes the "variable not defined in the kernel" symptom that
   *  hit when the list call resolved to notebook B but the extract call
   *  re-resolved to notebook A because VS Code state had shifted
   *  (focus moved, visible editors changed, etc.) between the two calls. */
  resolveNotebookDocument(hint?: vscode.Uri): vscode.NotebookDocument | null {
    const docs = vscode.workspace.notebookDocuments;
    const active = vscode.window.activeNotebookEditor;
    const visible = vscode.window.visibleNotebookEditors;
    this.output.appendLine(
      `[kensa:resolve] hint=${hint?.toString() ?? '<none>'}`
    );
    this.output.appendLine(
      `[kensa:resolve] docs=[${docs.map((d) => d.uri.toString()).join(', ') || '<empty>'}]`
    );
    this.output.appendLine(
      `[kensa:resolve] active=${active?.notebook.uri.toString() ?? '<none>'}`
    );
    this.output.appendLine(
      `[kensa:resolve] visible=[${visible.map((e) => e.notebook.uri.toString()).join(', ') || '<empty>'}]`
    );
    const picked = pickWorkingNotebook(hint, docs, active, visible);
    this.output.appendLine(
      `[kensa:resolve] picked=${picked?.uri.toString() ?? '<null>'}`
    );
    return picked;
  }

  /** Legacy private wrapper — kept because `extractVariableToPickle` and
   *  `listDataFrameVariables` still call it internally. New call sites
   *  should prefer `resolveNotebookDocument` and pass the resolved
   *  `notebook.uri` as the hint so subsequent lookups strict-match. */
  private findWorkingNotebook(hint?: vscode.Uri): vscode.NotebookDocument | null {
    return pickWorkingNotebook(
      hint,
      vscode.workspace.notebookDocuments,
      vscode.window.activeNotebookEditor,
      vscode.window.visibleNotebookEditors
    );
  }

  /** Extract a variable from a live Jupyter kernel by asking it to pickle
   *  the value to a temp file. Throws a specific Error describing exactly
   *  why the operation failed so the UI can show a useful message.
   *  `notebookHint`, when provided, pins the lookup to that exact notebook
   *  (used when the command is invoked from a notebook toolbar button). */
  async extractVariableToPickle(variableName: string, notebookHint?: vscode.Uri): Promise<string> {
    // `variableName` flows here from user-triggered paths (command palette
    // input, notebook-renderer postMessage). We must not substitute it into
    // Python source as code — an attacker-controlled name like
    // `__import__('os').system('rm -rf /')` would run in the kernel.
    //
    // Fix: up-front allowlist validation + no `eval()`. We split on `.`,
    // validate each segment as a plain Python identifier, then walk the
    // attribute chain with explicit `globals()`/`locals()` lookups and
    // `getattr` in the kernel code. The validated parts are still embedded
    // as *data* via `JSON.stringify` (a JSON string array becomes a Python
    // list literal), so the Python we run no longer constructs any code
    // from user input and CodeQL's `js/build-code-injection` rule has
    // nothing to flag.
    const parts = variableName.split('.');
    const identPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
    if (parts.length === 0 || !parts.every((p) => identPattern.test(p))) {
      throw new Error(
        `'${variableName}' is not a valid Python variable name. Use a plain identifier or dotted attribute path like 'df' or 'obj.df'.`
      );
    }

    const api = await this.getJupyterApi();
    if (!api) {
      throw new Error(
        'The Jupyter extension (ms-toolsai.jupyter) is not installed or could not be activated. Install it from the marketplace, reload the window, and try again.'
      );
    }

    this.output.appendLine(
      `[kensa:extract] variableName='${variableName}' hint=${notebookHint?.toString() ?? '<none>'}`
    );
    const notebook = this.findWorkingNotebook(notebookHint);
    if (!notebook) {
      throw new Error(
        'No Jupyter notebook is open. Open an .ipynb notebook, execute at least one cell that defines your DataFrame, then retry.'
      );
    }
    this.output.appendLine(
      `[kensa:extract] resolved notebook=${notebook.uri.toString()}`
    );

    const getKernel = api.kernels?.getKernel ?? api.getKernel;
    if (!getKernel) {
      throw new Error(
        'The installed Jupyter extension does not expose a kernel API that Kensa can use. Please update ms-toolsai.jupyter.'
      );
    }

    const kernel = await getKernel(notebook.uri);
    if (!kernel?.executeCode) {
      throw new Error(
        `No kernel is attached to '${path.basename(notebook.uri.fsPath)}'. Select a Python kernel and run any cell to start it, then retry.`
      );
    }

    // First validate that the variable exists and is a DataFrame-ish object.
    // We ask the kernel to write a JSON status file so we can read a typed
    // error back, rather than relying on stream parsing.
    const statusPath = path.join(
      os.tmpdir(),
      `kensa-status-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    );
    const picklePath = path.join(
      os.tmpdir(),
      `kensa-var-${Date.now()}-${Math.random().toString(36).slice(2)}.pkl`
    );

    // `parts` is embedded as a JSON literal, which is also a valid Python
    // list-of-strings literal — so the kernel sees a data value, not code
    // compiled from a template. The lookup walks globals/locals for the
    // first segment and `getattr` for each remaining segment.
    const partsLiteral = JSON.stringify(parts);
    const code = [
      'import json as _kensa_json',
      'import pickle as _kensa_pickle',
      '_kensa_status = {"ok": False, "reason": None}',
      `_kensa_parts = ${partsLiteral}`,
      'try:',
      '    _kensa_head = _kensa_parts[0]',
      '    if _kensa_head in locals():',
      '        _kensa_v = locals()[_kensa_head]',
      '    elif _kensa_head in globals():',
      '        _kensa_v = globals()[_kensa_head]',
      '    else:',
      '        raise NameError(_kensa_head)',
      '    for _kensa_p in _kensa_parts[1:]:',
      '        _kensa_v = getattr(_kensa_v, _kensa_p)',
      '    _kensa_t = type(_kensa_v)',
      '    _kensa_mod = getattr(_kensa_t, "__module__", "") or ""',
      '    _kensa_name = getattr(_kensa_t, "__name__", "") or ""',
      '    if _kensa_name != "DataFrame" or not (_kensa_mod.startswith("pandas") or _kensa_mod.startswith("polars")):',
      '        _kensa_status["reason"] = f"variable is a {_kensa_mod}.{_kensa_name}, not a pandas/polars DataFrame"',
      '    else:',
      `        with open(${JSON.stringify(picklePath)}, "wb") as _kensa_f:`,
      '            _kensa_pickle.dump(_kensa_v, _kensa_f)',
      '        _kensa_status["ok"] = True',
      'except NameError as _kensa_e:',
      '    _kensa_status["reason"] = f"variable not defined in the kernel: {_kensa_e}"',
      'except Exception as _kensa_e:',
      '    _kensa_status["reason"] = f"{type(_kensa_e).__name__}: {_kensa_e}"',
      `with open(${JSON.stringify(statusPath)}, "w") as _kensa_sf:`,
      '    _kensa_json.dump(_kensa_status, _kensa_sf)'
    ].join('\n');

    this.output.appendLine(
      `[kensa] asking kernel to extract '${variableName}' from ${notebook.uri.fsPath}`
    );

    const tokenSource = new vscode.CancellationTokenSource();
    try {
      for await (const _evt of kernel.executeCode(code, tokenSource.token)) {
        void _evt;
      }
    } catch (err) {
      this.output.appendLine(`[kensa] kernel execution threw: ${String(err)}`);
      throw new Error(`Kernel execution failed: ${String(err)}`);
    } finally {
      tokenSource.dispose();
    }

    // Read the status file. If it doesn't exist, the kernel probably failed
    // before our try/except could run (rare, but shows up when the kernel
    // crashes mid-execution).
    let status: { ok: boolean; reason: string | null };
    try {
      const raw = await fs.readFile(statusPath, 'utf-8');
      status = JSON.parse(raw);
      await fs.unlink(statusPath).catch(() => undefined);
    } catch (err) {
      throw new Error(
        `Kernel did not produce a status file — it may have failed silently. ${String(err)}`
      );
    }

    if (!status.ok) {
      throw new Error(status.reason ?? 'unknown kernel error');
    }

    // Sanity-check that the pickle file exists and is non-empty before we
    // hand it off to the Python subprocess.
    try {
      const st = await fs.stat(picklePath);
      if (st.size === 0) {
        throw new Error('pickle file is empty');
      }
    } catch (err) {
      throw new Error(`Pickle file was not created: ${String(err)}`);
    }

    return picklePath;
  }

  /** Enumerate DataFrame-like variables in the active notebook's kernel.
   *  Works by asking the kernel to JSON-dump the names of all globals whose
   *  class is DataFrame (pandas or polars) into a temp file, which we then
   *  read from the extension host. Returns [] if no kernel / notebook is
   *  attached or the kernel doesn't have pandas. */
  async listDataFrameVariables(notebookHint?: vscode.Uri): Promise<string[]> {
    this.output.appendLine(
      `[kensa:list] hint=${notebookHint?.toString() ?? '<none>'}`
    );
    const api = await this.getJupyterApi();
    if (!api) {
      this.output.appendLine('[kensa:list] Jupyter API unavailable — cannot list variables');
      return [];
    }
    const notebook = this.findWorkingNotebook(notebookHint);
    if (!notebook) {
      this.output.appendLine('[kensa:list] no open notebook — cannot list variables');
      return [];
    }
    this.output.appendLine(
      `[kensa:list] resolved notebook=${notebook.uri.toString()}`
    );

    const getKernel = api.kernels?.getKernel ?? api.getKernel;
    if (!getKernel) return [];

    const kernel = await getKernel(notebook.uri);
    if (!kernel?.executeCode) {
      this.output.appendLine('[kensa] no kernel attached to notebook');
      return [];
    }

    const tmpPath = path.join(
      os.tmpdir(),
      `kensa-vars-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    );
    // Detect both pandas and polars DataFrame types without importing either
    // (users may not have polars). We inspect the class's full qualname so
    // import-free: `type(v).__module__.startswith("pandas")` etc.
    const code = [
      'import json as _kensa_json',
      'def _kensa_is_df(v):',
      '    t = type(v)',
      '    mod = getattr(t, "__module__", "") or ""',
      '    name = getattr(t, "__name__", "") or ""',
      '    if name != "DataFrame":',
      '        return False',
      '    return mod.startswith("pandas") or mod.startswith("polars")',
      '_kensa_names = sorted([k for k, v in list(globals().items())',
      '                       if not k.startswith("_") and _kensa_is_df(v)])',
      `with open(${JSON.stringify(tmpPath)}, "w") as _kensa_f:`,
      '    _kensa_json.dump(_kensa_names, _kensa_f)'
    ].join('\n');

    const tokenSource = new vscode.CancellationTokenSource();
    try {
      for await (const _ of kernel.executeCode(code, tokenSource.token)) {
        void _;
      }
    } catch (err) {
      this.output.appendLine(`[kensa] variable listing failed: ${String(err)}`);
      return [];
    } finally {
      tokenSource.dispose();
    }

    try {
      const raw = await fs.readFile(tmpPath, 'utf-8');
      await fs.unlink(tmpPath).catch(() => undefined);
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
      return [];
    } catch (err) {
      this.output.appendLine(`[kensa] could not read variable list: ${String(err)}`);
      return [];
    }
  }

  async dispose(): Promise<void> {
    if (this.backend) {
      await this.backend.stop();
      this.backend = null;
    }
  }
}
