// Thin wrapper around the napi-rs native module. Loads lazily and tolerates
// load failures — if the .node binary isn't present (unsupported platform,
// build skipped) the bridge reports unavailable and the router falls back to
// Python. This is the ONLY file that talks to the native addon directly.

import * as path from 'node:path';

// The engine's public shape mirrors the Rust `#[napi]` impl. We declare it as
// a TypeScript interface here so the rest of the extension can be typed even
// when the native module is missing.
export interface DatasetInfoDTO {
  columnNames: string[];
  columnDtypes: string[];
  inferredDtypes: string[];
  rowCount: number;
  columnCount: number;
}

export interface DataSliceDTO {
  rows: Array<Array<string | null>>;
  startRow: number;
  endRow: number;
  totalRows: number;
  columnNames: string[];
  columnDtypes: string[];
}

export interface ColumnStatsDTO {
  name: string;
  dtype: string;
  count: number;
  missing: number;
  distinct: number;
  min: string | null;
  max: string | null;
  mean: number | null;
  std: number | null;
  sum: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  topValue: string | null;
  topCount: number | null;
}

export interface QuickInsightDTO {
  columnIndex: number;
  name: string;
  dtype: string;
  kind: string;
  missing: number;
  distinct: number;
  histogram: Array<{ lower: number; upper: number; count: number }> | null;
  frequency: Array<{ value: string; count: number }> | null;
}

export interface RustDataEngine {
  loadCsv(path: string, delimiter?: string, encoding?: string, hasHeader?: boolean): DatasetInfoDTO;
  loadParquet(path: string): DatasetInfoDTO;
  loadExcel(path: string, sheet?: string): DatasetInfoDTO;
  loadJsonl(path: string): DatasetInfoDTO;
  getSlice(start: number, end: number): DataSliceDTO;
  getColumnStats(columnIndex: number): ColumnStatsDTO;
  getAllQuickInsights(): QuickInsightDTO[];
  sort(columnIndex: number, ascending: boolean): void;
  resetView(): void;
  filter(
    filters: Array<{
      columnIndex: number;
      op: string;
      value?: string;
      caseInsensitive?: boolean;
    }>
  ): number;
  searchValues(columnIndex: number, query: string): number[];
  exportCsv(path: string): void;
  exportParquet(path: string): void;
  computeHistogram(columnIndex: number, bins: number): Array<{ lower: number; upper: number; count: number }>;
  computeFrequency(columnIndex: number, topN: number): Array<{ value: string; count: number }>;
  inferPattern(columnIndex: number, examples: Array<{ input: string; output: string }>): string | null;
  currentFilePath(): string | null;
  viewRowCount(): number;
  totalRowCount(): number;
  columnCount(): number;
  clear(): void;
}

interface RustNativeModule {
  DataEngine: new () => RustDataEngine;
}

class RustBridge {
  private native: RustNativeModule | null = null;
  private loadAttempted = false;
  private loadError: Error | null = null;

  async load(): Promise<void> {
    if (this.loadAttempted) return;
    this.loadAttempted = true;
    try {
      // The napi-rs CLI emits an index.js next to the .node file which handles
      // platform-specific resolution. We require() it via a relative path.
      // Using an indirection so esbuild doesn't try to bundle the .node file.
      const moduleId = path.resolve(__dirname, '../../crates/kensa-engine');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(moduleId) as RustNativeModule;
      if (typeof mod.DataEngine !== 'function') {
        throw new Error('native module has no DataEngine export');
      }
      this.native = mod;
    } catch (err) {
      this.loadError = err instanceof Error ? err : new Error(String(err));
      this.native = null;
    }
  }

  isLoaded(): boolean {
    return this.native !== null;
  }

  lastError(): Error | null {
    return this.loadError;
  }

  createEngine(): RustDataEngine {
    if (!this.native) {
      throw new Error(
        'Rust engine is not available — ' + (this.loadError?.message ?? 'unknown reason')
      );
    }
    return new this.native.DataEngine();
  }
}

const singleton = new RustBridge();

export function getRustBridge(): RustBridge {
  return singleton;
}
