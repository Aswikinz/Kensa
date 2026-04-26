// Virtualized data grid.
//
// Layout:
//   .kensa-grid
//     └── .kensa-grid-scroll      (single scroll container, both axes)
//           └── .kensa-grid-content
//                 ├── .kensa-grid-header (position: sticky; top: 0)
//                 └── .kensa-grid-rows   (height = totalRows * ROW_HEIGHT)
//                       ├── row N      (position: absolute; top = N * H)
//                       └── ...
//
// Putting the header inside the same scroll container as the rows means a
// single horizontal scroll naturally moves both — no transform syncing
// required — and `position: sticky; top: 0` keeps it pinned during vertical
// scrolling. Only the visible window of rows is rendered; everything else is
// a cheap absolute-positioned layer.
//
// Preview mode: when a preview is active, the store holds `previewSlice`
// (paginated — the full preview_df stays on the Python side) plus
// `previewChangedMask`, a rectangular boolean array for the currently-
// loaded window. Scrolling past the loaded window sends a
// `requestPreviewSlice` message and the extension serves the next page
// from the stashed preview_df — the operation is NOT re-executed.
// Cell highlights come from the mask, not from a JS-side diff, so they
// remain accurate for every paginated chunk.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ColumnHeader } from './ColumnHeader';
import { useKensaStore } from '../state/store';
import { postMessage } from '../vscodeApi';
import { showToast } from './Toast';
import { CellContextMenu, type CellContextTarget } from './CellContextMenu';
import { alignForDtype, missingLabelForDtype, truncateForToast } from '../formatters';
import type { DataSlice, DiffSummary, FilterOp } from '../../shared/types';

/** Build a Set<"row:col"> from the diff so cell rendering is O(1) per cell. */
function buildModifiedSet(
  modifiedCells: ReadonlyArray<{ row: number; column: string }> | undefined,
  columnIndexByName: Map<string, number>
): Set<string> {
  const out = new Set<string>();
  if (!modifiedCells) return out;
  for (const { row, column } of modifiedCells) {
    const colIdx = columnIndexByName.get(column);
    if (colIdx !== undefined) out.add(`${row}:${colIdx}`);
  }
  return out;
}

const ROW_HEIGHT = 28;
const ROW_NUMBER_WIDTH = 60;
// 184px fits the worst-case stats row ("99.8% missing · 99.8% unique")
// on a single line with padding to spare. The earlier 160px default
// clipped the trailing "unique" word on high-missing columns.
const DEFAULT_COL_WIDTH = 184;
const OVERSCAN = 6;
const PAGE_SIZE = 500;
const COLUMN_HIGHLIGHT_MS = 1200;

interface DataGridProps {
  readonly slice: DataSlice;
}

