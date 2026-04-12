// Virtualized data grid. Hand-rolled virtualization instead of a dependency —
// rows are absolute-positioned inside a large scroll container, and only the
// visible window + a small overscan buffer is rendered. Horizontal scrolling
// is native browser scroll on the cells container.
//
// Row/column sizing rules:
//   - Row height is a constant (ROW_HEIGHT).
//   - Column widths are per-column in `columnWidths` state; drag to resize.
//   - The header strip is position: sticky so it stays visible during
//     vertical scrolling.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ColumnHeader } from './ColumnHeader';
import { useKensaStore } from '../state/store';
import { postMessage } from '../vscodeApi';
import type { DataSlice } from '../../shared/types';

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

export function DataGrid({ slice }: DataGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(400);
  const [columnWidths, setColumnWidths] = useState<number[]>(() =>
    slice.columns.map(() => DEFAULT_COL_WIDTH)
  );
  const selectedColumn = useKensaStore((s) => s.selectedColumn);
  const setSelectedColumn = useKensaStore((s) => s.setSelectedColumn);
  const diff = useKensaStore((s) => s.diff);
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

  useEffect(() => {
    const update = () => {
      if (scrollRef.current) {
        setContainerHeight(scrollRef.current.clientHeight);
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Visible window computation. We lay out all rows (even ones outside the
  // loaded slice) as a tall spacer so the scrollbar reflects the true total
  // row count; only rendered rows become actual DOM nodes.
  const totalHeight = slice.totalRows * ROW_HEIGHT;
  const sliceOffset = slice.startRow * ROW_HEIGHT;
  const loadedRows = slice.rows.length;

  const firstVisibleRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const lastVisibleRow = Math.min(
    slice.totalRows,
    Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN
  );

  // Request a new slice if the user scrolled past the loaded window.
  useEffect(() => {
    const needsMore =
      firstVisibleRow < slice.startRow || lastVisibleRow > slice.startRow + loadedRows;
    if (!needsMore) return;
    const start = Math.max(0, firstVisibleRow);
    const end = Math.min(slice.totalRows, start + PAGE_SIZE);
    postMessage({ type: 'requestDataSlice', start, end });
  }, [firstVisibleRow, lastVisibleRow, slice.startRow, slice.totalRows, loadedRows]);

  const totalColumnWidth = useMemo(
    () => columnWidths.reduce((a, b) => a + b, 0),
    [columnWidths]
  );

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
    const style: CSSProperties = {
      position: 'absolute',
      top: rowIdx * ROW_HEIGHT,
      left: 0,
      right: 0,
      height: ROW_HEIGHT,
      display: 'flex'
    };
    renderRows.push(
      <div
        className={`kensa-row ${rowIdx % 2 ? 'kensa-row-alt' : ''}`}
        key={rowIdx}
        style={style}
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

  return (
    <div className="kensa-grid">
      <div
        className="kensa-grid-header"
        style={{ minWidth: ROW_NUMBER_WIDTH + totalColumnWidth }}
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
        ref={scrollRef}
        className="kensa-grid-body"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div
          className="kensa-grid-body-inner"
          style={{
            height: totalHeight,
            minWidth: ROW_NUMBER_WIDTH + totalColumnWidth,
            position: 'relative'
          }}
        >
          {renderRows}
        </div>
        {sliceOffset < 0 && <div />}
      </div>
    </div>
  );
}
