// Tests for `extractNotebookHint` — the notebook/toolbar argument parser
// that replaced v0.1.5's `instanceof vscode.Uri` check. The v0.1.5 bug was
// that `instanceof` failed for Uri-shaped objects that came through an
// RPC boundary or weren't formal `vscode.Uri` class instances, so the
// hint was silently dropped and every notebook flow surfaced as
// "No Jupyter notebook is open".
//
// These tests exercise the structural duck-type check against every
// documented argument shape VS Code or a downstream fork might pass.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractNotebookHint, isUriLike } from '../../src/extension/notebookArgParser';

interface FakeUri {
  readonly scheme: string;
  readonly fsPath: string;
  readonly path?: string;
  toString(): string;
}

function fakeUri(fsPath: string): FakeUri {
  return {
    scheme: 'file',
    fsPath,
    path: fsPath,
    toString: () => `file://${fsPath}`
  };
}

// ---------- isUriLike ----------

test('isUriLike accepts a plain Uri-shaped object (the v0.1.5 failure case)', () => {
  assert.equal(isUriLike(fakeUri('/work/a.ipynb')), true);
});

test('isUriLike accepts objects with `path` instead of `fsPath`', () => {
  assert.equal(
    isUriLike({ scheme: 'vscode-notebook', path: '/a.ipynb', toString: () => '' }),
    true
  );
});

test('isUriLike rejects non-objects', () => {
  assert.equal(isUriLike(null), false);
  assert.equal(isUriLike(undefined), false);
  assert.equal(isUriLike('file:///a.ipynb'), false);
  assert.equal(isUriLike(42), false);
});

test('isUriLike rejects objects missing `scheme`', () => {
  assert.equal(isUriLike({ fsPath: '/a.ipynb' }), false);
});

test('isUriLike rejects objects with non-string `scheme`', () => {
  assert.equal(isUriLike({ scheme: 1, fsPath: '/a.ipynb' }), false);
});

test('isUriLike rejects objects with neither `fsPath` nor `path`', () => {
  assert.equal(isUriLike({ scheme: 'file' }), false);
});

// ---------- extractNotebookHint ----------

test('extractNotebookHint returns undefined for null/undefined arg', () => {
  assert.equal(extractNotebookHint(undefined), undefined);
  assert.equal(extractNotebookHint(null), undefined);
});

test('extractNotebookHint accepts a bare Uri-like argument', () => {
  const u = fakeUri('/work/a.ipynb');
  assert.strictEqual(extractNotebookHint(u), u);
});

test('extractNotebookHint accepts `{ uri }` (NotebookDocument shape)', () => {
  const u = fakeUri('/work/a.ipynb');
  assert.strictEqual(extractNotebookHint({ uri: u }), u);
});

test('extractNotebookHint accepts `{ notebookUri }` (transitional shape)', () => {
  const u = fakeUri('/work/a.ipynb');
  assert.strictEqual(extractNotebookHint({ notebookUri: u }), u);
});

test('extractNotebookHint accepts `{ notebook: { uri } }` (NotebookEditor shape)', () => {
  // This is what the native VS Code notebook/toolbar callback usually
  // passes. The v0.1.5 bug was specifically that this branch used
  // `instanceof vscode.Uri` and dropped the hint when `u` was a
  // structurally-correct plain object.
  const u = fakeUri('/work/a.ipynb');
  const arg = { notebook: { uri: u } };
  assert.strictEqual(extractNotebookHint(arg), u);
});

test('extractNotebookHint accepts `{ document: { uri } }` (web flavour shape)', () => {
  const u = fakeUri('/work/a.ipynb');
  assert.strictEqual(extractNotebookHint({ document: { uri: u } }), u);
});

test('extractNotebookHint returns undefined for arg without a recognizable shape', () => {
  assert.equal(extractNotebookHint({ foo: 'bar' }), undefined);
  assert.equal(extractNotebookHint({ notebook: 'not-an-object' }), undefined);
  assert.equal(extractNotebookHint({ uri: 'file:///a.ipynb' }), undefined);
});

test('extractNotebookHint prefers `uri` over `notebook.uri` when both present', () => {
  // Precedence doc: `{ uri }` is a NotebookDocument directly; the wrapped
  // `{ notebook: ... }` form is for NotebookEditor. If both exist on the
  // same arg (shouldn't happen in practice but worth pinning), the direct
  // `uri` wins because it's closer to the root.
  const direct = fakeUri('/work/direct.ipynb');
  const wrapped = fakeUri('/work/wrapped.ipynb');
  const picked = extractNotebookHint({ uri: direct, notebook: { uri: wrapped } });
  assert.strictEqual(picked, direct);
});
