// Data router: dispatches webview messages to either the Rust engine (Viewing
// mode) or the Python backend (Editing mode / notebook variables). Owns the
// current source ("file" | "variable"), the current mode, and references to
// both engines. Clean shutdown goes through the owner (WebviewProvider).

import * as path from 'node:path';
import * as vscode from 'vscode';
import type {
  ColumnStats,
  DataSlice,
  DatasetInfo,
  EditorMode,
  EngineKind,
  FilterSpec,
  OperationStep,
  QuickInsight,
  SortSpec
} from '../shared/types';
import { generateStepCode, newStepId } from './codeGenerator';
import { KernelManager } from './kernelManager';
import { defaultCsvOptions, describeFile, type FileDescriptor } from './fileHandler';
import { getRustBridge, type RustDataEngine } from './rustBridge';

export type DataSource =
  | { kind: 'file'; descriptor: FileDescriptor }
  | { kind: 'variable'; name: string; notebookHint?: vscode.Uri };

export class DataRouter {
  private rustEngine: RustDataEngine | null = null;
  private mode: EditorMode = 'viewing';
  private source: DataSource | null = null;
  private steps: OperationStep[] = [];
  private lastSlice: DataSlice | null = null;

  constructor(private readonly kernelManager: KernelManager) {}

  get currentEngine(): EngineKind {
    return this.mode === 'viewing' && this.rustEngine ? 'rust' : 'python';
  }

  get currentMode(): EditorMode {
    return this.mode;
  }

  get currentSource(): DataSource | null {
    return this.source;
  }

  async openFile(uri: vscode.Uri, startMode: EditorMode): Promise<DatasetInfo> {
    const descriptor = describeFile(uri.fsPath);
    if (!descriptor) {
      throw new Error(`Unsupported file type: ${path.basename(uri.fsPath)}`);
    }
    this.source = { kind: 'file', descriptor };
    this.steps = [];
    this.mode = startMode;

    const rustEnabled = vscode.workspace
      .getConfiguration('kensa')
      .get<boolean>('rust.enabled', true);
    const bridge = getRustBridge();
    const canUseRust = rustEnabled && bridge.isLoaded() && startMode === 'viewing';

    if (canUseRust) {
      this.rustEngine = bridge.createEngine();
      return this.loadViaRust(descriptor);
    }
    // Fall back to Python if Rust isn't available or the user asked for
    // Editing mode from the start.
    this.mode = 'editing';
    return this.loadViaPython(descriptor);
  }

  async openVariable(name: string, notebookHint?: vscode.Uri): Promise<DatasetInfo> {
    this.source = { kind: 'variable', name, notebookHint };
    this.mode = 'editing';
    this.steps = [];
    const backend = await this.kernelManager.ensureBackend();
    // extractVariableToPickle now throws a descriptive Error rather than
    // returning null — let it propagate so the webview shows the real reason
    // (missing extension, no kernel, variable doesn't exist, etc.).
    const picklePath = await this.kernelManager.extractVariableToPickle(name, notebookHint);
    return backend.loadPickle(picklePath);
  }

  /** Re-pull the current source from disk (file) or from the live kernel
   *  (notebook variable). Steps and view filters are dropped because they
   *  may no longer apply to the new shape. Returns a fresh DatasetInfo. */
  async refresh(): Promise<DatasetInfo> {
    if (!this.source) {
      throw new Error('Nothing to refresh — no dataset is open.');
    }
    this.steps = [];
    if (this.source.kind === 'file') {
      const descriptor = this.source.descriptor;
      // File path: respect the current mode. If we're in viewing mode and
      // Rust is available, re-read with Rust; otherwise re-read with Python.
      if (this.mode === 'viewing' && this.rustEngine) {
        return this.loadViaRust(descriptor);
      }
      return this.loadViaPython(descriptor);
    }
    // Variable: ask the kernel to pickle it again, then have Python reload.
    const backend = await this.kernelManager.ensureBackend();
    const picklePath = await this.kernelManager.extractVariableToPickle(
      this.source.name,
      this.source.notebookHint
    );
    return backend.loadPickle(picklePath);
  }

  async switchMode(mode: EditorMode): Promise<void> {
    if (mode === this.mode) return;
    if (mode === 'editing' && this.source?.kind === 'file') {
      // Rust -> Python handoff: tell Python to re-read the file from disk.
      await this.loadViaPython(this.source.descriptor);
      this.mode = 'editing';
    } else if (mode === 'viewing' && this.source?.kind === 'file') {
      // Python -> Rust. Drop any unexported steps (user should save them
      // explicitly) and re-open the original file with Rust.
      this.steps = [];
      this.mode = 'viewing';
      const bridge = getRustBridge();
      if (bridge.isLoaded()) {
        this.rustEngine = bridge.createEngine();
        await this.loadViaRust(this.source.descriptor);
      }
    } else {
      // Variable source is locked to editing.
      this.mode = 'editing';
    }
  }

