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

import { useEffect } from 'react';
import { useKensaStore } from '../state/store';
import { postMessage } from '../vscodeApi';
import { formatCompact, formatPercent } from '../formatters';
import {
  BoltIcon,
  CodeIcon,
  ExportIcon,
  FilterIcon,
  OperationsIcon,
  RefreshIcon,
  SearchIcon,
  SummaryIcon,
  TerminalIcon
} from './icons';

export function Toolbar() {
  const mode = useKensaStore((s) => s.mode);
  const engine = useKensaStore((s) => s.engine);
  const slice = useKensaStore((s) => s.slice);
  const fileName = useKensaStore((s) => s.fileName);
  const source = useKensaStore((s) => s.source);
  const switching = useKensaStore((s) => s.switching);
  const activeFilters = useKensaStore((s) => s.activeFilters);
  const activeSort = useKensaStore((s) => s.activeSort);
  const showSummaryPanel = useKensaStore((s) => s.showSummaryPanel);
  const showOperationsPanel = useKensaStore((s) => s.showOperationsPanel);
  const showCodePreview = useKensaStore((s) => s.showCodePreview);
  const setSwitching = useKensaStore((s) => s.setSwitching);
  const clearAllFilters = useKensaStore((s) => s.clearAllFilters);
  const toggleSummaryPanel = useKensaStore((s) => s.toggleSummaryPanel);
  const toggleOperationsPanel = useKensaStore((s) => s.toggleOperationsPanel);
  const toggleCodePreview = useKensaStore((s) => s.toggleCodePreview);

  const rowCount = slice?.totalRows ?? 0;
  const colCount = slice?.columns.length ?? 0;
  const filterCount = activeFilters.length;
  const hasView = filterCount > 0 || activeSort !== null;

  // Whole-dataset completeness — non-missing cells / total cells.
  //
  // Insights are computed on the ORIGINAL slice, not on the post-filter
  // one. When a filter is active `rowCount` drops but `insights[i].missing`
  // still reflects the unfiltered counts, so a naive subtraction could
  // produce `totalMissing > totalCells` and a negative percentage
  // (e.g. "-43% complete" if >half the rows got filtered out). We mark
  // the number as stale in that case and show the last known good value
  // clamped to [0, 100]. The right long-term fix is refreshing insights
  // on every filter change, but that requires backend work; clamping
  // here prevents the visible regression until then.
  const insights = useKensaStore((s) => s.insights);
  const { completenessLabel, completenessIsStale } = (() => {
    if (rowCount === 0 || colCount === 0 || insights.length === 0) {
      return { completenessLabel: '—', completenessIsStale: false };
    }
    const totalCells = rowCount * colCount;
    const totalMissing = insights.reduce((sum, ins) => sum + ins.missing, 0);
    if (totalCells === 0) return { completenessLabel: '—', completenessIsStale: false };
    const stale = totalMissing > totalCells;
    const missingClamped = Math.min(totalMissing, totalCells);
    const nonMissing = Math.max(0, totalCells - missingClamped);
    return {
      completenessLabel: formatPercent(nonMissing, totalCells),
      completenessIsStale: stale
    };
  })();
  const completenessClass = (() => {
    if (completenessLabel === '—' || completenessIsStale) return '';
    const num = parseFloat(completenessLabel);
    if (Number.isNaN(num)) return '';
    if (num >= 95) return 'kensa-toolbar-stat-value-success';
    if (num >= 80) return 'kensa-toolbar-stat-value-primary';
    return 'kensa-toolbar-stat-value-warning';
  })();

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
        <ColumnSearchPill />
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
            <FilterIcon size={14} />
            <span className="kensa-filter-badge-label">
              {filterCount > 0 ? (
                <>
                  {filterCount} filter{filterCount === 1 ? '' : 's'}
                  {/* Filtered/total counter gives the user the "hit rate"
                      of their filter at a glance without opening the
                      summary panel. Omitted when only sort is active
                      because sort doesn't change row count. */}
                  <span className="kensa-filter-badge-ratio">
                    {rowCount.toLocaleString()}
                  </span>
                </>
              ) : (
                'Sorted'
              )}
            </span>
            <span className="kensa-filter-badge-close">×</span>
          </button>
        )}
        <div
          className={`kensa-engine-indicator kensa-engine-${engine}`}
          title={
            engine === 'rust'
              ? 'Rust engine — instant native viewing'
              : 'Python engine — code generation'
          }
        >
          {engine === 'rust' ? <BoltIcon size={14} /> : <TerminalIcon size={14} />}
          <span className="kensa-engine-label">{engine === 'rust' ? 'Rust' : 'Python'}</span>
        </div>
        <div className="kensa-toolbar-stats" aria-label="Dataset summary">
          <div className="kensa-toolbar-stat" title={`${rowCount.toLocaleString()} rows`}>
            <span className="kensa-toolbar-stat-value kensa-toolbar-stat-value-primary">
              {formatCompact(rowCount)}
            </span>
            <span className="kensa-toolbar-stat-label">rows</span>
          </div>
          <span className="kensa-toolbar-stat-divider" />
          <div className="kensa-toolbar-stat" title={`${colCount} columns`}>
            <span className="kensa-toolbar-stat-value">{colCount}</span>
            <span className="kensa-toolbar-stat-label">cols</span>
          </div>
          <span className="kensa-toolbar-stat-divider" />
          <div
            className="kensa-toolbar-stat"
            title="Share of non-missing cells across the whole dataset"
          >
            <span className={`kensa-toolbar-stat-value ${completenessClass}`}>
              {completenessLabel}
            </span>
            <span className="kensa-toolbar-stat-label">complete</span>
          </div>
        </div>
        <IconButton
          label={
            source === 'variable'
              ? 'Refresh from notebook variable'
              : 'Re-read file from disk'
          }
          onClick={() => postMessage({ type: 'refreshSource' })}
        >
          <RefreshIcon />
        </IconButton>
        <IconButton
          label="Operations panel"
          active={showOperationsPanel}
          onClick={toggleOperationsPanel}
        >
          <OperationsIcon />
        </IconButton>
        <IconButton
          label="Code preview panel"
          active={showCodePreview}
          onClick={toggleCodePreview}
        >
          <CodeIcon />
        </IconButton>
        <IconButton
          label="Summary panel"
          active={showSummaryPanel}
          onClick={toggleSummaryPanel}
        >
          <SummaryIcon />
        </IconButton>
        <IconButton
          label="Export data to file"
          onClick={() => postMessage({ type: 'exportData', format: 'csv' })}
        >
          <ExportIcon />
        </IconButton>
      </div>
    </div>
  );
}

