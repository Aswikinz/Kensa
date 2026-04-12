// Typed postMessage protocol between the extension host and the webview.
// Every message has a `type` discriminator so TS can narrow both sides. Add a
// new message by appending to both union types and handling it on both ends.

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
} from './types';

// Webview -> Extension ---------------------------------------------------------

export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'requestDataSlice'; start: number; end: number }
  | { type: 'requestColumnStats'; columnIndex: number }
  | { type: 'requestAllColumnInsights' }
  | { type: 'applySort'; sort: SortSpec | null }
  | { type: 'applyFilter'; filters: FilterSpec[] }
  | { type: 'previewOperation'; operationId: string; parameters: Record<string, unknown> }
  | { type: 'applyOperation'; operationId: string; parameters: Record<string, unknown> }
  | { type: 'undoStep'; stepId: string }
  | { type: 'editStepCode'; stepId: string; newCode: string }
  | { type: 'exportCode'; format: 'notebook' | 'clipboard' | 'file' }
  | { type: 'exportData'; format: 'csv' | 'parquet' }
  | { type: 'executeCustomCode'; code: string }
  | { type: 'searchColumns'; query: string }
  | { type: 'switchMode'; mode: EditorMode }
  | { type: 'inferFlashFill'; columnIndex: number; examples: Array<{ input: string; output: string }> };

// Extension -> Webview ---------------------------------------------------------

export type ExtensionToWebviewMessage =
  | { type: 'bootstrap'; mode: EditorMode; engine: EngineKind; fileName: string }
  | { type: 'dataSlice'; slice: DataSlice }
  | { type: 'columnStats'; columnIndex: number; stats: ColumnStats }
  | { type: 'allColumnInsights'; insights: QuickInsight[] }
  | { type: 'operationPreview'; code: string; diff: DiffSummary | null }
  | {
      type: 'operationApplied';
      step: OperationStep;
      slice: DataSlice;
      diff: DiffSummary | null;
    }
  | { type: 'stepRemoved'; stepId: string; slice: DataSlice }
  | { type: 'stepsReset'; slice: DataSlice }
  | { type: 'engineStatus'; engine: EngineKind; ready: boolean }
  | { type: 'modeChanged'; mode: EditorMode }
  | { type: 'loadingState'; state: 'loading' | 'ready' | 'error'; message?: string }
  | { type: 'error'; message: string; details?: string }
  | { type: 'flashFillResult'; columnIndex: number; expression: string | null };

export type MessageType =
  | WebviewToExtensionMessage['type']
  | ExtensionToWebviewMessage['type'];

// Type guard helpers for the message router.
export function isWebviewMessage(msg: unknown): msg is WebviewToExtensionMessage {
  return typeof msg === 'object' && msg !== null && typeof (msg as { type?: unknown }).type === 'string';
}
