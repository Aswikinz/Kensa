// Tests for `pickWorkingNotebook` — the pure notebook-resolution helper
// that caused the v0.1.4 regression. These tests exist specifically to
// prevent that failure mode from ever shipping unnoticed again.
//
// The v0.1.4 bug was: when the notebook-toolbar hint URI didn't serialize
// identically to what `workspace.notebookDocuments` stored, the helper
// hard-returned null and every notebook flow surfaced as "No Jupyter
// notebook is open". The `hint miss falls through to active editor` test
// below would have caught that.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickWorkingNotebook } from '../../src/extension/notebookResolver';

interface FakeUri {
  readonly scheme?: string;
  readonly fsPath: string;
  toString(): string;
}
interface FakeNotebook {
  readonly uri: FakeUri;
}
interface FakeEditor {
  readonly notebook: FakeNotebook;
}

function uri(fsPath: string, serialized?: string): FakeUri {
  const s = serialized ?? `file://${fsPath}`;
  return {
    fsPath,
    toString: () => s
  };
}

function nb(fsPath: string, serialized?: string): FakeNotebook {
  return { uri: uri(fsPath, serialized) };
}

function editor(notebook: FakeNotebook): FakeEditor {
  return { notebook };
}

test('hint matches an open notebook strictly → returns that notebook', () => {
  const a = nb('/work/a.ipynb');
  const b = nb('/work/b.ipynb');
  const picked = pickWorkingNotebook(
    uri('/work/b.ipynb'),
    [a, b],
    editor(a),
    [editor(a), editor(b)]
  );
  assert.strictEqual(picked, b);
});

test('hint strict-miss but fsPath matches → returns the fsPath match', () => {
  // Real-world scenario: the notebook toolbar hands us `file:///work/a.ipynb`
  // but `notebookDocuments` has `file:///work/a.ipynb?jupyter-notebook`.
  // Same file, different URI string. v0.1.4 would have returned null here.
  const a = nb('/work/a.ipynb', 'file:///work/a.ipynb?jupyter-notebook');
  const picked = pickWorkingNotebook(
    uri('/work/a.ipynb', 'file:///work/a.ipynb'),
    [a],
    undefined,
    []
  );
  assert.strictEqual(picked, a);
});

test('hint has no match at all → falls through to active editor', () => {
  // v0.1.4 regression: this was returning null and surfacing "No Jupyter
  // notebook is open" to the user, breaking every notebook flow.
  const active = nb('/work/active.ipynb');
  const picked = pickWorkingNotebook(
    uri('/work/ghost.ipynb'),
    [active],
    editor(active),
    [editor(active)]
  );
  assert.strictEqual(picked, active);
});

test('hint has no match and no active editor → falls through to visible', () => {
  const visible = nb('/work/visible.ipynb');
  const picked = pickWorkingNotebook(
    uri('/work/ghost.ipynb'),
    [visible],
    undefined,
    [editor(visible)]
  );
  assert.strictEqual(picked, visible);
});

test('no hint, active editor present → returns active', () => {
  const active = nb('/work/active.ipynb');
  const visible = nb('/work/visible.ipynb');
  const picked = pickWorkingNotebook(
    undefined,
    [active, visible],
    editor(active),
    [editor(active), editor(visible)]
  );
  assert.strictEqual(picked, active);
});

test('no hint, no active editor, visible editor present → returns first visible', () => {
  const b = nb('/work/b.ipynb');
  const c = nb('/work/c.ipynb');
  const picked = pickWorkingNotebook(
    undefined,
    [b, c],
    undefined,
    [editor(b), editor(c)]
  );
  assert.strictEqual(picked, b);
});

test('no hint, no active, no visible, one notebook open → returns that notebook', () => {
  // v0.1.6 regression fix: the Kensa webview can steal `activeNotebookEditor`
  // and the notebook can be in a hidden tab group, leaving both active and
  // visible empty. Returning `null` here (v0.1.5 behaviour) produced the
  // "No Jupyter notebook is open" error even with a notebook clearly open.
  const open = nb('/work/open.ipynb');
  const picked = pickWorkingNotebook(
    undefined,
    [open],
    undefined,
    []
  );
  assert.strictEqual(picked, open);
});

test('no hint, no active, no visible, multiple notebooks open → returns first as last resort', () => {
  // Ambiguous — we can't guess which one the user wants. Picking the first
  // is strictly better than bailing out, because the panel-key fix in
  // webviewProvider.ts prevents cross-notebook panel reuse confusion.
  const a = nb('/work/a.ipynb');
  const b = nb('/work/b.ipynb');
  const picked = pickWorkingNotebook(
    undefined,
    [a, b],
    undefined,
    []
  );
  assert.strictEqual(picked, a);
});

test('hint matches but active editor is different → hint wins', () => {
  const a = nb('/work/a.ipynb');
  const b = nb('/work/b.ipynb');
  const picked = pickWorkingNotebook(
    uri('/work/b.ipynb'),
    [a, b],
    editor(a),
    [editor(a), editor(b)]
  );
  assert.strictEqual(picked, b, 'hint should be authoritative over active editor');
});

test('empty notebookDocuments, no editors → returns null', () => {
  // This is the one case where "No Jupyter notebook is open" is the
  // genuinely correct error. Nothing is open, so nothing can be picked.
  const picked = pickWorkingNotebook(undefined, [], undefined, []);
  assert.strictEqual(picked, null);
});

test('empty notebookDocuments with a hint → still returns null', () => {
  const picked = pickWorkingNotebook(
    uri('/work/a.ipynb'),
    [],
    undefined,
    []
  );
  assert.strictEqual(picked, null);
});

test('regression: hint miss + webview stole focus + tab group hidden → still works', () => {
  // End-to-end reconstruction of the v0.1.5 bug report. User has a notebook
  // open, clicks "Kensa: Open Variable" from the command palette while
  // focused on the Kensa webview, which makes `activeNotebookEditor` null
  // and `visibleNotebookEditors` empty (notebook is in a hidden split).
  // v0.1.5 returned null and surfaced "No Jupyter notebook is open".
  // v0.1.6 finds the notebook via the last-resort fallback.
  const openNotebook = nb('/work/analysis.ipynb');
  const picked = pickWorkingNotebook(
    undefined,
    [openNotebook],
    undefined,
    []
  );
  assert.ok(picked, 'should not return null when a notebook is clearly open');
  assert.strictEqual(picked, openNotebook);
});
