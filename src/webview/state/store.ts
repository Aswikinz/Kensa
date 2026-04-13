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
  // selected operation) instead of `slice`, and the `diff` is overlaid on
  // the rendered cells. Cleared when the user hits Cancel or Apply.
  previewSlice: DataSlice | null;
  insights: QuickInsight[];
  statsByColumn: Record<number, ColumnStats>;
  steps: OperationStep[];
  diff: DiffSummary | null;
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
  setPreview: (slice: DataSlice | null, diff: DiffSummary | null, code: string) => void;
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

  // Filter + sort actions. All of these are self-dispatching — they update
  // local state AND post the resulting applyFilter / applySort message to
  // the extension, so callers only need to invoke one function.
  addOrReplaceColumnFilter: (filter: FilterSpec) => void;
  removeColumnFilter: (columnIndex: number) => void;
  clearAllFilters: () => void;
  applySort: (sort: SortSpec | null) => void;
}

export const useKensaStore = create<KensaState>((set) => ({
  slice: null,
  previewSlice: null,
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

  selectedColumn: null,
  selectedOperationId: null,
  previewCode: '',
  flashFillExpressions: {},
  showSummaryPanel: true,
  showOperationsPanel: false,
  showCodePreview: false,

  setSlice: (slice) => set({ slice, loading: false, error: null, previewSlice: null, previewDiff: null }),
  setPreview: (slice, diff, code) => set({ previewSlice: slice, previewDiff: diff, previewCode: code }),
  clearPreview: () => set({ previewSlice: null, previewDiff: null, previewCode: '' }),
  setInsights: (insights) => set({ insights }),
  setColumnStats: (columnIndex, stats) =>
    set((s) => ({ statsByColumn: { ...s.statsByColumn, [columnIndex]: stats } })),
  setSteps: (steps) => set({ steps }),
  addStep: (step) => set((s) => ({ steps: [...s.steps, step] })),
  removeStep: (stepId) => set((s) => ({ steps: s.steps.filter((x) => x.id !== stepId) })),
  setDiff: (diff) => set({ diff }),
  setMode: (mode) =>
    set({
      mode,
      switching: false,
      showOperationsPanel: mode === 'editing',
      showCodePreview: mode === 'editing'
    }),
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

  addOrReplaceColumnFilter: (filter) =>
    set((s) => {
      // Only one filter per column per op — we dedupe by (column, op) so
      // clicking "Filter: duplicated values" twice is idempotent, and
      // switching from "Filter: not missing" to "Filter: duplicated values"
      // on the same column replaces rather than accumulates.
      const next = s.activeFilters
        .filter((f) => !(f.columnIndex === filter.columnIndex && f.op === filter.op))
        // For the same column, also drop any *other* op — users expect at
        // most one quick filter per column until the generic Filter op is
        // used.
        .filter((f) => f.columnIndex !== filter.columnIndex);
      next.push(filter);
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
    })
}));