  async getSlice(start: number, end: number): Promise<DataSlice> {
    const slice = await this.fetchSlice(start, end);
    this.lastSlice = slice;
    return slice;
  }

  async getColumnStats(columnIndex: number): Promise<ColumnStats> {
    if (this.mode === 'viewing' && this.rustEngine) {
      return rustStatsToShared(this.rustEngine.getColumnStats(columnIndex));
    }
    const backend = await this.kernelManager.ensureBackend();
    return backend.getStats(columnIndex);
  }

  async getAllInsights(): Promise<QuickInsight[]> {
    if (this.mode === 'viewing' && this.rustEngine) {
      return this.rustEngine.getAllQuickInsights().map((i) => ({
        columnIndex: i.columnIndex,
        name: i.name,
        dtype: i.dtype,
        kind: (i.kind as QuickInsight['kind']) ?? 'empty',
        missing: i.missing,
        distinct: i.distinct,
        histogram: i.histogram ?? null,
        frequency: i.frequency ?? null
      }));
    }
    const backend = await this.kernelManager.ensureBackend();
    return backend.getAllInsights();
  }

  async applySort(sort: SortSpec | null): Promise<void> {
    if (this.mode === 'viewing' && this.rustEngine) {
      if (sort) this.rustEngine.sort(sort.columnIndex, sort.ascending);
      else this.rustEngine.resetView();
      return;
    }
    // Editing mode: set the TRANSIENT view sort on the Python backend. It's
    // a view-level mask, not a step, so clearing it instantly restores the
    // unsorted order without touching the step history.
    const backend = await this.kernelManager.ensureBackend();
    const columnName =
      sort && this.lastSlice ? this.lastSlice.columns[sort.columnIndex]?.name ?? '' : '';
    await backend.setViewSort(sort && columnName ? { column: columnName, ascending: sort.ascending } : null);
  }

  async applyFilter(filters: FilterSpec[]): Promise<void> {
    if (this.mode === 'viewing' && this.rustEngine) {
      if (filters.length === 0) this.rustEngine.resetView();
      else this.rustEngine.filter(filters);
      return;
    }
    // Editing mode: push the filter list to the Python backend as transient
    // view filters. These are NOT Pandas steps — they're re-evaluated on
    // every read. Clearing the list (empty array) restores every hidden row.
    const backend = await this.kernelManager.ensureBackend();
    const payload = filters.map((f) => ({
      column: this.lastSlice?.columns[f.columnIndex]?.name ?? '',
      op: f.op,
      value: f.value ?? ''
    }));
    await backend.setViewFilters(payload);
  }

  /** Run an operation's generated code against a preview copy of the
   *  dataframe without committing it. Returns the generated code, the
   *  first preview page (with a per-cell changed mask), and a full-df
   *  diff summary (total cells modified, rows added/removed, etc.) that
   *  reflects the ENTIRE preview_df — not just the first 500 rows. */
  async previewOperation(
    operationId: string,
    params: Record<string, unknown>
  ): Promise<{
    code: string;
    slice: DataSlice | null;
    changedMask: boolean[][];
    diff: import('../shared/types').DiffSummary | null;
  }> {
    const { code } = generateStepCode(operationId, params);
    if (this.mode === 'viewing') {
      return { code, slice: null, changedMask: [], diff: null };
    }
    const backend = await this.kernelManager.ensureBackend();
    const raw = await backend.previewCode(code);
    const { changedMask, diff, ...sliceFields } = raw;
    return {
      code,
      slice: { ...sliceFields, engine: 'python' },
      changedMask: changedMask ?? [],
      diff
    };
  }

  /** Fetch another page of the currently-active preview. Used by the grid
   *  when the user scrolls past the first page while in preview mode.
   *  Returns both the slice and the per-cell changed mask for that window.
   *  Does NOT re-run the operation — it reads from the stashed preview_df. */
  async getPreviewSlice(
    start: number,
    end: number
  ): Promise<{ slice: DataSlice; changedMask: boolean[][] }> {
    const backend = await this.kernelManager.ensureBackend();
    const raw = await backend.getPreviewSlice(start, end);
    const { changedMask, ...sliceFields } = raw;
    return {
      slice: { ...sliceFields, engine: 'python' },
      changedMask: changedMask ?? []
    };
  }