/** Search pill that jumps to a column by name match. Typing triggers a
 *  smooth horizontal scroll on the DataGrid and a brief pink pulse on
 *  the matching column header. Debounced at 140ms so fast typing
 *  doesn't whiplash the grid; searches match by exact → prefix →
 *  contains, in that order, so typing a unique prefix lands on the
 *  right column even on a 50-column dataset. */
function ColumnSearchPill() {
  const query = useKensaStore((s) => s.columnSearchQuery);
  const setQuery = useKensaStore((s) => s.setColumnSearchQuery);
  const requestScrollToColumn = useKensaStore((s) => s.requestScrollToColumn);
  const columns = useKensaStore((s) => s.slice?.columns ?? []);

  // Debounce the scroll request so the grid doesn't re-layout on every
  // keystroke. React's state update is still synchronous, so the input
  // itself stays instantly responsive.
  useEffect(() => {
    if (!query.trim()) return;
    const handle = window.setTimeout(() => {
      requestScrollToColumn(query);
    }, 140);
    return () => window.clearTimeout(handle);
  }, [query, requestScrollToColumn]);

  if (columns.length === 0) return null;

  return (
    <div className="kensa-col-search" title="Search for a column by name">
      <span className="kensa-col-search-icon" aria-hidden>
        <SearchIcon size={12} />
      </span>
      <input
        type="text"
        className="kensa-col-search-input"
        placeholder="Find column…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && query.trim()) requestScrollToColumn(query);
          if (e.key === 'Escape') setQuery('');
        }}
      />
      {query && (
        <button
          type="button"
          className="kensa-col-search-clear"
          onClick={() => setQuery('')}
          aria-label="Clear search"
          title="Clear"
        >
          ×
        </button>
      )}
    </div>
  );
}

/** Square icon button used in the toolbar. Accepts an SVG icon as its
 *  child (see `icons.tsx`). When `active` is true the button renders with
 *  the VS Code active-toolbar background so you can tell the panel it
 *  toggles is currently visible. */
function IconButton({
  label,
  onClick,
  active,
  children
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly active?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`kensa-icon-btn ${active ? 'kensa-icon-btn-active' : ''}`}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active ?? undefined}
    >
      {children}
    </button>
  );
}
