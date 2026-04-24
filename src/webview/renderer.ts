// Notebook output renderer for Kensa. Registered via the `notebookRenderer`
// contribution point in package.json. VS Code calls `activate()` once when
// the extension loads and passes a context object; we return an object with
// `renderOutputItem(output, element)` which is called for each cell output
// that matches our mime type.
//
// We render two things:
//   1. A compact data grid (first 10 rows) for quick inspection in-place.
//   2. A button that posts a message back to the extension host asking it to
//      open the full Kensa webview panel for the underlying variable.
//
// Types are inlined below — VS Code's notebook renderer API doesn't publish an
// npm package for its TS types, only a docs page describing the shape.

interface OutputItem {
  readonly mime: string;
  readonly id: string;
  json(): unknown;
  text(): string;
  data(): Uint8Array;
}

interface RendererContext {
  postMessage?: (msg: unknown) => void;
  onDidReceiveMessage?: (handler: (msg: unknown) => void) => void;
  readonly workspace: { readonly isTrusted: boolean };
}

interface Renderer {
  renderOutputItem(output: OutputItem, element: HTMLElement): void;
  disposeOutputItem?(id?: string): void;
}

type ActivationFunction = (context: RendererContext) => Renderer;

interface DataFramePayload {
  readonly variable: string;
  readonly columns: Array<{ name: string; dtype: string }>;
  readonly rows: Array<Array<string | number | null>>;
  readonly totalRows: number;
}

export const activate: ActivationFunction = (context: RendererContext) => ({
  renderOutputItem(output: OutputItem, element: HTMLElement): void {
    try {
      const payload = output.json() as DataFramePayload;
      renderPayload(element, payload, context);
    } catch (err) {
      element.textContent = `Kensa renderer error: ${String(err)}`;
    }
  },
  disposeOutputItem(_id?: string): void {
    // Nothing to clean up — our DOM nodes are owned by `element`.
  }
});

function renderPayload(
  root: HTMLElement,
  payload: DataFramePayload,
  context: RendererContext
): void {
  root.innerHTML = '';
  root.classList.add('kensa-notebook-preview');

  // Styles are scoped via a <style> tag rather than an external file — the
  // renderer bundle runs inside the notebook iframe with its own CSP.
  const style = document.createElement('style');
  style.textContent = `
    .kensa-notebook-preview {
      font-family: var(--vscode-font-family, sans-serif);
      font-size: 12px;
      color: var(--vscode-foreground, #ccc);
      background: var(--vscode-editor-background, #1e1e1e);
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
      border-radius: 3px;
      padding: 8px;
      margin: 4px 0;
    }
    .kensa-notebook-preview table {
      border-collapse: collapse;
      width: 100%;
      margin: 6px 0;
      font-variant-numeric: tabular-nums;
    }
    .kensa-notebook-preview th,
    .kensa-notebook-preview td {
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
      padding: 3px 8px;
      text-align: left;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 240px;
    }
    .kensa-notebook-preview th {
      font-weight: 600;
      background: var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,0.1));
    }
    .kensa-notebook-preview .kensa-nb-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 6px;
      color: var(--vscode-descriptionForeground, rgba(128,128,128,0.8));
    }
    .kensa-notebook-preview .kensa-nb-open-btn {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #fff);
      border: none;
      padding: 4px 12px;
      border-radius: 3px;
      cursor: pointer;
      font-family: inherit;
      font-size: 11px;
    }
    .kensa-notebook-preview .kensa-nb-missing {
      color: var(--vscode-descriptionForeground, rgba(128,128,128,0.7));
      font-style: italic;
    }
  `;
  root.appendChild(style);

  const header = document.createElement('div');
  header.textContent = `Kensa preview — variable ${payload.variable}`;
  header.style.fontWeight = '600';
  header.style.marginBottom = '4px';
  root.appendChild(header);

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const col of payload.columns) {
    const th = document.createElement('th');
    th.textContent = `${col.name} (${col.dtype})`;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of payload.rows.slice(0, 10)) {
    const tr = document.createElement('tr');
    for (const cell of row) {
      const td = document.createElement('td');
      if (cell === null || cell === undefined) {
        td.textContent = '—';
        td.className = 'kensa-nb-missing';
      } else {
        td.textContent = String(cell);
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  root.appendChild(table);

  const footer = document.createElement('div');
  footer.className = 'kensa-nb-footer';
  const count = document.createElement('div');
  count.textContent = `${payload.totalRows.toLocaleString()} rows × ${payload.columns.length} columns`;
  footer.appendChild(count);

  const openBtn = document.createElement('button');
  openBtn.className = 'kensa-nb-open-btn';
  openBtn.type = 'button';
  openBtn.textContent = `Open '${payload.variable}' in Kensa`;
  openBtn.addEventListener('click', () => {
    // The renderer context provides postMessage to talk to its controller.
    // The controller — which lives in the extension host — listens for this
    // message and invokes `kensa.openVariable`.
    context.postMessage?.({
      type: 'kensa.openVariable',
      variable: payload.variable
    });
  });
  footer.appendChild(openBtn);
  root.appendChild(footer);
}
