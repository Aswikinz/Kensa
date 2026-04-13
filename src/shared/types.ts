// Core domain types shared between extension host and webview.
// Wire format: cells travel as nullable strings (to match what the Rust engine
// serializes). The webview parses numbers back on display.

export type CellValue = string | number | boolean | null;

export type EngineKind = 'rust' | 'python';
export type EditorMode = 'viewing' | 'editing';

export type DtypeLabel =
  | 'integer'
  | 'float'
  | 'string'
  | 'boolean'
  | 'datetime'
  | 'object';

export interface ColumnInfo {
  readonly index: number;
  readonly name: string;
  readonly dtype: string;
  readonly inferred: DtypeLabel | string;
}

export interface DataSlice {
  readonly rows: Array<Array<string | null>>;
  readonly startRow: number;
  readonly endRow: number;
  readonly totalRows: number;
  readonly columns: ColumnInfo[];
  readonly engine: EngineKind;
}

export interface HistogramBin {
  readonly lower: number;
  readonly upper: number;
  readonly count: number;
}

export interface FrequencyEntry {
  readonly value: string;
  readonly count: number;
}

export interface QuickInsight {
  readonly columnIndex: number;
  readonly name: string;
  readonly dtype: string;
  readonly kind: 'numeric' | 'categorical' | 'boolean' | 'datetime' | 'empty';
  readonly missing: number;
  readonly distinct: number;
  readonly histogram: HistogramBin[] | null;
  readonly frequency: FrequencyEntry[] | null;
}

export interface ColumnStats {
  readonly name: string;
  readonly dtype: string;
  readonly count: number;
  readonly missing: number;
  readonly distinct: number;
  readonly min: string | null;
  readonly max: string | null;
  readonly mean: number | null;
  readonly std: number | null;
  readonly sum: number | null;
  readonly p25: number | null;
  readonly p50: number | null;
  readonly p75: number | null;
  readonly topValue: string | null;
  readonly topCount: number | null;
}

export interface DatasetInfo {
  readonly columnNames: string[];
  readonly columnDtypes: string[];
  readonly inferredDtypes: string[];
  readonly rowCount: number;
  readonly columnCount: number;
}

export type FilterOp =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'is_missing'
  | 'is_not_missing'
  | 'is_duplicated'
  | 'is_unique'
  | 'regex';

export interface FilterSpec {
  readonly columnIndex: number;
  readonly op: FilterOp;
  readonly value?: string;
  readonly caseInsensitive?: boolean;
}

export interface SortSpec {
  readonly columnIndex: number;
  readonly ascending: boolean;
}

export interface OperationStep {
  readonly id: string;
  readonly operationId: string;
  readonly label: string;
  readonly parameters: Record<string, unknown>;
  readonly code: string;
  readonly appliedAt: number;
}

export interface DiffSummary {
  readonly rowsAdded: number;
  readonly rowsRemoved: number;
  readonly rowsChanged: number;
  readonly columnsAdded: string[];
  readonly columnsRemoved: string[];
  readonly modifiedCells: Array<{ row: number; column: string }>;
}
