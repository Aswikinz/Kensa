// Unit tests for the webview Zustand store. Exercises the new
// multi-sort + stackable-quick-filter behaviour and confirms that
// setSlice doesn't strand the UI in `loading: true` when handed a
// structurally-bad slice.
//
// The test runner is `node --test` driven from `scripts/test.mjs`,
// which transpiles each `.test.ts` with esbuild before running. The
// store imports `vscodeApi` for postMessage; we monkey-patch the
// global `acquireVsCodeApi` shim before importing so postMessage
// becomes a no-op in tests.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';

// Stub the VS Code API shim that `vscodeApi.ts` reaches for at module
// init. Without this, the store's postMessage calls would log to the
// real console — harmless but noisy. Keep it as a no-op recorder so
// later tests can also assert which messages got posted.
const postedMessages: unknown[] = [];
(globalThis as { acquireVsCodeApi?: () => unknown }).acquireVsCodeApi =
  () => ({
    postMessage: (msg: unknown) => {
      postedMessages.push(msg);
    },
    getState: () => undefined,
    setState: () => undefined
  });

let useKensaStore: typeof import('../../src/webview/state/store').useKensaStore;

before(async () => {
  ({ useKensaStore } = await import('../../src/webview/state/store'));
});

function reset() {
  postedMessages.length = 0;
  useKensaStore.setState({
    slice: null,
    insights: [],
    statsByColumn: {},
    activeFilters: [],
    activeSorts: [],
    loading: true
  });
}

function makeSlice(columns: string[]) {
  return {
    rows: [],
    startRow: 0,
    endRow: 0,
    totalRows: 0,
    columns: columns.map((name, index) => ({
      index,
      name,
      dtype: 'string',
      inferred: 'string'
    })),
    engine: 'rust' as const
  };
}

test('setSlice keeps cached insights when column structure is unchanged', () => {
  reset();
  const insights = [
    { columnIndex: 0, name: 'a', dtype: 'string', kind: 'categorical' as const, missing: 0, distinct: 1, histogram: null, frequency: null }
  ];
  useKensaStore.setState({ insights });
  useKensaStore.getState().setSlice(makeSlice(['a', 'b']));
  // Initial slice (no prior columns) → insights cleared by design.
  assert.deepEqual(useKensaStore.getState().insights, []);

  useKensaStore.setState({ insights });
  useKensaStore.getState().setSlice(makeSlice(['a', 'b']));
  // Same column structure as the prior slice → cached insights kept.
  assert.deepEqual(useKensaStore.getState().insights, insights);
});

test('setSlice clears cached insights when columns change shape', () => {
  reset();
  const insights = [
    { columnIndex: 0, name: 'a', dtype: 'string', kind: 'categorical' as const, missing: 0, distinct: 1, histogram: null, frequency: null }
  ];
  useKensaStore.getState().setSlice(makeSlice(['a', 'b']));
  useKensaStore.setState({ insights });
  useKensaStore.getState().setSlice(makeSlice(['a', 'b', 'c']));
  assert.deepEqual(useKensaStore.getState().insights, []);
});

test('setSlice flips loading=false even on a malformed slice (regression guard)', () => {
  reset();
  // Pretend Python returned a malformed slice with no columns. The
  // store used to crash inside `.map` and leave `loading: true`,
  // freezing the UI on "Loading dataset…".
  const bad: any = { rows: [], startRow: 0, endRow: 0, totalRows: 0, columns: undefined, engine: 'python' };
  useKensaStore.getState().setSlice(bad);
  assert.equal(useKensaStore.getState().loading, false);
});

test('toggleSort appends new columns at lowest priority', () => {
  reset();
  const { toggleSort } = useKensaStore.getState();
  toggleSort({ columnIndex: 2, ascending: true });
  toggleSort({ columnIndex: 5, ascending: false });
  const { activeSorts } = useKensaStore.getState();
  assert.deepEqual(activeSorts, [
    { columnIndex: 2, ascending: true },
    { columnIndex: 5, ascending: false }
  ]);
});

test('toggleSort flips direction in place without reordering priority', () => {
  reset();
  const { toggleSort } = useKensaStore.getState();
  toggleSort({ columnIndex: 2, ascending: true });
  toggleSort({ columnIndex: 5, ascending: false });
  toggleSort({ columnIndex: 2, ascending: false }); // flip 2 desc
  const { activeSorts } = useKensaStore.getState();
  assert.deepEqual(activeSorts, [
    { columnIndex: 2, ascending: false }, // still primary
    { columnIndex: 5, ascending: false }
  ]);
});

test('toggleSort removes an entry when clicked in same direction twice', () => {
  reset();
  const { toggleSort } = useKensaStore.getState();
  toggleSort({ columnIndex: 2, ascending: true });
  toggleSort({ columnIndex: 2, ascending: true }); // toggle off
  assert.deepEqual(useKensaStore.getState().activeSorts, []);
});

test('addOrReplaceColumnFilter lets compatible quick filters coexist', () => {
  reset();
  const { addOrReplaceColumnFilter } = useKensaStore.getState();
  addOrReplaceColumnFilter({ columnIndex: 3, op: 'is_not_missing' });
  addOrReplaceColumnFilter({ columnIndex: 3, op: 'is_unique' });
  const { activeFilters } = useKensaStore.getState();
  // Both should be present — they're in different conflict groups
  // (missing/not-missing vs duplicated/unique). Previously the second
  // would have evicted the first.
  assert.equal(activeFilters.length, 2);
  assert.deepEqual(
    new Set(activeFilters.map((f) => f.op)),
    new Set(['is_not_missing', 'is_unique'])
  );
});

test('addOrReplaceColumnFilter still evicts within the same conflict group', () => {
  reset();
  const { addOrReplaceColumnFilter } = useKensaStore.getState();
  addOrReplaceColumnFilter({ columnIndex: 1, op: 'is_missing' });
  addOrReplaceColumnFilter({ columnIndex: 1, op: 'is_not_missing' });
  const { activeFilters } = useKensaStore.getState();
  // is_missing and is_not_missing are mutually exclusive — second wins.
  assert.equal(activeFilters.length, 1);
  assert.equal(activeFilters[0]?.op, 'is_not_missing');
});

test('addOrReplaceColumnFilter does not touch other columns', () => {
  reset();
  const { addOrReplaceColumnFilter } = useKensaStore.getState();
  addOrReplaceColumnFilter({ columnIndex: 1, op: 'is_missing' });
  addOrReplaceColumnFilter({ columnIndex: 2, op: 'is_missing' });
  // Both columns should retain their filter — multi-column filtering
  // works because each addOrReplaceColumnFilter only evicts conflicts
  // on the SAME column.
  const { activeFilters } = useKensaStore.getState();
  assert.equal(activeFilters.length, 2);
  assert.deepEqual(
    activeFilters.map((f) => f.columnIndex).sort(),
    [1, 2]
  );
});

// (postMessage routing isn't exercised here — the vscodeApi shim
// lives behind `acquireVsCodeApi` on `window`, which the Node
// test runner doesn't initialise. The store-state assertions
// above already cover the behavioural surface; the wire format
// is independently asserted in `messages.test.ts`.)
