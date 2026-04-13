// Python subprocess backend — used for Editing mode and as a fallback when
// the Rust native module is unavailable. Communicates via newline-delimited
// JSON over stdin/stdout. The child process loads kensa_helpers.py which
// exposes a command loop.

import { ChildProcess, spawn } from 'node:child_process';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type {
  ColumnStats,
  DataSlice,
  DatasetInfo,
  DiffSummary,
  OperationStep,
  QuickInsight
} from '../shared/types';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

type BackendCommand =
  | { cmd: 'load_file'; path: string; kind: string; options?: Record<string, unknown> }
  | { cmd: 'load_pickle'; path: string }
  | { cmd: 'get_slice'; start: number; end: number }
  | { cmd: 'get_stats'; columnIndex: number }
  | { cmd: 'get_all_insights' }
  | { cmd: 'apply_code'; code: string; step_id: string }
  | { cmd: 'preview_code'; code: string }
  | { cmd: 'undo'; step_id: string }
  | { cmd: 'export_csv'; path: string }
  | { cmd: 'export_parquet'; path: string }
  | {
      cmd: 'diff';
      prev: Array<Array<string | null>>;
      new: Array<Array<string | null>>;
    }
  | { cmd: 'set_view_filters'; filters: Array<{ column: string; op: string; value?: string }> }
  | { cmd: 'set_view_sort'; sort: { column: string; ascending: boolean } | null };

export class PythonBackend {
  private proc: ChildProcess | null = null;
  private nextRequestId = 1;
  private pending = new Map<number, PendingRequest>();
  private buffer = '';
  private starting: Promise<void> | null = null;
  private steps: OperationStep[] = [];
  private resolveReady: (() => void) | null = null;

  constructor(
    private readonly pythonPath: string,
    private readonly extensionRoot: string,
    private readonly output: vscode.OutputChannel
  ) {}

  static async create(
    extensionRoot: string,
    output: vscode.OutputChannel,
    configuredPythonPath = ''
  ): Promise<PythonBackend> {
    const pythonPath = configuredPythonPath || detectPython();
    const backend = new PythonBackend(pythonPath, extensionRoot, output);
    await backend.start();
    return backend;
  }

  async start(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      const script = path.join(this.extensionRoot, 'src', 'python', 'kensa_helpers.py');
      this.output.appendLine(`[kensa] starting python: ${this.pythonPath} ${script}`);

      // Accumulate stderr — we replay it in the rejection message so the
      // user sees Python's actual error (missing module, syntax error, etc.)
      // instead of a generic "python exited" message.
      let stderrBuf = '';
      let settled = false;
      const settle = (err: Error | null) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
        this.resolveReady = null;
      };

      // Hard timeout — if Python never emits the ready line within 15s,
      // something went wrong (most often: pandas import hung or the script
      // path is wrong). Better to fail fast than hang the UI.
      const timeout = setTimeout(() => {
        this.output.appendLine('[kensa] python start timed out after 15s');
        try { this.proc?.kill(); } catch { /* ignore */ }
        settle(new Error(
          'Python subprocess did not report ready within 15 seconds. ' +
            (stderrBuf.trim() ? `stderr: ${stderrBuf.trim().split('\n').slice(-5).join(' | ')}` : 'No stderr output.')
        ));
      }, 15000);

