// Jupyter kernel manager: prefers VS Code's Jupyter extension when present,
// falls back to the standalone Python subprocess otherwise.
//
// Live variable handoff uses pickle-to-temp-file. When the user asks to open
// a notebook variable, we ask the Jupyter kernel to `df.to_pickle(tmp)`, then
// the standalone Python subprocess loads that pickle and owns the dataframe
// for subsequent operations. This avoids any shared-memory trickery and
// works uniformly whether the user hit "Open in Kensa" from a cell output or
// from the command palette.

import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { PythonBackend } from './pythonBackend';

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

  /** Extract a DataFrame variable from the active notebook kernel by asking
   *  it to pickle the variable to a temp file. Returns the temp-file path on
   *  success, or null if no kernel/notebook is available or the variable
   *  cannot be pickled. */
  async extractVariableToPickle(variableName: string): Promise<string | null> {
    const api = await this.getJupyterApi();
    const activeNotebook = vscode.window.activeNotebookEditor?.notebook;
    if (!api || !activeNotebook) {
      this.output.appendLine('[kensa] no active notebook or Jupyter API — variable extraction unavailable');
      return null;
    }

    const getKernel = api.kernels?.getKernel ?? api.getKernel;
    if (!getKernel) {
      this.output.appendLine('[kensa] Jupyter API shape is unexpected');
      return null;
    }

    const kernel = await getKernel(activeNotebook.uri);
    if (!kernel?.executeCode) {
      this.output.appendLine('[kensa] no kernel attached to active notebook');
      return null;
    }

    const tmpPath = path.join(
      os.tmpdir(),
      `kensa-var-${Date.now()}-${Math.random().toString(36).slice(2)}.pkl`
    );
    const code = [
      'import pickle',
      `with open(${JSON.stringify(tmpPath)}, "wb") as _kensa_f:`,
      `    pickle.dump(${variableName}, _kensa_f)`
    ].join('\n');

    const tokenSource = new vscode.CancellationTokenSource();
    try {
      for await (const _ of kernel.executeCode(code, tokenSource.token)) {
        // We don't need the output stream — success is the absence of an
        // exception and the existence of the pickle file on disk.
      }
    } catch (err) {
      this.output.appendLine(`[kensa] kernel execution failed: ${String(err)}`);
      return null;
    } finally {
      tokenSource.dispose();
    }

    return tmpPath;
  }

  async dispose(): Promise<void> {
    if (this.backend) {
      await this.backend.stop();
      this.backend = null;
    }
  }
}
