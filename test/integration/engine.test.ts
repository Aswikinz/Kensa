// End-to-end test against the Rust native module. Drops a tiny CSV on disk,
// exercises every major DataEngine entry point, and verifies the results
// match expectations. This is skipped automatically if the .node binary
// isn't built — run `npm run build:rust:debug` first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function loadEngine(): null | (new () => EngineShape) {
  try {
    const modulePath = join(process.cwd(), 'crates', 'kensa-engine');
    const mod = require(modulePath) as { DataEngine: new () => EngineShape };
    return mod.DataEngine;
  } catch {
    return null;
  }
}

interface EngineShape {
  loadCsv(path: string, delimiter?: string, encoding?: string, hasHeader?: boolean): { rowCount: number; columnCount: number; columnNames: string[] };
  getSlice(start: number, end: number): { rows: Array<Array<string | null>>; totalRows: number };
  getColumnStats(columnIndex: number): { count: number; missing: number; mean: number | null };
  getAllQuickInsights(): Array<{ columnIndex: number; kind: string; missing: number }>;
  sort(columnIndex: number, ascending: boolean): void;
  resetView(): void;
  filter(filters: Array<{ columnIndex: number; op: string; value?: string }>): number;
  searchValues(columnIndex: number, query: string): number[];
  inferPattern(columnIndex: number, examples: Array<{ input: string; output: string }>): string | null;
  exportCsv(path: string): void;
}

const DataEngine = loadEngine();
const engineAvailable = DataEngine !== null;

test('Rust engine round-trip: load, slice, stats, sort, filter, export', { skip: !engineAvailable }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'kensa-it-'));
  const inPath = join(dir, 'people.csv');
  const outPath = join(dir, 'exported.csv');
  writeFileSync(
    inPath,
    'name,age,city,salary\nAlice,30,NY,50000\nBob,25,LA,60000\nCarol,,SF,\nDave,45,NY,75000\n'
  );

  try {
    const engine = new DataEngine!();
    const info = engine.loadCsv(inPath, ',', 'utf-8', true);
    assert.equal(info.rowCount, 4);
    assert.equal(info.columnCount, 4);
    assert.deepEqual(info.columnNames, ['name', 'age', 'city', 'salary']);

    // Slice returns the rows in insertion order
    const slice = engine.getSlice(0, 10);
    assert.equal(slice.totalRows, 4);
    assert.equal(slice.rows.length, 4);
    assert.equal(slice.rows[0]?.[0], 'Alice');
    assert.equal(slice.rows[2]?.[1], null); // Carol's age is missing

    // Column stats pick up the missing value
    const ageStats = engine.getColumnStats(1);
    assert.equal(ageStats.count, 3);
    assert.equal(ageStats.missing, 1);
    assert.ok(ageStats.mean !== null);
    assert.ok(Math.abs((ageStats.mean ?? 0) - 33.333333) < 0.01);

    // Quick insights — 4 columns, age should be numeric
    const insights = engine.getAllQuickInsights();
    assert.equal(insights.length, 4);
    const ageInsight = insights.find((i) => i.columnIndex === 1);
    assert.equal(ageInsight?.kind, 'numeric');

    // Sort by age ascending puts missing (Carol) last
    engine.sort(1, true);
    const sorted = engine.getSlice(0, 10);
    assert.equal(sorted.rows[0]?.[0], 'Bob'); // 25
    assert.equal(sorted.rows[1]?.[0], 'Alice'); // 30
    assert.equal(sorted.rows[2]?.[0], 'Dave'); // 45
    assert.equal(sorted.rows[3]?.[0], 'Carol'); // missing last

    // Filter by city=NY
    engine.resetView();
    const filteredCount = engine.filter([{ columnIndex: 2, op: 'eq', value: 'NY' }]);
    assert.equal(filteredCount, 2);
    const filtered = engine.getSlice(0, 10);
    assert.equal(filtered.rows.length, 2);
    assert.ok(filtered.rows.every((r) => r[2] === 'NY'));

    // Substring search works against the current view order
    engine.resetView();
    const hits = engine.searchValues(0, 'a'); // matches Alice, Carol, Dave
    assert.equal(hits.length, 3);

    // FlashFill: uppercase transform
    const pattern = engine.inferPattern(0, [
      { input: 'Alice', output: 'ALICE' },
      { input: 'Bob', output: 'BOB' }
    ]);
    assert.equal(pattern, 's.str.upper()');

    // Export the current view to a new CSV and re-read
    engine.exportCsv(outPath);
    assert.ok(existsSync(outPath));
    const exported = readFileSync(outPath, 'utf-8');
    assert.ok(exported.startsWith('name,age,city,salary'));
    assert.ok(exported.includes('Alice'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