      let proc: ChildProcess;
      try {
        proc = spawn(this.pythonPath, ['-u', script], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
        });
      } catch (err) {
        clearTimeout(timeout);
        const message = err instanceof Error ? err.message : String(err);
        settle(new Error(`Failed to spawn '${this.pythonPath}': ${message}`));
        return;
      }
      this.proc = proc;

      // Wrap the caller's resolve so we can also clear the timeout and flip
      // the settled flag. Ready-line detection in handleLine() calls the
      // stored resolveReady — we route through settle() instead.
      this.resolveReady = () => {
        clearTimeout(timeout);
        settle(null);
      };

      proc.stdout?.setEncoding('utf-8');
      proc.stderr?.setEncoding('utf-8');
      proc.stdout?.on('data', (chunk: string) => this.onStdout(chunk));
      proc.stderr?.on('data', (chunk: string) => {
        stderrBuf += chunk;
        this.output.appendLine(`[kensa:py:stderr] ${chunk.trimEnd()}`);
      });
      proc.on('error', (err) => {
        clearTimeout(timeout);
        this.output.appendLine(`[kensa] python process error: ${err.message}`);
        settle(
          new Error(
            `Failed to launch Python at '${this.pythonPath}': ${err.message}. ` +
              "Install Python 3.9+ with pandas, or set the 'kensa.pythonPath' setting."
          )
        );
      });
      proc.on('exit', (code, signal) => {
        clearTimeout(timeout);
        this.output.appendLine(`[kensa] python exited (code=${code}, signal=${signal})`);
        this.proc = null;
        for (const p of this.pending.values()) p.reject(new Error('python process exited'));
        this.pending.clear();
        // If the process exited before sending "ready", the start promise
        // is still pending. Reject it with the captured stderr so the user
        // sees the real error instead of hanging.
        if (!settled) {
          const tail = stderrBuf.trim().split('\n').slice(-5).join(' | ') || 'no output';
          settle(
            new Error(
              `Python subprocess exited before becoming ready (code=${code}). ${tail}`
            )
          );
        }
      });
    });
    return this.starting;
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    this.proc.kill();
    this.proc = null;
  }

  async loadFile(fsPath: string, kind: string, options: Record<string, unknown> = {}): Promise<DatasetInfo> {
    return (await this.request({ cmd: 'load_file', path: fsPath, kind, options })) as DatasetInfo;
  }

  async loadPickle(fsPath: string): Promise<DatasetInfo> {
    return (await this.request({ cmd: 'load_pickle', path: fsPath })) as DatasetInfo;
  }

  async computeDiff(
    prev: Array<Array<string | null>>,
    next: Array<Array<string | null>>
  ): Promise<DiffSummary> {
    return (await this.request({ cmd: 'diff', prev, new: next })) as DiffSummary;
  }

  async getSlice(start: number, end: number): Promise<DataSlice> {
    return (await this.request({ cmd: 'get_slice', start, end })) as DataSlice;
  }

  async getStats(columnIndex: number): Promise<ColumnStats> {
    return (await this.request({ cmd: 'get_stats', columnIndex })) as ColumnStats;
  }

  async getAllInsights(): Promise<QuickInsight[]> {
    return (await this.request({ cmd: 'get_all_insights' })) as QuickInsight[];
  }

  /** Replace the transient view filters on the Python side and return a
   *  fresh first-page slice of the resulting view. The filters are NOT
   *  applied as steps, so clearing them (pass `[]`) instantly restores the
   *  previously-hidden rows. */
  async setViewFilters(
    filters: Array<{ column: string; op: string; value?: string }>
  ): Promise<DataSlice> {
    return (await this.request({ cmd: 'set_view_filters', filters })) as DataSlice;
  }

  /** Replace the transient view sort on the Python side. Pass `null` to
   *  clear. Returns a fresh first-page slice. */
  async setViewSort(sort: { column: string; ascending: boolean } | null): Promise<DataSlice> {
    return (await this.request({ cmd: 'set_view_sort', sort })) as DataSlice;
  }

  async applyCode(code: string, step: OperationStep): Promise<DataSlice> {
    const slice = (await this.request({
      cmd: 'apply_code',
      code,
      step_id: step.id
    })) as DataSlice;
    this.steps.push(step);
    return slice;
  }

  async previewCode(code: string): Promise<DataSlice> {
    return (await this.request({ cmd: 'preview_code', code })) as DataSlice;
  }

  async undo(stepId: string): Promise<DataSlice> {
    const slice = (await this.request({ cmd: 'undo', step_id: stepId })) as DataSlice;
    this.steps = this.steps.filter((s) => s.id !== stepId);
    return slice;
  }

  async exportCsv(fsPath: string): Promise<void> {
    await this.request({ cmd: 'export_csv', path: fsPath });
  }

  async exportParquet(fsPath: string): Promise<void> {
    await this.request({ cmd: 'export_parquet', path: fsPath });
  }

  getSteps(): OperationStep[] {
    return [...this.steps];
  }

  private request(command: BackendCommand): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.proc || !this.proc.stdin) {
        reject(new Error('python backend not started'));
        return;
      }
      const id = this.nextRequestId++;
      this.pending.set(id, { resolve, reject });
      const envelope = JSON.stringify({ id, ...command }) + '\n';
      this.proc.stdin.write(envelope, (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    try {
      const msg = JSON.parse(line) as {
        id?: number;
        event?: string;
        result?: unknown;
        error?: string;
      };
      if (msg.event === 'ready') {
        this.resolveReady?.();
        this.resolveReady = null;
        return;
      }
      if (typeof msg.id !== 'number') return;
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.error) pending.reject(new Error(msg.error));
      else pending.resolve(msg.result);
    } catch {
      this.output.appendLine(`[kensa] failed to parse python message: ${line}`);
    }
  }
}

function detectPython(): string {
  // VS Code's Python extension exposes a resolver but it's async + optional;
  // for the subprocess fallback we just use the PATH interpreter. Users who
  // need a specific one set `kensa.pythonPath`.
  return process.platform === 'win32' ? 'python' : 'python3';
}
