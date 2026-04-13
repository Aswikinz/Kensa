// Top toolbar.
//
// Left: brand + file name.
// Center: View / Edit mode toggle (only for file sources).
// Right: active-filter badge, engine indicator, row count, panel toggles,
//        export button.
//
// The filter badge shows a count of currently-applied column filters and
// doubles as a "clear all filters" button. It's hidden when there are no
// active filters so the chrome stays quiet when nothing is filtered.

import { useKensaStore } from '../state/store';
import { postMessage } from '../vscodeApi';

export function Toolbar() {
  const mode = useKensaStore((s) => s.mode);
  const engine = useKensaStore((s) => s.engine);
  const slice = useKensaStore((s) => s.slice);
  const fileName = useKensaStore((s) => s.fileName);
  const source = useKensaStore((s) => s.source);
  const switching = useKensaStore((s) => s.switching);
  const activeFilters = useKensaStore((s) => s.activeFilters);
  const activeSort = useKensaStore((s) => s.activeSort);
  const setSwitching = useKensaStore((s) => s.setSwitching);
  const clearAllFilters = useKensaStore((s) => s.clearAllFilters);
  const toggleSummaryPanel = useKensaStore((s) => s.toggleSummaryPanel);
  const toggleOperationsPanel = useKensaStore((s) => s.toggleOperationsPanel);
  const toggleCodePreview = useKensaStore((s) => s.toggleCodePreview);

  const rowCount = slice?.totalRows ?? 0;
  const colCount = slice?.columns.length ?? 0;
  const filterCount = activeFilters.length;
  const hasView = filterCount > 0 || activeSort !== null;

  const requestMode = (requested: 'viewing' | 'editing') => {
    if (switching || requested === mode) return;
    setSwitching(true);
    postMessage({ type: 'switchMode', mode: requested });
  };

  return (
    <div className="kensa-toolbar">
      <div className="kensa-toolbar-left">
        <div className="kensa-brand">Kensa</div>
        <div className="kensa-filename" title={fileName}>
          {fileName}
        </div>
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
      </div>

      <div className="kensa-toolbar-right">
        {hasView && (
          <button
            type="button"
            className="kensa-filter-badge"
            onClick={clearAllFilters}
            title={
              filterCount > 0
                ? `${filterCount} filter${filterCount === 1 ? '' : 's'} active — click to clear all`
                : 'Active sort — click to clear'
            }
          >
            <span className="kensa-filter-badge-icon">⧩</span>
            <span className="kensa-filter-badge-label">
              {filterCount > 0
                ? `${filterCount} filter${filterCount === 1 ? '' : 's'}`
                : 'Sorted'}
            </span>
            <span className="kensa-filter-badge-close">×</span>
          </button>
        )}
        <div
          className="kensa-engine-indicator"
          title={engine === 'rust' ? 'Rust engine — instant viewing' : 'Python engine — code generation'}
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
