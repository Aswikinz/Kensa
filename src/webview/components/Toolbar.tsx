// Top toolbar.
//
// Mode toggle is only shown when the source is a file — notebook variables
// live in memory and don't have a "viewing" mode without Python. While a
// switch is in flight we show a spinner and disable both buttons so you
// can't queue overlapping requests.
//
// The "Reset" button clears any active sort/filter and returns the grid to
// the raw dataset order.

import { useKensaStore } from '../state/store';
import { postMessage } from '../vscodeApi';

export function Toolbar() {
  const mode = useKensaStore((s) => s.mode);
  const engine = useKensaStore((s) => s.engine);
  const slice = useKensaStore((s) => s.slice);
  const fileName = useKensaStore((s) => s.fileName);
  const source = useKensaStore((s) => s.source);
  const switching = useKensaStore((s) => s.switching);
  const setSwitching = useKensaStore((s) => s.setSwitching);
  const toggleSummaryPanel = useKensaStore((s) => s.toggleSummaryPanel);
  const toggleOperationsPanel = useKensaStore((s) => s.toggleOperationsPanel);
  const toggleCodePreview = useKensaStore((s) => s.toggleCodePreview);

  const rowCount = slice?.totalRows ?? 0;
  const colCount = slice?.columns.length ?? 0;

  const requestMode = (requested: 'viewing' | 'editing') => {
    if (switching || requested === mode) return;
    setSwitching(true);
    postMessage({ type: 'switchMode', mode: requested });
  };

  const resetView = () => {
    postMessage({ type: 'applySort', sort: null });
    postMessage({ type: 'applyFilter', filters: [] });
  };

  return (
    <div className="kensa-toolbar">
      <div className="kensa-toolbar-left">
        <div className="kensa-brand">Kensa</div>
        <div className="kensa-filename">{fileName}</div>
      </div>

      <div className="kensa-toolbar-center">
        {source === 'file' && (
          <div className="kensa-mode-toggle" aria-busy={switching}>
            <button
              type="button"
              className={`kensa-mode-btn ${mode === 'viewing' ? 'kensa-mode-active' : ''}`}
              onClick={() => requestMode('viewing')}
              disabled={switching}
              title={mode === 'viewing' ? 'Currently viewing' : 'Switch to view-only (Rust engine)'}
            >
              {switching && mode !== 'viewing' ? '…' : 'View'}
            </button>
            <button
              type="button"
              className={`kensa-mode-btn ${mode === 'editing' ? 'kensa-mode-active' : ''}`}
              onClick={() => requestMode('editing')}
              disabled={switching}
              title={mode === 'editing' ? 'Currently editing' : 'Switch to edit (Python engine)'}
            >
              {switching && mode !== 'editing' ? '…' : 'Edit'}
            </button>
          </div>
        )}
        {source === 'variable' && (
          <div className="kensa-mode-hint" title="Notebook variables are always in Edit mode">
            Edit (notebook variable)
          </div>
        )}
      </div>

      <div className="kensa-toolbar-right">
        <button
          type="button"
          className="kensa-btn kensa-btn-ghost"
          onClick={resetView}
          title="Clear any applied sort or filter"
        >
          Reset filters
        </button>
        <div
          className="kensa-engine-indicator"
          title={engine === 'rust' ? 'Rust engine' : 'Python engine'}
        >
          {engine === 'rust' ? '⚡ Rust' : '🐍 Python'}
        </div>
        <div className="kensa-row-count">
          {rowCount.toLocaleString()} × {colCount}
        </div>
        <button
          type="button"
          className="kensa-icon-btn"
          onClick={toggleOperationsPanel}
          title="Operations panel"
        >
          ⚙
        </button>
        <button
          type="button"
          className="kensa-icon-btn"
          onClick={toggleCodePreview}
          title="Code preview panel"
        >
          {'</>'}
        </button>
        <button
          type="button"
          className="kensa-icon-btn"
          onClick={toggleSummaryPanel}
          title="Summary panel"
        >
          ⓘ
        </button>
        <button
          type="button"
          className="kensa-icon-btn"
          onClick={() => postMessage({ type: 'exportData', format: 'csv' })}
          title="Export data to file"
        >
          ⇩
        </button>
      </div>
    </div>
  );
}
