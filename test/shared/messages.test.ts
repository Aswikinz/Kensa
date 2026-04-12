// Guards the message protocol shape. We can't assert full structural
// compatibility at runtime (TS-only types), but we can check the type guard
// and a few discriminator values so refactors surface here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWebviewMessage } from '../../src/shared/messages';

test('isWebviewMessage accepts a well-formed message', () => {
  assert.equal(isWebviewMessage({ type: 'ready' }), true);
  assert.equal(isWebviewMessage({ type: 'requestDataSlice', start: 0, end: 500 }), true);
});

test('isWebviewMessage rejects non-objects', () => {
  assert.equal(isWebviewMessage(null), false);
  assert.equal(isWebviewMessage(undefined), false);
  assert.equal(isWebviewMessage('ready'), false);
  assert.equal(isWebviewMessage(42), false);
});

test('isWebviewMessage rejects objects without type', () => {
  assert.equal(isWebviewMessage({}), false);
  assert.equal(isWebviewMessage({ start: 0 }), false);
});
