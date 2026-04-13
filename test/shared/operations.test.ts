// Unit tests for the operation catalog. Each operation must emit syntactically
// reasonable Pandas code for a representative parameter set; regression tests
// here guard the contract the extension host relies on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPERATIONS, getOperation } from '../../src/shared/operations';

test('every operation has a generate function that returns non-empty code', () => {
  for (const op of OPERATIONS) {
    const params = sampleParams(op.parameters);
    const code = op.generate(params);
    assert.ok(
      typeof code === 'string' && code.length > 0,
      `operation ${op.id} produced empty code`
    );
  }
});

test('catalog does not ship by-example operations', () => {
  // These ops were removed because the UX was confusing — they required
  // input/output example pairs and the FlashFill inference wasn't always
  // reliable. If we ever bring them back, update this test.
  const ids = OPERATIONS.map((o) => o.id);
  assert.ok(!ids.includes('flashfill_string'));
  assert.ok(!ids.includes('flashfill_datetime'));
  assert.ok(!ids.includes('new_column_by_example'));
});

test('sort generates sort_values call', () => {
  const op = getOperation('sort')!;
  const code = op.generate({ columns: ['age'], direction: 'ascending' });
  assert.match(code, /df\.sort_values/);
  assert.match(code, /"age"/);
  assert.match(code, /ascending=True/);
});

test('filter handles equals with string value', () => {
  const op = getOperation('filter')!;
  const code = op.generate({ column: 'city', condition: 'equals', value: 'NY' });
  assert.match(code, /df\[df\["city"\] == "NY"\]/);
});

test('filter handles contains with string value', () => {
  const op = getOperation('filter')!;
  const code = op.generate({ column: 'name', condition: 'contains', value: 'A' });
  assert.match(code, /str\.contains\("A"/);
});

test('filter emits numeric literals for numeric values (regression)', () => {
  // Bug: before the `pyLiteral` helper was added, typing `5` compared the
  // column against the string `"5"`, which silently returned zero rows on
  // integer columns.
  const op = getOperation('filter')!;
  const code = op.generate({ column: 'age', condition: 'greater_than', value: '5' });
  assert.match(code, /df\[df\["age"\] > 5\]/);
  assert.doesNotMatch(code, /"5"/);
});

test('filter keeps string needle for contains even if it looks numeric', () => {
  // `str.contains` on numeric input doesn't make sense; we always quote
  // the needle regardless of whether it parses as a number.
  const op = getOperation('filter')!;
  const code = op.generate({ column: 'sku', condition: 'contains', value: '5' });
  assert.match(code, /str\.contains\("5"/);
});

test('fill_missing with numeric value keeps the dtype', () => {
  const op = getOperation('fill_missing')!;
  const code = op.generate({ column: 'age', method: 'value', value: '0' });
  assert.match(code, /fillna\(0\)/);
  assert.doesNotMatch(code, /"0"/);
});

test('fill_missing with string value quotes it', () => {
  const op = getOperation('fill_missing')!;
  const code = op.generate({ column: 'city', method: 'value', value: 'Unknown' });
  assert.match(code, /fillna\("Unknown"\)/);
});

test('split_text expands into separate columns', () => {
  const op = getOperation('split_text')!;
  const code = op.generate({ column: 'name', delimiter: ' ', maxSplits: -1 });
  assert.match(code, /expand=True/);
  assert.match(code, /pd\.concat/);
});

test('capitalize strips whitespace first (regression)', () => {
  // Bug: previously ".str.capitalize()" was a no-op on values with
  // leading whitespace because Python's str.capitalize() only touches
  // position 0. "  alice smith".capitalize() returned "  alice smith".
  // The fix is to strip first so the first *meaningful* character is
  // position 0 before capitalize runs.
  const op = getOperation('capitalize')!;
  const code = op.generate({ column: 'name' });
  assert.match(code, /\.str\.strip\(\)\.str\.capitalize\(\)/);
});

test('lowercase and uppercase also strip whitespace', () => {
  const lower = getOperation('lowercase')!.generate({ column: 'name' });
  const upper = getOperation('uppercase')!.generate({ column: 'name' });
  assert.match(lower, /\.str\.strip\(\)\.str\.lower\(\)/);
  assert.match(upper, /\.str\.strip\(\)\.str\.upper\(\)/);
});

test('title_case operation exists and strips whitespace', () => {
  const op = getOperation('title_case')!;
  const code = op.generate({ column: 'name' });
  assert.match(code, /\.str\.strip\(\)\.str\.title\(\)/);
});

test('drop_column generates drop call', () => {
  const op = getOperation('drop_column')!;
  const code = op.generate({ columns: ['a', 'b'] });
  assert.match(code, /df\.drop\(columns=\["a", "b"\]\)/);
});

test('rename_column generates rename dict', () => {
  const op = getOperation('rename_column')!;
  const code = op.generate({ oldName: 'foo', newName: 'bar' });
  assert.match(code, /df\.rename\(columns=\{"foo": "bar"\}\)/);
});

test('fill_missing with median uses column median', () => {
  const op = getOperation('fill_missing')!;
  const code = op.generate({ column: 'age', method: 'median' });
  assert.match(code, /fillna\(df\["age"\]\.median\(\)\)/);
});

test('change_type to datetime uses pd.to_datetime', () => {
  const op = getOperation('change_type')!;
  const code = op.generate({ column: 'ts', targetType: 'datetime' });
  assert.match(code, /pd\.to_datetime/);
});

test('group_by_agg produces groupby().agg() expression', () => {
  const op = getOperation('group_by_agg')!;
  const code = op.generate({
    groupBy: ['city'],
    aggColumn: 'amount',
    aggFunc: 'sum'
  });
  assert.match(code, /groupby\(\["city"\]\)/);
  assert.match(code, /"amount": "sum"/);
});

test('scale_min_max expression references min and max', () => {
  const op = getOperation('scale_min_max')!;
  const code = op.generate({ column: 'x', newMin: 0, newMax: 1 });
  assert.match(code, /\.min\(\)/);
  assert.match(code, /\.max\(\)/);
});

function sampleParams(parameters: ReadonlyArray<{ key: string; kind: string; defaultValue?: unknown }>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of parameters) {
    if (p.defaultValue !== undefined) {
      out[p.key] = p.defaultValue;
      continue;
    }
    switch (p.kind) {
      case 'column':
        out[p.key] = 'sample_col';
        break;
      case 'columnMulti':
        out[p.key] = ['sample_col'];
        break;
      case 'string':
        out[p.key] = 'value';
        break;
      case 'number':
        out[p.key] = 1;
        break;
      case 'boolean':
        out[p.key] = false;
        break;
      case 'code':
        out[p.key] = "df['a']";
        break;
      default:
        out[p.key] = '';
    }
  }
  return out;
}
