// One column header in the data grid.
//
// Renders the column name, dtype, quick-insight viz, a resize handle,
// and a dropdown menu containing:
//   - Active-filter chip row (one chip per filter currently applied
//     to this column — removable).
//   - Sort section (asc/desc toggles).
//   - Quick-filters section (is_missing / is_not_missing / is_duplicated /
//     is_unique — mutually exclusive within this section).
//   - Advanced-filter section (operator + value + case-insensitive,
//     stacks freely with the quick filter and with itself — the user
//     can hit "Apply" multiple times to pile up `X > 30`, `X < 60`, etc.).
//
// The advanced-filter form picks its operator options based on the
// column's inferred dtype so numeric columns don't offer "contains" and
// text columns don't offer numeric comparisons.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useKensaStore } from '../state/store';
import { QuickInsightViz } from './QuickInsightViz';
import { ThemedSelect } from './ThemedSelect';
import { showToast } from './Toast';
import { alignForDtype, truncateForToast } from '../formatters';
import type { ColumnInfo, FilterOp, FilterSpec } from '../../shared/types';

interface ColumnHeaderProps {
  readonly column: ColumnInfo;
  readonly width: number;
  readonly selected: boolean;
  readonly onResize: (newWidth: number) => void;
  readonly onSelect: () => void;
  readonly highlight: boolean;
}

const QUICK_OPS: FilterOp[] = ['is_missing', 'is_not_missing', 'is_duplicated', 'is_unique'];

