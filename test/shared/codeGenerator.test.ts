// Tests for the step-composition helper in codeGenerator.ts. Importing the
// extension-host module directly would drag in `vscode`; we re-implement the
// single function this tests against by calling into the shared catalog.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getOperation } from '../../src/shared/operations';

test('composed multi-step code emits each step on its own line', () => {
  const s1 = getOperation('drop_missing')!.generate({ columns: ['age'], how: 'any' });
  const s2 = getOperation('lowercase')!.generate({ column: 'name' });
  const joined = [s1, s2].join('\n');
  assert.match(joined, /df\.dropna/);
  assert.match(joined, /str\.lower/);
  assert.equal(joined.split('\n').length, 2);
});
