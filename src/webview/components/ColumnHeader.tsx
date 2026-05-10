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
import type { ColumnInfo, FilterOp, FilterSpec, QuickInsight } from '../../shared/types';

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
  // Pull this column's sort entry plus its priority slot in the global
  // sort list. The badge in the menu reads "↑ 2" for the secondary
  // sort, "↑ 3" for the tertiary, etc. — same convention Excel uses
  // for multi-column sort. `null` when this column isn't sorted.
  const activeSort = useKensaStore((s) => {
    const idx = s.activeSorts.findIndex((x) => x.columnIndex === column.index);
    const sort = idx === -1 ? undefined : s.activeSorts[idx];
    if (idx === -1 || !sort) return null;
    return { sort, priority: idx + 1, total: s.activeSorts.length };
  });
  const addOrReplaceColumnFilter = useKensaStore((s) => s.addOrReplaceColumnFilter);
  const addFilter = useKensaStore((s) => s.addFilter);
  const removeColumnFilter = useKensaStore((s) => s.removeColumnFilter);
  const removeFilterAt = useKensaStore((s) => s.removeFilterAt);
  const toggleSortStore = useKensaStore((s) => s.toggleSort);

  // Filters active on *this* column specifically, with their global index
  // preserved so `removeFilterAt` can target the exact instance to drop.
  const columnFilters = useMemo(
    () =>
      allFilters
        .map((f, idx) => ({ filter: f, idx }))
        .filter(({ filter }) => filter.columnIndex === column.index),
    [allFilters, column.index]
  );
  // Each column can carry one quick filter from each conflict group
  // (missing/not-missing, duplicated/unique) simultaneously, so the UI
  // tracks the *set* of active quick ops rather than a single one.
  // The four `ToggleItem` rows below light up independently from
  // this set.
  const activeQuickOps = useMemo(() => {
    const out = new Set<FilterOp>();
    for (const { filter } of columnFilters) {
      if (QUICK_OPS.includes(filter.op)) out.add(filter.op);
    }
    return out;
  }, [columnFilters]);
  const hasFilter = columnFilters.length > 0;

  const [menuOpen, setMenuOpen] = useState(false);
  // Computed pop-out position for the column menu. We anchor it to
  // viewport coordinates (`position: fixed`) instead of the column
  // header's box because absolute-positioned `right: 0` clipped the
  // panel off the right edge of the viewport on rightmost columns
  // when the window was narrow. With viewport coordinates we can
  // detect the would-be overflow and flip the panel left of the
  // trigger instead. `null` while closed; recomputed on every open
  // and on window resize while open.
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
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

  // Recompute the menu's pop-out position whenever it opens or the
  // viewport changes size while open. The menu is roughly 280px wide
  // and ~340px tall; we shift it left/up if anchoring under the
  // trigger would let it run past the viewport edges. This replaces
  // the previous `position: absolute; right: 0` which silently
  // clipped the menu when the column was near the right edge of a
  // narrow window.
  useEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return;
    }
    const place = () => {
      const trigger = menuTriggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const MENU_WIDTH_EST = 280;
      const MENU_HEIGHT_EST = 380;
      const MARGIN = 8;
      const viewportW = document.documentElement.clientWidth;
      const viewportH = document.documentElement.clientHeight;
      // Default: anchor menu's right edge to trigger's right edge
      // (matches the original "▾ button → menu underneath" affordance).
      let left = rect.right - MENU_WIDTH_EST;
      let top = rect.bottom + 6;
      // Keep menu within viewport horizontally — pull right if it
      // would clip the left edge, pull left if it would clip the right.
      if (left < MARGIN) left = MARGIN;
      if (left + MENU_WIDTH_EST > viewportW - MARGIN) {
        left = viewportW - MENU_WIDTH_EST - MARGIN;
      }
      // If anchoring below the trigger overflows the bottom edge,
      // flip up. The trigger sits in the column header at the top
      // of the grid, so flipping up rarely happens; this is a
      // belt-and-braces guard for short viewports.
      if (top + MENU_HEIGHT_EST > viewportH - MARGIN) {
        top = Math.max(MARGIN, rect.top - MENU_HEIGHT_EST - 6);
      }
      setMenuPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [menuOpen]);

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
    // Defer toggle/append/flip semantics to the store. Clicking the
    // currently-active direction removes the entry; clicking the
    // opposite flips it; clicking on a brand-new column appends at
    // the end (next sort priority).
    toggleSortStore({ columnIndex: column.index, ascending });
  };

  const toggleQuickFilter = (op: FilterOp) => {
    setMenuOpen(false);
    // If this exact op is already active on this column → remove it.
    // Otherwise add (and let the store evict only the *conflicting*
    // op from the same group, leaving the other group's quick filter
    // intact so missing+unique can coexist).
    const existing = columnFilters.find(({ filter }) => filter.op === op);
    if (existing) {
      removeFilterAt(existing.idx);
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
          ref={menuTriggerRef}
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

      {menuOpen && menuPos && (
        <>
          <div
            className="kensa-col-menu"
            role="menu"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: menuPos.top,
              left: menuPos.left,
              right: 'auto'
            }}
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
            <div className="kensa-col-menu-section">
              Sort
              {activeSort && activeSort.total > 1 && (
                <span
                  className="kensa-col-menu-section-badge"
                  title={`Sort priority ${activeSort.priority} of ${activeSort.total}`}
                >
                  #{activeSort.priority}
                </span>
              )}
            </div>
            <SortItem
              active={activeSort?.sort.ascending === true}
              label="Sort ascending"
              arrow="↑"
              onClick={() => toggleSort(true)}
            />
            <SortItem
              active={activeSort?.sort.ascending === false}
              label="Sort descending"
              arrow="↓"
              onClick={() => toggleSort(false)}
            />

            <div className="kensa-col-menu-divider" />
            <div className="kensa-col-menu-section">Quick filters</div>
            <ToggleItem
              active={activeQuickOps.has('is_not_missing')}
              label="Hide missing"
              onClick={() => toggleQuickFilter('is_not_missing')}
            />
            <ToggleItem
              active={activeQuickOps.has('is_missing')}
              label="Only missing"
              onClick={() => toggleQuickFilter('is_missing')}
            />
            <ToggleItem
              active={activeQuickOps.has('is_duplicated')}
              label="Only duplicates"
              onClick={() => toggleQuickFilter('is_duplicated')}
            />
            <ToggleItem
              active={activeQuickOps.has('is_unique')}
              label="Only unique values"
              onClick={() => toggleQuickFilter('is_unique')}
            />

            <div className="kensa-col-menu-divider" />
            <div className="kensa-col-menu-section">Advanced filter</div>
            <AdvancedFilterForm
              dtype={column.dtype}
              insight={insight}
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
 *  is already on the column (quick filter + any prior advanced ones).
 *
 *  The value input adapts to the column's character:
 *    - Boolean columns get a True/False dropdown — typing "true" by
 *      hand was a paper cut on every boolean filter.
 *    - Low-cardinality columns (≤ LOW_CARD_VALUE_LIMIT distinct values)
 *      with an `eq`/`ne` operator get a dropdown of the actual values
 *      pulled from the cached frequency insight, so the user picks
 *      from the real categories instead of remembering exact spellings.
 *    - Everything else stays a free-form text input.
 */
const LOW_CARD_VALUE_LIMIT = 12;

function AdvancedFilterForm({
  dtype,
  insight,
  onApply
}: {
  readonly dtype: string;
  readonly insight: QuickInsight | null;
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

  const isBooleanDtype = /bool/i.test(dtype);
  // Eligibility for the value dropdown: the operator is equality-style
  // AND we have a cached frequency insight with a small enough
  // distinct count to enumerate. Frequency entries are top-N (capped
  // at 5 in Rust, 5 in Python), so we also cross-check `distinct` —
  // if the column actually has 100 unique values but we're only
  // seeing the top 5, we'd be misleading the user.
  const showLowCardDropdown =
    !isBooleanDtype &&
    (op === 'eq' || op === 'ne') &&
    insight?.frequency != null &&
    insight.distinct > 0 &&
    insight.distinct <= LOW_CARD_VALUE_LIMIT &&
    insight.frequency.length === insight.distinct;

  const showCaseToggle = isTextOp(op) && !isBooleanDtype && !showLowCardDropdown;

  // Use our themed popover select instead of a native `<select>` — the
  // native one pops up with OS / browser styling for the option list,
  // which blatantly clashes with the dark column menu it lives inside.
  const opOptions = useMemo(
    () => ops.map((o) => ({ value: o, label: OP_LABELS[o] })),
    [ops]
  );

  // Build the value-dropdown options. `value` strings stay as-is so
  // the wire format (the `FilterSpec.value` we send to the backend)
  // is identical to what the user would have typed, keeping the
  // backend filter evaluation unchanged.
  const valueOptions = useMemo(() => {
    if (isBooleanDtype) {
      return [
        { value: 'True', label: 'True' },
        { value: 'False', label: 'False' }
      ];
    }
    if (showLowCardDropdown && insight?.frequency) {
      return insight.frequency.map((f: { value: string; count: number }) => ({
        value: f.value,
        label: `${f.value}  (${f.count})`
      }));
    }
    return [];
  }, [isBooleanDtype, showLowCardDropdown, insight?.frequency]);

  const useValueDropdown = isBooleanDtype || showLowCardDropdown;

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
        {useValueDropdown ? (
          <ThemedSelect
            value={value}
            options={valueOptions}
            onChange={(v) => setValue(v)}
            ariaLabel="Filter value"
            placeholder={isBooleanDtype ? '— True / False —' : '— pick a value —'}
          />
        ) : (
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
        )}
      </div>
      {showCaseToggle && (
        // Aa-icon toggle replacing the native checkbox — same pattern
        // VS Code uses in its search bar. The icon is the meaning ("A" +
        // "a" together signals "matches both cases"), and the whole
        // chip flips to the primary-blue active state when on. No
        // native control involved, so it can't fall back to OS chrome.
        <button
          type="button"
          className={`kensa-case-toggle ${ci ? 'kensa-case-toggle-active' : ''}`}
          onClick={() => setCi(!ci)}
          aria-pressed={ci}
          title={
            ci
              ? 'Case insensitive — matching ignores letter case (click to enforce case)'
              : 'Case sensitive — matching enforces letter case (click to ignore case)'
          }
        >
          <span className="kensa-case-toggle-icon" aria-hidden>
            Aa
          </span>
          <span className="kensa-case-toggle-label">
            {ci ? 'Ignore case' : 'Match case'}
          </span>
        </button>
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
