// Top toolbar. Mode toggle, engine indicator, row count, and panel toggles.

import { useKensaStore } from '../state/store';
import { postMessage } from '../vscodeApi';

export function Toolbar() {
  const {
    mode,
    engine,
    slice,
    fileName,
    toggleSummaryPanel,
    toggleOperationsPanel,
    toggleCodePreview
  } = useKensaStore();

  const rowCount = slice?.totalRows ?? 0;
  const colCount = slice?.columns.length ?? 0;

  return (
    <div className="kensa-toolbar">
      <div className="kensa-toolbar-left">
        <div className="kensa-brand">Kensa</div>
        <div className="kensa-filename">{fileName}</div>
      </div>

      <div className="kensa-toolbar-center">
        <div className="kensa-mode-toggle">
          <button
            type="button"
            className={`kensa-mode-btn ${mode === 'viewing' ? 'kensa-mode-active' : ''}`}
            onClick={() => postMessage({ type: 'switchMode', mode: 'viewing' })}
          >
            View
          </button>
          <button
            type="button"
            className={`kensa-mode-btn ${mode === 'editing' ? 'kensa-mode-active' : ''}`}
            onClick={() => postMessage({ type: 'switchMode', mode: 'editing' })}
          >
            Edit
          </button>
        </div>
      </div>

      <div className="kensa-toolbar-right">
        <div className="kensa-engine-indicator" title={engine === 'rust' ? 'Rust engine' : 'Python engine'}>
          {engine === 'rust' ? '⚡ Rust' : '🐍 Python'}
        </div>
        <div className="kensa-row-count">
          {rowCount.toLocaleString()} × {colCount}
        </div>
        <button type="button" className="kensa-icon-btn" onClick={toggleOperationsPanel} title="Operations">
          ⚙
        </button>
        <button type="button" className="kensa-icon-btn" onClick={toggleCodePreview} title="Code preview">
          {'</>'}
        </button>
        <button type="button" className="kensa-icon-btn" onClick={toggleSummaryPanel} title="Summary">
          ⓘ
        </button>
        <button
          type="button"
          className="kensa-icon-btn"
          onClick={() => postMessage({ type: 'exportData', format: 'csv' })}
          title="Export data"
        >
          ⇩
        </button>
      </div>
    </div>
  );
}
