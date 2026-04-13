// One column header in the data grid. Renders the column name, dtype, a
// tiny insight visualization (histogram or frequency bar), a drag handle
// for resizing, and a dropdown menu with sort + quick-filter controls.
//
// The dropdown is a proper popover with a click-outside scrim and a visible
// arrow pointing at the trigger, so it doesn't get mistaken for grid data.
// Menu sections: Sort → Quick filters → (if this column is filtered) Clear
// column filter.

import { useRef, useState } from 'react';
import { useKensaStore } from '../state/store';
import { QuickInsightViz } from './QuickInsightViz';
import type { ColumnInfo, FilterSpec } from '../../shared/types';

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
  // The CURRENT quick-filter op on this column (if any). Used to render a
  // ✓ next to the active item and to toggle it off on the second click.
  const activeOp = useKensaStore(
    (s) =>
      s.activeFilters.find((f) => f.columnIndex === column.index)?.op ?? null
  );
  const activeSort = useKensaStore((s) =>
    s.activeSort?.columnIndex === column.index ? s.activeSort : null
  );
  const hasFilter = activeOp !== null;
  const addOrReplaceColumnFilter = useKensaStore((s) => s.addOrReplaceColumnFilter);
  const removeColumnFilter = useKensaStore((s) => s.removeColumnFilter);
  const applySort = useKensaStore((s) => s.applySort);

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

  const toggleSort = (ascending: boolean) => {
    setMenuOpen(false);
    // Toggle: if this column is already sorted the same way, clear it;
    // otherwise apply the new direction.
    if (activeSort && activeSort.ascending === ascending) {
      applySort(null);
    } else {
      applySort({ columnIndex: column.index, ascending });
    }
  };

  const toggleQuickFilter = (op: FilterSpec['op']) => {
    setMenuOpen(false);
    // Second click on the same op clears it; clicking a different op on
    // the same column replaces the previous choice.
    if (activeOp === op) {
      removeColumnFilter(column.index);
    } else {
      addOrReplaceColumnFilter({ columnIndex: column.index, op });
    }
  };

  return (
    <div
      className={`kensa-col-header ${selected ? 'kensa-col-header-selected' : ''} ${
        hasFilter ? 'kensa-col-header-filtered' : ''
      }`}
      style={{ width, minWidth: width }}
      onClick={onSelect}
    >
      <div className="kensa-col-header-top">
        <div className="kensa-col-name" title={column.name}>
          {hasFilter && <span className="kensa-col-filter-dot" title="Filter active" />}
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
        <>
          <div
            className="kensa-col-menu-scrim"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
            }}
          />
          <div
            className="kensa-col-menu"
            role="menu"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="kensa-col-menu-section">Sort</div>
            <SortItem
              active={activeSort?.ascending === true}
              label="Sort ascending"
              arrow="↑"
              onClick={() => toggleSort(true)}
            />
            <SortItem
              active={activeSort?.ascending === false}
              label="Sort descending"
              arrow="↓"
              onClick={() => toggleSort(false)}
            />
            <div className="kensa-col-menu-divider" />
            <div className="kensa-col-menu-section">Quick filters</div>
            <ToggleItem
              active={activeOp === 'is_not_missing'}
              label="Hide missing"
              onClick={() => toggleQuickFilter('is_not_missing')}
            />
            <ToggleItem
              active={activeOp === 'is_missing'}
              label="Only missing"
              onClick={() => toggleQuickFilter('is_missing')}
            />
            <ToggleItem
              active={activeOp === 'is_duplicated'}
              label="Only duplicates"
              onClick={() => toggleQuickFilter('is_duplicated')}
            />
            <ToggleItem
              active={activeOp === 'is_unique'}
              label="Only unique values"
              onClick={() => toggleQuickFilter('is_unique')}
            />
            {hasFilter && (
              <>
                <div className="kensa-col-menu-divider" />
                <button
                  type="button"
                  className="kensa-col-menu-danger"
                  onClick={() => {
                    setMenuOpen(false);
                    removeColumnFilter(column.index);
                  }}
                >
                  <span className="kensa-col-menu-icon">×</span>Clear filter on this column
                </button>
              </>
            )}
          </div>
        </>
      )}

      <div className="kensa-col-resize-handle" onMouseDown={onDragStart} />
    </div>
  );
}

/** A menu row that renders a ✓ on the left when active, doubling the
 *  click as a toggle. Shared by quick-filter rows in the column dropdown. */
function ToggleItem({
  active,
  label,
  onClick
}: {
  readonly active: boolean;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`kensa-col-menu-toggle ${active ? 'kensa-col-menu-toggle-active' : ''}`}
      onClick={onClick}
      aria-checked={active}
      role="menuitemcheckbox"
    >
      <span className="kensa-col-menu-icon">{active ? '✓' : ''}</span>
      {label}
    </button>
  );
}

/** Sort menu row — same toggle behavior as ToggleItem but uses an arrow
 *  glyph (↑/↓) that dims when inactive so you can still tell the direction. */
function SortItem({
  active,
  label,
  arrow,
  onClick
}: {
  readonly active: boolean;
  readonly label: string;
  readonly arrow: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`kensa-col-menu-toggle ${active ? 'kensa-col-menu-toggle-active' : ''}`}
      onClick={onClick}
      aria-checked={active}
      role="menuitemcheckbox"
    >
      <span className="kensa-col-menu-icon">{active ? '✓' : arrow}</span>
      {label}
    </button>
  );
}
