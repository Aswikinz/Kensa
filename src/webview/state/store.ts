// Zustand store — single source of truth for the webview. Kept lean: every
// piece of server state (slices, insights, steps) plus a handful of UI-only
// flags for panel visibility and current selection.

import { create } from 'zustand';
import type { DataSourceKind } from '../../shared/messages';
import type {
  ColumnStats,
  DataSlice,
  DiffSummary,
  EditorMode,
  EngineKind,
  FilterSpec,
  OperationStep,
  QuickInsight,
  SortSpec
} from '../../shared/types';
import { postMessage } from '../vscodeApi';

export interface KensaState {
  // Server state
  slice: DataSlice | null;
  // When set, the grid renders this slice (a what-if result of the currently
  // selected operation) instead of `slice`. The slice is paginated — its
  // `totalRows` matches the full preview_df on the Python side, but `rows`
  // only holds the currently-loaded window. Scrolling triggers a
  // `requestPreviewSlice` to load more rows.
  previewSlice: DataSlice | null;
  /** Per-cell change flag for the rows in `previewSlice.rows`. Used by the
   *  grid to paint yellow `.diff-modified` highlights on exactly the
   *  cells that changed. Rectangular: mask[localRow][col]. Empty array
   *  when the operation doesn't support cell-level diffs (row count
   *  changed, sort applied, etc.). */
  previewChangedMask: boolean[][];
  insights: QuickInsight[];
  statsByColumn: Record<number, ColumnStats>;
  steps: OperationStep[];
  diff: DiffSummary | null;
  /** Full-dataset diff summary for the active preview. `rowsChanged` is
   *  the total count across ALL rows of the preview_df, not just the
   *  visible window — this is what the banner shows. */
  previewDiff: DiffSummary | null;
  mode: EditorMode;
  engine: EngineKind;
  source: DataSourceKind;
  fileName: string;
  loading: boolean;
  switching: boolean;
  error: string | null;

  // Active view: the sort + filter list currently applied to the grid. We
  // track them in the webview so the Toolbar can show a live count and
  // individual column headers can clear only their own filters.
  activeFilters: FilterSpec[];
  activeSort: SortSpec | null;

  // UI state
  selectedColumn: number | null;
  selectedOperationId: string | null;
  previewCode: string;
  flashFillExpressions: Record<number, string | null>;
  showSummaryPanel: boolean;
  showOperationsPanel: boolean;
  showCodePreview: boolean;

  // Actions
  setSlice: (slice: DataSlice) => void;
  setPreview: (
    slice: DataSlice | null,
    diff: DiffSummary | null,
    changedMask: boolean[][],
    code: string
  ) => void;
  mergePreviewSlice: (slice: DataSlice, changedMask: boolean[][]) => void;
  clearPreview: () => void;
  setInsights: (insights: QuickInsight[]) => void;
  setColumnStats: (columnIndex: number, stats: ColumnStats) => void;
  setSteps: (steps: OperationStep[]) => void;
  addStep: (step: OperationStep) => void;
  removeStep: (stepId: string) => void;
  setDiff: (diff: DiffSummary | null) => void;
  setMode: (mode: EditorMode) => void;
  setEngine: (engine: EngineKind) => void;
  setSource: (source: DataSourceKind) => void;
  setFileName: (name: string) => void;
  setLoading: (loading: boolean) => void;
  setSwitching: (switching: boolean) => void;
  setError: (message: string | null) => void;
  setSelectedColumn: (index: number | null) => void;
  setSelectedOperation: (id: string | null) => void;
  setPreviewCode: (code: string) => void;
  setFlashFillExpression: (columnIndex: number, expr: string | null) => void;
  toggleSummaryPanel: () => void;
  toggleOperationsPanel: () => void;
  toggleCodePreview: () => void;

