// One column header in the data grid. Shows the column name, dtype, a tiny
// insight visualization (histogram or frequency bar), a drag handle for
// resizing, and a dropdown menu for sort/filter.

import { useRef, useState } from 'react';
import { useKensaStore } from '../state/store';
import { postMessage } from '../vscodeApi';
import { QuickInsightViz } from './QuickInsightViz';
import type { ColumnInfo } from '../../shared/types';

interface ColumnHeaderProps {
  readonly column: ColumnInfo;
  readonly width: number;
  readonly selected: boolean;
  readonly onResize: (newWidth: number) => void;
  readonly onSelect: () => void;
}

export function ColumnHeader({ column, width, selected, onResize, onSelect }: ColumnHeaderProps) {
  const insight = useKensaStore((s) =>
    s.insights.find((i) => i.columnIndex === column.index) ?? null
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const resizingRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { startX: e.clientX, startWidth: width };
    const onMove = (ev: MouseEvent) => {
      const state = resizingRef.current;
      if (!state) return;
      onResize(state.startWidth + (ev.clientX - state.startX));
    };
    const onUp = () => {
      resizingRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const sort = (ascending: boolean) => {
    setMenuOpen(false);
    postMessage({ type: 'applySort', sort: { columnIndex: column.index, ascending } });
  };

  const filterNotMissing = () => {
    setMenuOpen(false);
    postMessage({
      type: 'applyFilter',
      filters: [{ columnIndex: column.index, op: 'is_not_missing' }]
    });
  };

  return (
    <div
      className={`kensa-col-header ${selected ? 'kensa-col-header-selected' : ''}`}
      style={{ width, minWidth: width }}
      onClick={onSelect}
    >
      <div className="kensa-col-header-top">
        <div className="kensa-col-name" title={column.name}>
          {column.name}
        </div>
        <button
          type="button"
          className="kensa-col-menu-btn"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((o) => !o);
          }}
          aria-label="Column menu"
        >
          ▾
        </button>
      </div>
      <div className="kensa-col-dtype">{column.dtype}</div>
      <div className="kensa-col-insight">
        {insight ? <QuickInsightViz insight={insight} /> : <div className="kensa-insight-placeholder" />}
      </div>

      {menuOpen && (
        <div className="kensa-col-menu" onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => sort(true)}>Sort ascending</button>
          <button type="button" onClick={() => sort(false)}>Sort descending</button>
          <button type="button" onClick={filterNotMissing}>Filter: not missing</button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              postMessage({ type: 'applySort', sort: null });
            }}
          >
            Reset view
          </button>
        </div>
      )}

      <div className="kensa-col-resize-handle" onMouseDown={onDragStart} />
    </div>
  );
}
