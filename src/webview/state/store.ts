// Zustand store — single source of truth for the webview. Kept lean: every
// piece of server state (slices, insights, steps) plus a handful of UI-only
// flags for panel visibility and current selection.

import { create } from 'zustand';
import type {
  ColumnStats,
  DataSlice,
  DiffSummary,
  EditorMode,
  EngineKind,
  OperationStep,
  QuickInsight
} from '../../shared/types';

export interface KensaState {
  // Server state
  slice: DataSlice | null;
  insights: QuickInsight[];
  statsByColumn: Record<number, ColumnStats>;
  steps: OperationStep[];
  diff: DiffSummary | null;
  mode: EditorMode;
  engine: EngineKind;
  fileName: string;
  loading: boolean;
  error: string | null;

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
  setInsights: (insights: QuickInsight[]) => void;
  setColumnStats: (columnIndex: number, stats: ColumnStats) => void;
  setSteps: (steps: OperationStep[]) => void;
  addStep: (step: OperationStep) => void;
  removeStep: (stepId: string) => void;
  setDiff: (diff: DiffSummary | null) => void;
  setMode: (mode: EditorMode) => void;
  setEngine: (engine: EngineKind) => void;
  setFileName: (name: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (message: string | null) => void;
  setSelectedColumn: (index: number | null) => void;
  setSelectedOperation: (id: string | null) => void;
  setPreviewCode: (code: string) => void;
  setFlashFillExpression: (columnIndex: number, expr: string | null) => void;
  toggleSummaryPanel: () => void;
  toggleOperationsPanel: () => void;
  toggleCodePreview: () => void;
}

export const useKensaStore = create<KensaState>((set) => ({
  slice: null,
  insights: [],
  statsByColumn: {},
  steps: [],
  diff: null,
  mode: 'viewing',
  engine: 'rust',
  fileName: '',
  loading: true,
  error: null,

  selectedColumn: null,
  selectedOperationId: null,
  previewCode: '',
  flashFillExpressions: {},
  showSummaryPanel: true,
  showOperationsPanel: false,
  showCodePreview: false,

  setSlice: (slice) => set({ slice, loading: false, error: null }),
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
      showOperationsPanel: mode === 'editing',
      showCodePreview: mode === 'editing'
    }),
  setEngine: (engine) => set({ engine }),
  setFileName: (fileName) => set({ fileName }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setSelectedColumn: (selectedColumn) => set({ selectedColumn }),
  setSelectedOperation: (selectedOperationId) => set({ selectedOperationId, previewCode: '' }),
  setPreviewCode: (previewCode) => set({ previewCode }),
  setFlashFillExpression: (columnIndex, expression) =>
    set((s) => ({
      flashFillExpressions: { ...s.flashFillExpressions, [columnIndex]: expression }
    })),
  toggleSummaryPanel: () => set((s) => ({ showSummaryPanel: !s.showSummaryPanel })),
  toggleOperationsPanel: () => set((s) => ({ showOperationsPanel: !s.showOperationsPanel })),
  toggleCodePreview: () => set((s) => ({ showCodePreview: !s.showCodePreview }))
}));