  // Column-search state driving the jump-to-column affordance in the
  // toolbar. `scrollToColumnToken` is a monotonically-incrementing
  // counter so DataGrid's effect fires even when the user searches for
  // the same name twice in a row (otherwise `columnSearchQuery` doesn't
  // actually change between calls and the effect doesn't re-trigger).
  columnSearchQuery: string;
  scrollToColumnToken: number;
  scrollToColumnName: string | null;

  // Filter + sort actions. All of these are self-dispatching — they update
  // local state AND post the resulting applyFilter / applySort message to
  // the extension, so callers only need to invoke one function.
  addOrReplaceColumnFilter: (filter: FilterSpec) => void;
  // Append a filter without evicting other filters on the same column.
  // Used for advanced-filter forms where the user can stack multiple
  // conditions (e.g. "age > 30 AND age < 60").
  addFilter: (filter: FilterSpec) => void;
  // Remove a specific filter instance by identity. Needed because a
  // single column can now carry multiple filters, so "remove by column"
  // is ambiguous.
  removeFilterAt: (index: number) => void;
  removeColumnFilter: (columnIndex: number) => void;
  clearAllFilters: () => void;
  applySort: (sort: SortSpec | null) => void;

  setColumnSearchQuery: (q: string) => void;
  requestScrollToColumn: (name: string) => void;
}

