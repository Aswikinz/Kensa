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
// Diff overlay: when a preview is active, the store exposes `previewSlice`
// and `previewDiff`, which we render in place of the real slice. Cells that
// changed get `.diff-modified`; newly-added columns get `.diff-added`.

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

  const modifiedSet = useMemo(
    () => buildModifiedSet(diff?.modifiedCells, columnIndexByName),
    [diff?.modifiedCells, columnIndexByName]
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

  // Request a new slice if the user scrolled past the loaded window. We use
  // the base slice's loaded window because the preview slice is a fixed
  // snapshot that shouldn't trigger pagination.
  const loadedStart = previewSlice ? null : baseSlice.startRow;
  const loadedEnd = previewSlice ? null : baseSlice.startRow + baseSlice.rows.length;
  useEffect(() => {
    if (previewSlice) return;
    if (loadedStart === null || loadedEnd === null) return;
    const needsMore = firstVisibleRow < loadedStart || lastVisibleRow > loadedEnd;
    if (!needsMore) return;
    const start = Math.max(0, firstVisibleRow);
    const end = Math.min(slice.totalRows, start + PAGE_SIZE);
    postMessage({ type: 'requestDataSlice', start, end });
  }, [
    firstVisibleRow,
    lastVisibleRow,
    loadedStart,
    loadedEnd,
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
              const isModified = modifiedSet.has(`${rowIdx}:${colIdx}`);
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
          Previewing changes · {diff?.rowsChanged ?? 0} cells modified,{' '}
          {diff?.rowsAdded ?? 0} rows added, {diff?.rowsRemoved ?? 0} removed
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
