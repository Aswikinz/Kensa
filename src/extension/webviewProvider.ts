// Owns the lifecycle of Kensa webview panels. Each opened file gets its own
// panel + DataRouter so multiple datasets can be open at once. Handles
// message routing between the webview and the router.

import * as path from 'node:path';
import * as vscode from 'vscode';
import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage
} from '../shared/messages';
import { DataRouter } from './dataRouter';
import { KernelManager } from './kernelManager';
import { exportAsNotebookCell } from './codeGenerator';

interface PanelEntry {
  readonly panel: vscode.WebviewPanel;
  readonly router: DataRouter;
  readonly kernelManager: KernelManager;
  readonly messageDisposable: vscode.Disposable;
  lastSlice: import('../shared/types').DataSlice | null;
}

const DEFAULT_PAGE_SIZE = 500;

export class WebviewProvider implements vscode.Disposable {
  private panels = new Map<string, PanelEntry>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel
  ) {}

  async openFile(uri: vscode.Uri): Promise<void> {
    const key = uri.fsPath;
    const existing = this.panels.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Active);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'kensa',
      `Kensa — ${path.basename(uri.fsPath)}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview'),
          vscode.Uri.joinPath(this.context.extensionUri, 'media')
        ]
      }
    );

    const kernelManager = new KernelManager(this.context.extensionPath, this.output);
    const router = new DataRouter(kernelManager);

    panel.webview.html = this.renderHtml(panel.webview);

    const messageDisposable = panel.webview.onDidReceiveMessage((raw: unknown) =>
      this.handleMessage(key, raw as WebviewToExtensionMessage)
    );

    const entry: PanelEntry = { panel, router, kernelManager, messageDisposable, lastSlice: null };
    this.panels.set(key, entry);

    panel.onDidDispose(async () => {
      messageDisposable.dispose();
      await router.dispose();
      this.panels.delete(key);
    });

    // Load the dataset on the router — this either hands back a DatasetInfo
    // synchronously (Rust) or awaits the Python subprocess.
    const mode =
      vscode.workspace.getConfiguration('kensa').get<string>('defaultMode', 'viewing') === 'editing'
        ? 'editing'
        : 'viewing';
    try {
      await router.openFile(uri, mode);
      const firstSlice = await router.getSlice(0, DEFAULT_PAGE_SIZE);
      this.post(entry, {
        type: 'bootstrap',
        mode: router.currentMode,
        engine: router.currentEngine,
        fileName: path.basename(uri.fsPath),
        source: 'file'
      });
      this.post(entry, { type: 'dataSlice', slice: firstSlice });
      entry.lastSlice = firstSlice;
      // Fire-and-forget insight computation — it's cheap on Rust and the
      // webview handles late arrivals gracefully.
      router
        .getAllInsights()
        .then((insights) => this.post(entry, { type: 'allColumnInsights', insights }))
        .catch((err) =>
          this.output.appendLine(`[kensa] insights failed: ${String(err)}`)
        );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.post(entry, { type: 'error', message });
    }
  }

  async openNotebookVariable(name: string, notebookHint?: vscode.Uri): Promise<void> {
    // Include the source notebook in the panel key so `df` from notebook A
    // and `df` from notebook B don't collide onto a single panel. Previously
    // the key was just `variable:${name}`, which meant opening `df` from a
    // second notebook silently reused the first notebook's panel, threw
    // away the new hint, and any refresh the reused panel did pointed at
    // the wrong kernel — surfacing as "No kernel is attached to <previous
    // notebook>" with the new dataframe never loading.
    const key = `variable:${name}:${notebookHint?.toString() ?? '_unknown'}`;
    const existing = this.panels.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Active);
      return;
    }

    // Attempt the extraction BEFORE spawning a panel. If it fails we show a
    // regular VS Code error toast with the real reason, instead of opening an
    // empty Kensa tab that just displays an error banner.
    const probeKernel = new KernelManager(this.context.extensionPath, this.output);
    try {
      await probeKernel.extractVariableToPickle(name, notebookHint);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`[kensa] openNotebookVariable failed: ${message}`);
      await probeKernel.dispose();
      vscode.window.showErrorMessage(`Kensa: ${message}`);
      return;
    }
    await probeKernel.dispose();

    const panel = vscode.window.createWebviewPanel(
      'kensa',
      `Kensa — ${name}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview'),
          vscode.Uri.joinPath(this.context.extensionUri, 'media')
        ]
      }
    );

    const kernelManager = new KernelManager(this.context.extensionPath, this.output);
    const router = new DataRouter(kernelManager);
    panel.webview.html = this.renderHtml(panel.webview);

    const messageDisposable = panel.webview.onDidReceiveMessage((raw: unknown) =>
      this.handleMessage(key, raw as WebviewToExtensionMessage)
    );

    const entry: PanelEntry = { panel, router, kernelManager, messageDisposable, lastSlice: null };
    this.panels.set(key, entry);

    panel.onDidDispose(async () => {
      messageDisposable.dispose();
      await router.dispose();
      this.panels.delete(key);
    });

    try {
      await router.openVariable(name, notebookHint);
      const firstSlice = await router.getSlice(0, DEFAULT_PAGE_SIZE);
      this.post(entry, {
        type: 'bootstrap',
        mode: router.currentMode,
        engine: router.currentEngine,
        fileName: name,
        source: 'variable'
      });
      this.post(entry, { type: 'dataSlice', slice: firstSlice });
      entry.lastSlice = firstSlice;
      router
        .getAllInsights()
        .then((insights) => this.post(entry, { type: 'allColumnInsights', insights }))
        .catch((err) =>
          this.output.appendLine(`[kensa] insights failed: ${String(err)}`)
        );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.post(entry, { type: 'error', message });
    }
  }

  async clearRuntime(): Promise<void> {
    for (const entry of this.panels.values()) {
      await entry.kernelManager.dispose();
    }
  }

  async requestExportCode(): Promise<void> {
    const active = this.activePanel();
    if (!active) return;
    const code = exportAsNotebookCell(active.router.getSteps());
    const doc = await vscode.workspace.openTextDocument({ content: code, language: 'python' });
    vscode.window.showTextDocument(doc);
  }

  async requestExportData(): Promise<void> {
    const active = this.activePanel();
    if (!active) return;
    const target = await vscode.window.showSaveDialog({
      filters: { 'CSV': ['csv'], 'Parquet': ['parquet'] }
    });
    if (!target) return;
    try {
      if (target.fsPath.endsWith('.parquet')) {
        await active.router.exportParquet(target.fsPath);
      } else {
        await active.router.exportCsv(target.fsPath);
      }
      vscode.window.showInformationMessage(`Kensa: exported to ${target.fsPath}`);
    } catch (err) {
      vscode.window.showErrorMessage(`Kensa: export failed — ${String(err)}`);
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    for (const entry of this.panels.values()) {
      entry.panel.dispose();
    }
    this.panels.clear();
  }

  // Private ------------------------------------------------------------------

  private activePanel(): PanelEntry | null {
    for (const entry of this.panels.values()) {
      if (entry.panel.active) return entry;
    }
    return this.panels.values().next().value ?? null;
  }

  private async handleMessage(key: string, msg: WebviewToExtensionMessage): Promise<void> {
    const entry = this.panels.get(key);
    if (!entry) return;
    const { router } = entry;

    try {
      switch (msg.type) {
        case 'ready':
          // Webview is asking for the initial state again (e.g. after a
          // tab-switch that resumed the iframe).
          this.post(entry, {
            type: 'bootstrap',
            mode: router.currentMode,
            engine: router.currentEngine,
            fileName: this.currentFileName(router),
            source: router.currentSource?.kind ?? 'file'
          });
          break;

        case 'requestDataSlice': {
          const slice = await router.getSlice(msg.start, msg.end);
          entry.lastSlice = slice;
          this.post(entry, { type: 'dataSlice', slice });
          break;
        }

        case 'requestColumnStats': {
          const stats = await router.getColumnStats(msg.columnIndex);
          this.post(entry, { type: 'columnStats', columnIndex: msg.columnIndex, stats });
          break;
        }

        case 'requestAllColumnInsights': {
          const insights = await router.getAllInsights();
          this.post(entry, { type: 'allColumnInsights', insights });
          break;
        }

        case 'applySort': {
          await router.applySort(msg.sort);
          const slice = await router.getSlice(0, DEFAULT_PAGE_SIZE);
          this.post(entry, { type: 'dataSlice', slice });
          break;
        }

        case 'applyFilter': {
          await router.applyFilter(msg.filters);
          const slice = await router.getSlice(0, DEFAULT_PAGE_SIZE);
          this.post(entry, { type: 'dataSlice', slice });
          break;
        }

        case 'previewOperation': {
          // In viewing mode we can't execute arbitrary Pandas without paying
          // the cost of spinning up Python, so we transparently switch to
          // editing mode first. This matches the behavior of applyOperation.
          if (router.currentMode !== 'editing') {
            await router.switchMode('editing');
            this.post(entry, { type: 'modeChanged', mode: router.currentMode });
            this.post(entry, {
              type: 'engineStatus',
              engine: router.currentEngine,
              ready: true
            });
          }
          const { code, slice, changedMask, diff } = await router.previewOperation(
            msg.operationId,
            msg.parameters
          );
          this.post(entry, {
            type: 'operationPreview',
            code,
            slice,
            changedMask,
            diff
          });
          break;
        }

        case 'requestPreviewSlice': {
          // Called by the grid when the user scrolls past the first preview
          // page. We serve from the stashed preview_df — operation is NOT
          // re-executed — and return both the rows and the per-cell mask
          // for the requested window so highlights remain accurate.
          const { slice, changedMask } = await router.getPreviewSlice(
            msg.start,
            msg.end
          );
          this.post(entry, { type: 'previewSlice', slice, changedMask });
          break;
        }

        case 'applyOperation': {
          const prev = entry.lastSlice;
          const step = await router.applyOperation(msg.operationId, msg.parameters);
          const slice = await router.getSlice(0, DEFAULT_PAGE_SIZE);
          const diff = computeDiff(prev, slice);
          entry.lastSlice = slice;
          this.post(entry, { type: 'operationApplied', step, slice, diff });
          this.post(entry, { type: 'modeChanged', mode: router.currentMode });
          this.post(entry, { type: 'engineStatus', engine: router.currentEngine, ready: true });
          break;
        }

        case 'undoStep': {
          const slice = await router.undoStep(msg.stepId);
          entry.lastSlice = slice;
          this.post(entry, { type: 'stepRemoved', stepId: msg.stepId, slice });
          break;
        }

        case 'switchMode': {
          this.output.appendLine(
            `[kensa] switchMode requested: ${msg.mode} (current=${router.currentMode}, source=${router.currentSource?.kind ?? 'none'})`
          );
          await router.switchMode(msg.mode);
          this.output.appendLine(
            `[kensa] switchMode done: now mode=${router.currentMode}, engine=${router.currentEngine}`
          );
          this.post(entry, { type: 'modeChanged', mode: router.currentMode });
          this.post(entry, { type: 'engineStatus', engine: router.currentEngine, ready: true });
          const slice = await router.getSlice(0, DEFAULT_PAGE_SIZE);
          entry.lastSlice = slice;
          this.post(entry, { type: 'dataSlice', slice });
          break;
        }

        case 'refreshSource': {
          this.output.appendLine(
            `[kensa] refresh requested for source=${router.currentSource?.kind ?? 'none'}`
          );
          await router.refresh();
          const slice = await router.getSlice(0, DEFAULT_PAGE_SIZE);
          entry.lastSlice = slice;
          this.post(entry, { type: 'dataSlice', slice });
          // Also refresh the column insights since the data shape may have
          // changed completely (different rows, different stats).
          router
            .getAllInsights()
            .then((insights) => this.post(entry, { type: 'allColumnInsights', insights }))
            .catch((err) =>
              this.output.appendLine(`[kensa] post-refresh insights failed: ${String(err)}`)
            );
          break;
        }

        case 'exportData': {
          await this.requestExportData();
          break;
        }

        case 'exportCode': {
          await this.requestExportCode();
          break;
        }

        case 'inferFlashFill': {
          const expression = await router.inferFlashFill(msg.columnIndex, msg.examples);
          this.post(entry, { type: 'flashFillResult', columnIndex: msg.columnIndex, expression });
          break;
        }

        case 'executeCustomCode': {
          const prev = entry.lastSlice;
          const step = await router.applyOperation('custom', { code: msg.code });
          const slice = await router.getSlice(0, DEFAULT_PAGE_SIZE);
          const diff = computeDiff(prev, slice);
          entry.lastSlice = slice;
          this.post(entry, { type: 'operationApplied', step, slice, diff });
          this.post(entry, { type: 'modeChanged', mode: router.currentMode });
          this.post(entry, { type: 'engineStatus', engine: router.currentEngine, ready: true });
          break;
        }

        default:
          this.output.appendLine(`[kensa] unhandled message: ${JSON.stringify(msg)}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`[kensa] message handler error: ${message}`);
      this.post(entry, { type: 'error', message });
    }
  }

  private currentFileName(router: DataRouter): string {
    const src = router.currentSource;
    if (src?.kind === 'file') return src.descriptor.name;
    if (src?.kind === 'variable') return src.name;
    return '';
  }

  private post(entry: PanelEntry, msg: ExtensionToWebviewMessage): void {
    entry.panel.webview.postMessage(msg);
  }

  private renderHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'webview.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'webview.css')
    );
    const nonce = newNonce();
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`
    ].join('; ');
    return /* html */ `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Kensa</title>
    <link rel="stylesheet" href="${styleUri}" />
    <style>
      html, body, #kensa-root { height: 100%; margin: 0; padding: 0; }
      body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        overflow: hidden;
      }
    </style>
  </head>
  <body>
    <div id="kensa-root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

function newNonce(): string {
  let result = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/** Diff between two data slices.
 *
 * Cell-level highlighting is only emitted when:
 *   1. Both slices have the same `totalRows` — if the operation added or
 *      dropped rows, row positions shift and a position-based compare
 *      would mark every downstream cell as modified. Better to report
 *      the structural change and keep the cells clean.
 *   2. The two slices' `startRow` values line up so we're comparing the
 *      same window into the data. (Preview always uses start=0, so this
 *      normally holds.)
 *
 * When either condition fails we return structural information only
 * (`columnsAdded`, `columnsRemoved`, `rowsAdded`, `rowsRemoved`) and let
 * the webview render a summary banner instead of per-cell highlights. */
function computeDiff(
  prev: import('../shared/types').DataSlice | null,
  next: import('../shared/types').DataSlice
): import('../shared/types').DiffSummary | null {
  if (!prev) return null;

  const prevColumnNames = prev.columns.map((c) => c.name);
  const nextColumnNames = next.columns.map((c) => c.name);
  const columnsAdded = nextColumnNames.filter((n) => !prevColumnNames.includes(n));
  const columnsRemoved = prevColumnNames.filter((n) => !nextColumnNames.includes(n));

  const rowsAdded = Math.max(0, next.totalRows - prev.totalRows);
  const rowsRemoved = Math.max(0, prev.totalRows - next.totalRows);

  const modifiedCells: Array<{ row: number; column: string }> = [];
  const sameShape =
    prev.totalRows === next.totalRows && prev.startRow === next.startRow;

  if (sameShape) {
    const overlapRows = Math.min(prev.rows.length, next.rows.length);
    for (let r = 0; r < overlapRows; r++) {
      const prevRow = prev.rows[r];
      const nextRow = next.rows[r];
      if (!prevRow || !nextRow) continue;
      // Walk columns by name so reordering doesn't mark every cell as modified.
      for (let c = 0; c < nextColumnNames.length; c++) {
        const name = nextColumnNames[c];
        if (!name) continue;
        // Don't highlight cells in newly-added columns — they're already
        // painted wholesale by the `columnsAdded` styling in the grid.
        if (columnsAdded.includes(name)) continue;
        const prevIdx = prevColumnNames.indexOf(name);
        if (prevIdx === -1) continue;
        const prevValue = prevRow[prevIdx];
        const nextValue = nextRow[c];
        if ((prevValue ?? null) !== (nextValue ?? null)) {
          modifiedCells.push({ row: r + next.startRow, column: name });
        }
      }
    }
  }

  return {
    rowsAdded,
    rowsRemoved,
    rowsChanged: modifiedCells.length,
    columnsAdded,
    columnsRemoved,
    modifiedCells
  };
}