export const useKensaStore = create<KensaState>((set) => ({
  slice: null,
  previewSlice: null,
  previewChangedMask: [],
  insights: [],
  statsByColumn: {},
  steps: [],
  diff: null,
  previewDiff: null,
  mode: 'viewing',
  engine: 'rust',
  source: 'file',
  fileName: '',
  loading: true,
  switching: false,
  error: null,
  activeFilters: [],
  activeSort: null,
  columnSearchQuery: '',
  scrollToColumnToken: 0,
  scrollToColumnName: null,

  selectedColumn: null,
  selectedOperationId: null,
  previewCode: '',
  flashFillExpressions: {},
  // Every panel is collapsed by default — the initial experience is "just
  // the grid". Users open side panels explicitly via the toolbar icons.
  showSummaryPanel: false,
  showOperationsPanel: false,
  showCodePreview: false,

  setSlice: (slice) =>
    // Replace the slice AND drop the cached column stats / insights —
    // the previous values were computed against the *old* slice, so
    // keeping them around makes the summary panel show stale numbers
    // after a refresh / re-load. The empty caches force a re-fetch of
    // the currently-selected column's detailed stats and let the next
    // `allColumnInsights` message replace the per-column visualizations
    // in the headers without leaving them stuck on pre-refresh data.
    set({
      slice,
      loading: false,
      error: null,
      previewSlice: null,
      previewDiff: null,
      previewChangedMask: [],
      statsByColumn: {},
      insights: []
    }),
  setPreview: (slice, diff, changedMask, code) =>
    set({
      previewSlice: slice,
      previewDiff: diff,
      previewChangedMask: changedMask,
      previewCode: code
    }),
  mergePreviewSlice: (slice, changedMask) =>
    // Called when a new preview window arrives from pagination. We replace
    // the stored window — we don't accumulate slices — because the grid
    // only renders one window at a time and old windows aren't visible.
    set({ previewSlice: slice, previewChangedMask: changedMask }),
  clearPreview: () =>
    set({
      previewSlice: null,
      previewDiff: null,
      previewChangedMask: [],
      previewCode: ''
    }),
  setInsights: (insights) => set({ insights }),
  setColumnStats: (columnIndex, stats) =>
    set((s) => ({ statsByColumn: { ...s.statsByColumn, [columnIndex]: stats } })),
  setSteps: (steps) => set({ steps }),
  addStep: (step) => set((s) => ({ steps: [...s.steps, step] })),
  removeStep: (stepId) => set((s) => ({ steps: s.steps.filter((x) => x.id !== stepId) })),
  setDiff: (diff) => set({ diff }),
  setMode: (mode) =>
    // Just record the mode. Panel visibility is a pure user choice — the
    // initial experience is "grid only" regardless of viewing vs editing,
    // and the user opens side panels explicitly via the toolbar icons.
    set({ mode, switching: false }),
  setEngine: (engine) => set({ engine }),
  setSource: (source) =>
    // Changing source = new panel load — drop any stale filter/sort state.
    set({ source, activeFilters: [], activeSort: null }),
  setFileName: (fileName) => set({ fileName }),
  setLoading: (loading) => set({ loading }),
  setSwitching: (switching) => set({ switching }),
  setError: (error) => set({ error, switching: false }),
  setSelectedColumn: (selectedColumn) => set({ selectedColumn }),
  setSelectedOperation: (selectedOperationId) =>
    set({ selectedOperationId, previewCode: '', previewSlice: null, previewDiff: null }),
  setPreviewCode: (previewCode) => set({ previewCode }),
  setFlashFillExpression: (columnIndex, expression) =>
    set((s) => ({
      flashFillExpressions: { ...s.flashFillExpressions, [columnIndex]: expression }
    })),
  toggleSummaryPanel: () => set((s) => ({ showSummaryPanel: !s.showSummaryPanel })),
  toggleOperationsPanel: () => set((s) => ({ showOperationsPanel: !s.showOperationsPanel })),
  toggleCodePreview: () => set((s) => ({ showCodePreview: !s.showCodePreview })),

  // Quick-filter ops (from the column menu) are mutually exclusive on
  // the same column — selecting "Only missing" after "Only unique"
  // replaces the earlier choice. Advanced-filter ops stack freely
  // alongside the quick filter. The distinction lets a user combine
  // "hide missing" (quick) with "contains 'foo'" (advanced) on one
  // column, which the old single-filter-per-column semantics blocked.
  addOrReplaceColumnFilter: (filter) =>
    set((s) => {
      const QUICK_OPS: FilterSpec['op'][] = [
        'is_missing',
        'is_not_missing',
        'is_duplicated',
        'is_unique'
      ];
      const next = s.activeFilters.filter(
        (f) =>
          !(f.columnIndex === filter.columnIndex && QUICK_OPS.includes(f.op))
      );
      next.push(filter);
      postMessage({ type: 'applyFilter', filters: next });
      return { activeFilters: next };
    }),

  addFilter: (filter) =>
    set((s) => {
      // Skip pure duplicates — exact (column, op, value, case_insensitive)
      // match means the filter is already active. Everything else stacks.
      const isDupe = s.activeFilters.some(
        (f) =>
          f.columnIndex === filter.columnIndex &&
          f.op === filter.op &&
          (f.value ?? null) === (filter.value ?? null) &&
          (f.caseInsensitive ?? false) === (filter.caseInsensitive ?? false)
      );
      if (isDupe) return {};
      const next = [...s.activeFilters, filter];
      postMessage({ type: 'applyFilter', filters: next });
      return { activeFilters: next };
    }),

  removeFilterAt: (index) =>
    set((s) => {
      if (index < 0 || index >= s.activeFilters.length) return {};
      const next = s.activeFilters.filter((_, i) => i !== index);
      postMessage({ type: 'applyFilter', filters: next });
      return { activeFilters: next };
    }),

  removeColumnFilter: (columnIndex) =>
    set((s) => {
      const next = s.activeFilters.filter((f) => f.columnIndex !== columnIndex);
      postMessage({ type: 'applyFilter', filters: next });
      return { activeFilters: next };
    }),

  clearAllFilters: () =>
    set(() => {
      postMessage({ type: 'applyFilter', filters: [] });
      postMessage({ type: 'applySort', sort: null });
      return { activeFilters: [], activeSort: null };
    }),

  applySort: (sort) =>
    set(() => {
      postMessage({ type: 'applySort', sort });
      return { activeSort: sort };
    }),

  setColumnSearchQuery: (q) => set({ columnSearchQuery: q }),
  requestScrollToColumn: (name) =>
    set((s) => ({
      scrollToColumnName: name,
      scrollToColumnToken: s.scrollToColumnToken + 1
    }))
}));
