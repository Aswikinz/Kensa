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
import type { DataSlice, DiffSummary } from '../../shared/types';

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
const DEFAULT_COL_WIDTH = 160;
const OVERSCAN = 6;
const PAGE_SIZE = 500;

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
          className="kensa-row-number"
          style={{ width: ROW_NUMBER_WIDTH, minWidth: ROW_NUMBER_WIDTH }}
        >
          {rowIdx + 1}
        </div>
        {row
          ? slice.columns.map((col, colIdx) => {
              const value = row[colIdx];
              const isMissing = value === null || value === undefined;
              const isSelected =
                selectedCell && selectedCell.row === rowIdx && selectedCell.col === colIdx;
              // In preview mode, consult the per-window mask; outside
              // preview mode, fall back to the applied-diff set. Both
              // paths are O(1) per cell.
              const maskRow = previewSlice ? previewChangedMask[localIdx] : undefined;
              const isModified = previewSlice
                ? maskRow?.[colIdx] === true
                : modifiedSet.has(`${rowIdx}:${colIdx}`);
              const isAdded = addedColumns.has(col.name);
              const classes = ['kensa-cell'];
              if (isMissing) classes.push('kensa-cell-missing');
              if (isSelected) classes.push('kensa-cell-selected');
              if (isModified) classes.push('diff-modified');
              if (isAdded) classes.push('diff-added');
              return (
                <div
                  key={colIdx}
                  className={classes.join(' ')}
                  style={{ width: columnWidths[colIdx], minWidth: columnWidths[colIdx] }}
                  onClick={() => {
                    setSelectedCell({ row: rowIdx, col: colIdx });
                    setSelectedColumn(colIdx);
                  }}
                  title={isMissing ? 'missing' : value ?? ''}
                >
                  {isMissing ? '—' : value}
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