export function DataGrid({ slice: baseSlice }: DataGridProps) {
  // When a preview is active, we render its slice instead of the base one.
  // Everything downstream (virtualization, column headers) operates on
  // `slice` so the preview reuses the same layout code paths.
  const previewSlice = useKensaStore((s) => s.previewSlice);
  const previewDiff = useKensaStore((s) => s.previewDiff);
  const previewChangedMask = useKensaStore((s) => s.previewChangedMask);
  const appliedDiff = useKensaStore((s) => s.diff);
  const slice = previewSlice ?? baseSlice;
  const diff: DiffSummary | null = previewSlice ? previewDiff : appliedDiff;

  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(400);
  const [headerHeight, setHeaderHeight] = useState(80);
  const [columnWidths, setColumnWidths] = useState<number[]>(() =>
    slice.columns.map(() => DEFAULT_COL_WIDTH)
  );
  const selectedColumn = useKensaStore((s) => s.selectedColumn);
  const setSelectedColumn = useKensaStore((s) => s.setSelectedColumn);
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  // Tracks the most-recently-copied cell so the CSS flash animation can
  // retrigger cleanly — setting to null after the animation duration lets
  // a second copy on the same cell re-fire the keyframes.
  const [justCopied, setJustCopied] = useState<{ row: number; col: number } | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  const copyCellToClipboard = (value: string, row: number, col: number) => {
    // `navigator.clipboard.writeText` returns a promise but we fire-and-
    // forget — the toast shows immediately on success, and if the write
    // fails the catch replaces the success toast with a warning. We don't
    // `await` because we want the flash animation to start on the same
    // frame as the click for a snappy feel.
    navigator.clipboard
      .writeText(value)
      .then(() => {
        showToast('Copied', { value: truncateForToast(value), icon: '✓' });
      })
      .catch(() => {
        showToast('Copy blocked by browser', { icon: '!' });
      });
    setJustCopied({ row, col });
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setJustCopied(null), 700);
  };

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  // Right-click context menu state. When open, `contextTarget` carries
  // which cell was right-clicked plus the cursor position so the menu
  // can anchor there. Clicking anywhere or pressing Escape closes it.
  const [contextTarget, setContextTarget] = useState<CellContextTarget | null>(null);
  const addFilter = useKensaStore((s) => s.addFilter);
  const activeFilters = useKensaStore((s) => s.activeFilters);
  const removeColumnFilter = useKensaStore((s) => s.removeColumnFilter);
  const applySort = useKensaStore((s) => s.applySort);

  const writeClipboard = (text: string, successToast: { label: string; value?: string }) => {
    navigator.clipboard
      .writeText(text)
      .then(() => showToast(successToast.label, { value: successToast.value, icon: '✓' }))
      .catch(() => showToast('Copy blocked by browser', { icon: '!' }));
  };

  const copyRowAt = (rowIdx: number): void => {
    const pageStart = Math.floor(rowIdx / PAGE_SIZE) * PAGE_SIZE;
    const localIdx = rowIdx - pageStart;
    const row = slice.rows[localIdx];
    if (!row) return;
    const tsv = row
      .map((v) => (v === null || v === undefined ? '' : String(v)))
      .join('\t');
    writeClipboard(tsv, { label: 'Row copied', value: `row ${rowIdx + 1} · ${row.length} cells` });
  };

  const copyColumnAt = (colIdx: number): void => {
    // Copies every currently-loaded value in the column plus the header.
    // For paginated/virtualized slices this is the current slice window,
    // which is usually what the user wants (copy the visible column).
    const header = slice.columns[colIdx]?.name ?? '';
    const values = slice.rows.map((r) => {
      const v = r[colIdx];
      return v === null || v === undefined ? '' : String(v);
    });
    writeClipboard([header, ...values].join('\n'), {
      label: 'Column copied',
      value: `${header} · ${values.length} values`
    });
  };

  // Column-search integration. The toolbar's search input writes to the
  // store via `requestScrollToColumn`, bumping a monotonic token. This
  // effect listens for token changes, finds the matching column by
  // prefix-or-contains match on its name (case-insensitive), and scrolls
  // its header into view. The highlighted-column state is cleared after
  // the pulse animation completes so a second search re-triggers.
  const scrollToColumnName = useKensaStore((s) => s.scrollToColumnName);
  const scrollToColumnToken = useKensaStore((s) => s.scrollToColumnToken);
  const [highlightedColumn, setHighlightedColumn] = useState<number | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!scrollToColumnName || scrollToColumnToken === 0) return;
    const query = scrollToColumnName.toLowerCase();
    const idx =
      slice.columns.findIndex((c) => c.name.toLowerCase() === query) >= 0
        ? slice.columns.findIndex((c) => c.name.toLowerCase() === query)
        : slice.columns.findIndex((c) =>
            c.name.toLowerCase().startsWith(query)
          ) >= 0
        ? slice.columns.findIndex((c) => c.name.toLowerCase().startsWith(query))
        : slice.columns.findIndex((c) =>
            c.name.toLowerCase().includes(query)
          );
    if (idx < 0) return;
    // Compute the left offset of the matched column header by summing
    // the widths of every column to its left (+ row number column).
    const leftOffset = columnWidths
      .slice(0, idx)
      .reduce((acc, w) => acc + (w ?? DEFAULT_COL_WIDTH), ROW_NUMBER_WIDTH);
    scrollRef.current?.scrollTo({
      left: Math.max(0, leftOffset - 40),
      behavior: 'smooth'
    });
    setHighlightedColumn(idx);
    if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedColumn(null);
    }, COLUMN_HIGHLIGHT_MS);
    // Only `scrollToColumnToken` is in the deps list on purpose — the
    // effect should re-fire only when a new search is requested, not
    // when `slice` / `columnWidths` change under us.
  }, [scrollToColumnToken]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const columnIndexByName = useMemo(() => {
    const m = new Map<string, number>();
    slice.columns.forEach((c, i) => m.set(c.name, i));
    return m;
  }, [slice.columns]);

  // The applied-diff (post-Apply) path still uses `modifiedCells` — that
  // comes from the extension-side cell compare in webviewProvider.
  // The PREVIEW path uses `previewChangedMask` instead: a rectangular
  // boolean array indexed by (localRowIndex, colIndex) where
  // localRowIndex is `rowIdx - slice.startRow`. Computed once on the
  // Python side per window and shipped alongside the slice, so it
  // remains accurate even when the user paginates past the first page.
  const modifiedSet = useMemo(
    () => (previewSlice ? new Set<string>() : buildModifiedSet(diff?.modifiedCells, columnIndexByName)),
    [previewSlice, diff?.modifiedCells, columnIndexByName]
  );

  const addedColumns = useMemo(
    () => new Set(diff?.columnsAdded ?? []),
    [diff?.columnsAdded]
  );

  // Reset column widths when the column count changes (e.g. after a drop-column
  // operation). The user's manual widths are lost on structural edits.
  useEffect(() => {
    setColumnWidths((prev) =>
      slice.columns.length === prev.length ? prev : slice.columns.map(() => DEFAULT_COL_WIDTH)
    );
  }, [slice.columns.length]);

  // Measure the scroll container and the sticky header on every render that
  // might change their intrinsic sizes (column widths, slice, window size).
  useLayoutEffect(() => {
    const measure = () => {
      if (scrollRef.current) setContainerHeight(scrollRef.current.clientHeight);
      if (headerRef.current) setHeaderHeight(headerRef.current.offsetHeight);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [slice.columns, columnWidths]);

  // Vertical virtualization. `scrollTop` is measured relative to the scroll
  // container, which includes the sticky header's height. The rows container
  // sits below the header, so to map scrollTop -> a row index we subtract
  // headerHeight (clamped at zero so we don't go negative when scrolled to
  // the very top).
  const rowsScrollOffset = Math.max(0, scrollTop - headerHeight);
  const visibleRowAreaHeight = Math.max(0, containerHeight - headerHeight);
  const firstVisibleRow = Math.max(
    0,
    Math.floor(rowsScrollOffset / ROW_HEIGHT) - OVERSCAN
  );
  const lastVisibleRow = Math.min(
    slice.totalRows,
    Math.ceil((rowsScrollOffset + visibleRowAreaHeight) / ROW_HEIGHT) + OVERSCAN
  );

  // Pagination. Both the base slice (normal browsing) and the preview
  // slice (what-if overlay) paginate — if the user scrolls past the loaded
  // window we ask the extension for another page. The message type
  // differs: `requestDataSlice` for base, `requestPreviewSlice` for
  // preview. Python serves preview pages from the stashed preview_df
  // without re-running the operation.
  const activeLoadedStart = slice.startRow;
  const activeLoadedEnd = slice.startRow + slice.rows.length;
  useEffect(() => {
    const needsMore =
      firstVisibleRow < activeLoadedStart || lastVisibleRow > activeLoadedEnd;
    if (!needsMore) return;
    const start = Math.max(0, firstVisibleRow);
    const end = Math.min(slice.totalRows, start + PAGE_SIZE);
    if (previewSlice) {
      postMessage({ type: 'requestPreviewSlice', start, end });
    } else {
      postMessage({ type: 'requestDataSlice', start, end });
    }
  }, [
    firstVisibleRow,
    lastVisibleRow,
    activeLoadedStart,
    activeLoadedEnd,
    slice.totalRows,
    previewSlice
  ]);

  const totalColumnWidth = useMemo(
    () => columnWidths.reduce((a, b) => a + b, 0),
    [columnWidths]
  );
  const totalContentWidth = ROW_NUMBER_WIDTH + totalColumnWidth;

  const handleResize = (colIndex: number, newWidth: number) => {
    setColumnWidths((prev) => {
      const next = [...prev];
      next[colIndex] = Math.max(40, newWidth);
      return next;
    });
  };

  const renderRows: React.ReactNode[] = [];
  for (let rowIdx = firstVisibleRow; rowIdx < lastVisibleRow; rowIdx++) {
    const localIdx = rowIdx - slice.startRow;
    const row = slice.rows[localIdx];
    const rowStyle: CSSProperties = {
      position: 'absolute',
      top: rowIdx * ROW_HEIGHT,
      left: 0,
      height: ROW_HEIGHT,
      width: totalContentWidth,
      display: 'flex'
    };
    renderRows.push(
      <div
        className={`kensa-row ${rowIdx % 2 ? 'kensa-row-alt' : ''}`}
        key={rowIdx}
        style={rowStyle}
      >
        <div
          className="kensa-row-number kensa-row-number-clickable"
          style={{ width: ROW_NUMBER_WIDTH, minWidth: ROW_NUMBER_WIDTH }}
          title={row ? 'Click to copy the whole row as tab-separated text' : ''}
          onClick={(e) => {
            e.stopPropagation();
            if (!row) return;
            copyRowAt(rowIdx);
          }}
        >
          {rowIdx + 1}
        </div>
        {row
          ? slice.columns.map((col, colIdx) => {
              const value = row[colIdx];
              const isMissing = value === null || value === undefined;
              const isSelected =
                selectedCell && selectedCell.row === rowIdx && selectedCell.col === colIdx;
              const maskRow = previewSlice ? previewChangedMask[localIdx] : undefined;
              const isModified = previewSlice
                ? maskRow?.[colIdx] === true
                : modifiedSet.has(`${rowIdx}:${colIdx}`);
              const isAdded = addedColumns.has(col.name);
              const wasJustCopied =
                justCopied && justCopied.row === rowIdx && justCopied.col === colIdx;
              const align = alignForDtype(col.dtype);
              const classes = ['kensa-cell', `kensa-cell-align-${align}`];
              if (isMissing) classes.push('kensa-cell-missing');
              if (isSelected) classes.push('kensa-cell-selected');
              if (isModified) classes.push('diff-modified');
              if (isAdded) classes.push('diff-added');
              if (wasJustCopied) classes.push('kensa-cell-just-copied');
              return (
                <div
                  key={colIdx}
                  className={classes.join(' ')}
                  style={{ width: columnWidths[colIdx], minWidth: columnWidths[colIdx] }}
                  onClick={() => {
                    // Left-click selects the cell only. Copying is
                    // deliberately routed through the right-click menu
                    // (or the row-number click for full-row copy) —
                    // auto-copying on every selection click was noisy
                    // and interfered with the natural "click to see
                    // column details in the side panel" flow.
                    setSelectedCell({ row: rowIdx, col: colIdx });
                    setSelectedColumn(colIdx);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setSelectedCell({ row: rowIdx, col: colIdx });
                    setSelectedColumn(colIdx);
                    setContextTarget({
                      rowIdx,
                      colIdx,
                      columnName: col.name,
                      columnDtype: col.dtype,
                      value: isMissing ? null : String(value),
                      cursorX: e.clientX,
                      cursorY: e.clientY
                    });
                  }}
                  title={isMissing ? `missing (${missingLabelForDtype(col.dtype).text})` : `${String(value ?? '')}  (right-click for copy / filter / sort)`}
                >
                  {isMissing ? (
                    <span
                      className={`kensa-missing-label kensa-missing-label-${
                        missingLabelForDtype(col.dtype).kind
                      }`}
                    >
                      {missingLabelForDtype(col.dtype).text}
                    </span>
                  ) : (
                    value
                  )}
                </div>
              );
            })
          : slice.columns.map((_, colIdx) => (
              <div
                key={colIdx}
                className="kensa-cell kensa-cell-placeholder"
                style={{ width: columnWidths[colIdx], minWidth: columnWidths[colIdx] }}
              />
            ))}
      </div>
    );
  }

  const rowsLayerHeight = slice.totalRows * ROW_HEIGHT;

  return (
    <div className="kensa-grid">
      {previewSlice && (
        <div className="kensa-preview-banner">
          <strong>Previewing changes</strong>
          {' · '}
          {summarizeDiff(diff)}
        </div>
      )}
      <div
        ref={scrollRef}
        className="kensa-grid-scroll"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div
          className="kensa-grid-content"
          style={{ width: totalContentWidth, minWidth: totalContentWidth }}
        >
          <div
            ref={headerRef}
            className="kensa-grid-header"
            style={{ width: totalContentWidth, minWidth: totalContentWidth }}
          >
            <div
              className="kensa-row-number kensa-row-number-header"
              style={{ width: ROW_NUMBER_WIDTH, minWidth: ROW_NUMBER_WIDTH }}
            >
              #
            </div>
            {slice.columns.map((col, i) => (
              <ColumnHeader
                key={i}
                column={col}
                width={columnWidths[i] ?? DEFAULT_COL_WIDTH}
                onResize={(w) => handleResize(i, w)}
                selected={selectedColumn === i}
                onSelect={() => setSelectedColumn(i)}
                highlight={highlightedColumn === i}
              />
            ))}
          </div>
          <div
            className="kensa-grid-rows"
            style={{
              position: 'relative',
              height: rowsLayerHeight,
              width: totalContentWidth,
              minWidth: totalContentWidth
            }}
          >
            {renderRows}
          </div>
        </div>
      </div>

      {contextTarget && (
        <CellContextMenu
          target={contextTarget}
          onClose={() => setContextTarget(null)}
          onCopyValue={() => {
            if (contextTarget.value != null) {
              copyCellToClipboard(contextTarget.value, contextTarget.rowIdx, contextTarget.colIdx);
            }
          }}
          onCopyRow={() => copyRowAt(contextTarget.rowIdx)}
          onCopyColumn={() => copyColumnAt(contextTarget.colIdx)}
          onCopyColumnName={() => {
            const name = slice.columns[contextTarget.colIdx]?.name ?? '';
            writeClipboard(name, {
              label: 'Column name copied',
              value: truncateForToast(name)
            });
          }}
          onFilter={(op: FilterOp) => {
            if (contextTarget.value == null) return;
            addFilter({
              columnIndex: contextTarget.colIdx,
              op,
              value: contextTarget.value,
              caseInsensitive: true
            });
          }}
          onSort={(ascending) =>
            applySort({ columnIndex: contextTarget.colIdx, ascending })
          }
          onClearColumnFilters={() => removeColumnFilter(contextTarget.colIdx)}
          hasColumnFilters={activeFilters.some(
            (f) => f.columnIndex === contextTarget.colIdx
          )}
        />
      )}
    </div>
  );
}

/** Build a human-readable summary of a DiffSummary for the preview banner.
 *  Prioritizes the most structurally relevant change: columns added, then
 *  rows added/removed, then modified cell count. When the operation keeps
 *  row count constant we highlight individual cells in yellow; when row
 *  count changes we report the delta in the banner instead (the grid's
 *  cell colors would be misleading). */
function summarizeDiff(diff: DiffSummary | null): string {
  if (!diff) return 'waiting for backend...';
  const parts: string[] = [];
  if (diff.columnsAdded.length > 0) {
    parts.push(
      `${diff.columnsAdded.length} column${diff.columnsAdded.length === 1 ? '' : 's'} added (${diff.columnsAdded.join(', ')})`
    );
  }
  if (diff.columnsRemoved.length > 0) {
    parts.push(
      `${diff.columnsRemoved.length} column${diff.columnsRemoved.length === 1 ? '' : 's'} removed`
    );
  }
  if (diff.rowsAdded > 0) parts.push(`+${diff.rowsAdded} rows`);
  if (diff.rowsRemoved > 0) parts.push(`−${diff.rowsRemoved} rows`);
  if (diff.rowsChanged > 0) {
    parts.push(
      `${diff.rowsChanged} cell${diff.rowsChanged === 1 ? '' : 's'} modified`
    );
  }
  if (parts.length === 0) return 'no structural change';
  return parts.join(' · ');
}