export function ColumnHeader({
  column,
  width,
  selected,
  onResize,
  onSelect,
  highlight
}: ColumnHeaderProps) {
  const insight = useKensaStore((s) =>
    s.insights.find((i) => i.columnIndex === column.index) ?? null
  );
  const allFilters = useKensaStore((s) => s.activeFilters);
  const activeSort = useKensaStore((s) =>
    s.activeSort?.columnIndex === column.index ? s.activeSort : null
  );
  const addOrReplaceColumnFilter = useKensaStore((s) => s.addOrReplaceColumnFilter);
  const addFilter = useKensaStore((s) => s.addFilter);
  const removeColumnFilter = useKensaStore((s) => s.removeColumnFilter);
  const removeFilterAt = useKensaStore((s) => s.removeFilterAt);
  const applySort = useKensaStore((s) => s.applySort);

  // Filters active on *this* column specifically, with their global index
  // preserved so `removeFilterAt` can target the exact instance to drop.
  const columnFilters = useMemo(
    () =>
      allFilters
        .map((f, idx) => ({ filter: f, idx }))
        .filter(({ filter }) => filter.columnIndex === column.index),
    [allFilters, column.index]
  );
  const quickFilter = columnFilters.find(({ filter }) =>
    QUICK_OPS.includes(filter.op)
  );
  const activeQuickOp = quickFilter?.filter.op ?? null;
  const hasFilter = columnFilters.length > 0;

  const [menuOpen, setMenuOpen] = useState(false);
  const resizingRef = useRef<{ startX: number; startWidth: number } | null>(null);
  // Ref on the whole column-header element. The outside-click listener
  // uses it to figure out whether a click landed inside this column's
  // own DOM subtree (trigger button OR the popover menu rendered
  // absolutely-positioned underneath) — if it did, leave the menu
  // alone; otherwise close. The invisible scrim approach this replaces
  // was getting trapped in sibling stacking contexts on some layouts,
  // so clicks on underlying cells fell through to them instead of
  // closing the menu, forcing users to click the ▾ toggle again.
  const headerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      const root = headerRef.current;
      if (!root) return;
      if (!(e.target instanceof Node)) return;
      if (root.contains(e.target)) return;
      // Also leave the menu alone if the click landed in one of the
      // popovers that live OUTSIDE this header's DOM but logically
      // belong to it (the themed operator dropdown + the select-menu
      // `<ul>` that both render at document scope). Checking by
      // className keeps this decoupled from those components.
      const target = e.target as Element;
      if (
        typeof target.closest === 'function' &&
        (target.closest('.kensa-themed-select-panel') ||
          target.closest('.kensa-themed-select-scrim'))
      ) {
        return;
      }
      setMenuOpen(false);
    };
    // mousedown (not click) so the menu closes on the press, not the
    // release — feels snappier and sidesteps a race where the press's
    // onClick would re-open a just-closed menu.
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

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
    if (activeSort && activeSort.ascending === ascending) {
      applySort(null);
    } else {
      applySort({ columnIndex: column.index, ascending });
    }
  };

  const toggleQuickFilter = (op: FilterOp) => {
    setMenuOpen(false);
    if (activeQuickOp === op && quickFilter) {
      removeFilterAt(quickFilter.idx);
    } else {
      addOrReplaceColumnFilter({ columnIndex: column.index, op });
    }
  };

  const copyColumnName = () => {
    setMenuOpen(false);
    navigator.clipboard
      .writeText(column.name)
      .then(() =>
        showToast('Column name copied', {
          value: truncateForToast(column.name),
          icon: '✓'
        })
      )
      .catch(() => showToast('Copy blocked by browser', { icon: '!' }));
  };

  const align = alignForDtype(column.dtype);

  return (
    <div
      ref={headerRef}
      className={[
        'kensa-col-header',
        `kensa-col-header-align-${align}`,
        selected ? 'kensa-col-header-selected' : '',
        hasFilter ? 'kensa-col-header-filtered' : '',
        highlight ? 'kensa-col-header-highlight' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ width, minWidth: width }}
      onClick={onSelect}
    >
      <div className="kensa-col-header-top">
        <div
          className="kensa-col-name"
          title={`${column.name}  (double-click to copy name)`}
          // Double-click on the name itself is the lowest-friction way
          // to grab a column name — single click already selects + scrolls
          // the side panel, so we don't want to overload it.
          onDoubleClick={(e) => {
            e.stopPropagation();
            copyColumnName();
          }}
        >
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
            className="kensa-col-menu"
            role="menu"
            onClick={(e) => e.stopPropagation()}
          >
            {columnFilters.length > 0 && (
              <>
                <div className="kensa-filter-chips">
                  {columnFilters.map(({ filter, idx }) => (
                    <span className="kensa-filter-chip" key={idx} title="Click × to remove">
                      {describeFilter(filter)}
                      <button
                        type="button"
                        className="kensa-filter-chip-remove"
                        onClick={() => removeFilterAt(idx)}
                        aria-label="Remove filter"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div className="kensa-col-menu-divider" />
              </>
            )}

            <div className="kensa-col-menu-section">Column</div>
            <button
              type="button"
              className="kensa-col-menu-toggle"
              onClick={copyColumnName}
              role="menuitem"
            >
              <span className="kensa-col-menu-icon">⎘</span>
              Copy column name
            </button>

            <div className="kensa-col-menu-divider" />
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
              active={activeQuickOp === 'is_not_missing'}
              label="Hide missing"
              onClick={() => toggleQuickFilter('is_not_missing')}
            />
            <ToggleItem
              active={activeQuickOp === 'is_missing'}
              label="Only missing"
              onClick={() => toggleQuickFilter('is_missing')}
            />
            <ToggleItem
              active={activeQuickOp === 'is_duplicated'}
              label="Only duplicates"
              onClick={() => toggleQuickFilter('is_duplicated')}
            />
            <ToggleItem
              active={activeQuickOp === 'is_unique'}
              label="Only unique values"
              onClick={() => toggleQuickFilter('is_unique')}
            />

            <div className="kensa-col-menu-divider" />
            <div className="kensa-col-menu-section">Advanced filter</div>
            <AdvancedFilterForm
              dtype={column.dtype}
              onApply={(spec) => addFilter({ ...spec, columnIndex: column.index })}
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
                  <span className="kensa-col-menu-icon">×</span>
                  Clear all filters on this column
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

/** Advanced-filter sub-form: operator dropdown + value input + case-
 *  insensitive checkbox + Apply button. Operators are restricted by
 *  dtype — numeric/datetime columns only expose comparison ops, text
 *  columns expose contains/starts_with/ends_with/regex in addition
 *  to equality. The Apply button stacks the new filter onto whatever
 *  is already on the column (quick filter + any prior advanced ones). */
function AdvancedFilterForm({
  dtype,
  onApply
}: {
  readonly dtype: string;
  readonly onApply: (spec: Omit<FilterSpec, 'columnIndex'>) => void;
}) {
  const ops = useMemo(() => opsForDtype(dtype), [dtype]);
  const [op, setOp] = useState<FilterOp>(ops[0] ?? 'eq');
  const [value, setValue] = useState('');
  const [ci, setCi] = useState(true);

  const submit = () => {
    if (value.trim() === '') return;
    onApply({
      op,
      value,
      caseInsensitive: isTextOp(op) ? ci : undefined
    });
    setValue('');
  };

  const showCaseToggle = isTextOp(op);

  // Use our themed popover select instead of a native `<select>` — the
  // native one pops up with OS / browser styling for the option list,
  // which blatantly clashes with the dark column menu it lives inside.
  const opOptions = useMemo(
    () => ops.map((o) => ({ value: o, label: OP_LABELS[o] })),
    [ops]
  );

  return (
    <div className="kensa-adv-filter">
      <div className="kensa-adv-filter-row">
        <ThemedSelect
          value={op}
          options={opOptions}
          onChange={(v) => setOp(v)}
          ariaLabel="Filter operator"
        />
      </div>
      <div className="kensa-adv-filter-row">
        <input
          className="kensa-input"
          type="text"
          placeholder={placeholderForOp(op)}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
      </div>
      {showCaseToggle && (
        <label className="kensa-adv-filter-checkbox">
          <input
            type="checkbox"
            checked={ci}
            onChange={(e) => setCi(e.target.checked)}
          />
          Case insensitive
        </label>
      )}
      <div className="kensa-adv-filter-actions">
        <button
          type="button"
          className="kensa-adv-filter-btn kensa-adv-filter-btn-primary"
          onClick={submit}
          disabled={value.trim() === ''}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

const OP_LABELS: Record<FilterOp, string> = {
  eq: 'Equals',
  ne: 'Not equals',
  gt: 'Greater than',
  gte: 'Greater than or equal',
  lt: 'Less than',
  lte: 'Less than or equal',
  contains: 'Contains',
  starts_with: 'Starts with',
  ends_with: 'Ends with',
  regex: 'Matches regex',
  is_missing: 'Is missing',
  is_not_missing: 'Is not missing',
  is_duplicated: 'Is duplicated',
  is_unique: 'Is unique'
};

const NUMERIC_DTYPES = ['int64', 'int32', 'int16', 'int8', 'float64', 'float32', 'float', 'int'];
const DATETIME_DTYPES = ['datetime64[ns]', 'datetime', 'date'];

function opsForDtype(dtype: string): FilterOp[] {
  const d = dtype.toLowerCase();
  const isNumeric = NUMERIC_DTYPES.some((t) => d.includes(t));
  const isDatetime = DATETIME_DTYPES.some((t) => d.includes(t));
  const isBoolean = d.includes('bool');
  if (isBoolean) return ['eq', 'ne'];
  if (isNumeric || isDatetime) return ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'];
  // Text / categorical default.
  return ['contains', 'starts_with', 'ends_with', 'eq', 'ne', 'regex'];
}

function isTextOp(op: FilterOp): boolean {
  return op === 'contains' || op === 'starts_with' || op === 'ends_with' || op === 'eq' || op === 'ne' || op === 'regex';
}

function placeholderForOp(op: FilterOp): string {
  if (op === 'regex') return '^foo.*bar$';
  if (op === 'contains') return 'substring';
  if (op === 'starts_with') return 'prefix';
  if (op === 'ends_with') return 'suffix';
  if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') return 'number';
  return 'value';
}

/** Humanized rendering of a filter spec for chip display. */
function describeFilter(f: FilterSpec): string {
  if (QUICK_OPS.includes(f.op)) {
    switch (f.op) {
      case 'is_missing': return 'only missing';
      case 'is_not_missing': return 'hide missing';
      case 'is_duplicated': return 'only duplicates';
      case 'is_unique': return 'only unique';
    }
  }
  const valueStr = f.value ?? '';
  const truncated = valueStr.length > 14 ? valueStr.slice(0, 13) + '…' : valueStr;
  switch (f.op) {
    case 'eq': return `= ${truncated}`;
    case 'ne': return `≠ ${truncated}`;
    case 'gt': return `> ${truncated}`;
    case 'gte': return `≥ ${truncated}`;
    case 'lt': return `< ${truncated}`;
    case 'lte': return `≤ ${truncated}`;
    case 'contains': return `contains “${truncated}”`;
    case 'starts_with': return `starts “${truncated}”`;
    case 'ends_with': return `ends “${truncated}”`;
    case 'regex': return `/${truncated}/`;
    default: return String(f.op);
  }
}

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