  async applyOperation(operationId: string, params: Record<string, unknown>): Promise<OperationStep> {
    if (this.mode !== 'editing') {
      // Editing mode is required for any step that must produce exportable
      // code. Transparently switch so users don't have to think about it.
      await this.switchMode('editing');
    }
    const { code, label } = generateStepCode(operationId, params);
    const step: OperationStep = {
      id: newStepId(),
      operationId,
      label,
      parameters: params,
      code,
      appliedAt: Date.now()
    };
    const backend = await this.kernelManager.ensureBackend();
    await backend.applyCode(code, step);
    this.steps.push(step);
    return step;
  }

  async undoStep(stepId: string): Promise<DataSlice> {
    const backend = await this.kernelManager.ensureBackend();
    const slice = await backend.undo(stepId);
    this.steps = this.steps.filter((s) => s.id !== stepId);
    return slice;
  }

  getSteps(): readonly OperationStep[] {
    return this.steps;
  }

  async exportCsv(fsPath: string): Promise<void> {
    if (this.mode === 'viewing' && this.rustEngine) {
      this.rustEngine.exportCsv(fsPath);
    } else {
      const backend = await this.kernelManager.ensureBackend();
      await backend.exportCsv(fsPath);
    }
  }

  async exportParquet(fsPath: string): Promise<void> {
    if (this.mode === 'viewing' && this.rustEngine) {
      this.rustEngine.exportParquet(fsPath);
    } else {
      const backend = await this.kernelManager.ensureBackend();
      await backend.exportParquet(fsPath);
    }
  }

  async inferFlashFill(
    columnIndex: number,
    examples: Array<{ input: string; output: string }>
  ): Promise<string | null> {
    if (this.rustEngine) {
      return this.rustEngine.inferPattern(columnIndex, examples);
    }
    return null;
  }

  async dispose(): Promise<void> {
    this.rustEngine?.clear();
    this.rustEngine = null;
    await this.kernelManager.dispose();
  }

  // Private ------------------------------------------------------------------

  private async loadViaRust(descriptor: FileDescriptor): Promise<DatasetInfo> {
    if (!this.rustEngine) {
      throw new Error('rust engine not initialized');
    }
    const rustInfo = (() => {
      switch (descriptor.kind) {
        case 'csv':
        case 'tsv': {
          const opts = defaultCsvOptions(descriptor.kind);
          return this.rustEngine!.loadCsv(descriptor.fsPath, opts.delimiter, opts.encoding, opts.hasHeader);
        }
        case 'parquet':
          return this.rustEngine!.loadParquet(descriptor.fsPath);
        case 'excel':
          return this.rustEngine!.loadExcel(descriptor.fsPath);
        case 'jsonl':
          return this.rustEngine!.loadJsonl(descriptor.fsPath);
      }
    })();
    return {
      columnNames: rustInfo.columnNames,
      columnDtypes: rustInfo.columnDtypes,
      inferredDtypes: rustInfo.inferredDtypes,
      rowCount: rustInfo.rowCount,
      columnCount: rustInfo.columnCount
    };
  }

  private async loadViaPython(descriptor: FileDescriptor): Promise<DatasetInfo> {
    const backend = await this.kernelManager.ensureBackend();
    const opts = descriptor.kind === 'csv' || descriptor.kind === 'tsv' ? defaultCsvOptions(descriptor.kind) : {};
    return backend.loadFile(descriptor.fsPath, descriptor.kind, opts);
  }

  private async fetchSlice(start: number, end: number): Promise<DataSlice> {
    if (this.mode === 'viewing' && this.rustEngine) {
      const raw = this.rustEngine.getSlice(start, end);
      return {
        rows: raw.rows,
        startRow: raw.startRow,
        endRow: raw.endRow,
        totalRows: raw.totalRows,
        columns: raw.columnNames.map((name, i) => ({
          index: i,
          name,
          dtype: raw.columnDtypes[i] ?? '',
          inferred: raw.columnDtypes[i] ?? ''
        })),
        engine: 'rust'
      };
    }
    const backend = await this.kernelManager.ensureBackend();
    const slice = await backend.getSlice(start, end);
    return { ...slice, engine: 'python' };
  }
}

function rustStatsToShared(s: {
  name: string;
  dtype: string;
  count: number;
  missing: number;
  distinct: number;
  min: string | null;
  max: string | null;
  mean: number | null;
  std: number | null;
  sum: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  topValue: string | null;
  topCount: number | null;
}): ColumnStats {
  return {
    name: s.name,
    dtype: s.dtype,
    count: s.count,
    missing: s.missing,
    distinct: s.distinct,
    min: s.min,
    max: s.max,
    mean: s.mean,
    std: s.std,
    sum: s.sum,
    p25: s.p25,
    p50: s.p50,
    p75: s.p75,
    topValue: s.topValue,
    topCount: s.topCount
  };
}
