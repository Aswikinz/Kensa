// Pure helper for parsing the heterogeneous argument that VS Code hands to
// `notebook/toolbar` commands. Kept in its own file with only `type`-imports
// from `vscode` so it can be unit-tested directly under `node --test`
// without stubbing the runtime module.
//
// Background: when the user clicks a command contributed under
// `notebook/toolbar`, VS Code invokes the command callback with a single
// argument. The *shape* of that argument changes across VS Code versions
// and downstream forks (Cursor, Codium, Windsurf, web flavours):
//
//   • `vscode.NotebookEditor` — exposes `.notebook.uri`
//   • `vscode.NotebookDocument` — exposes `.uri`
//   • `{ notebookUri: Uri }` — some transitional shapes
//   • `{ notebook: { uri: Uri } }` — same
//   • `{ document: { uri: Uri } }` — web flavour
//   • `vscode.Uri` itself — rare but documented
//   • `undefined` — command palette invocation
//
// The previous implementation used `instanceof vscode.Uri`, which silently
// returned `undefined` whenever the runtime Uri object didn't match the
// `vscode.Uri` class identity the extension host had loaded — e.g. when
// the object came through an RPC boundary or was a plain structural
// clone. That's what caused "No Jupyter notebook is open" in v0.1.5
// even with a notebook focused: the hint was being dropped here, then
// `findWorkingNotebook(undefined)` fell through to the active-editor
// heuristic (also null because the webview had focus) and bailed out.

import type * as vscode from 'vscode';

/** Structural duck-type check for a Uri-like object. Accepts both real
 *  `vscode.Uri` instances AND plain objects that expose the same shape —
 *  which is what actually arrives from the toolbar callback in some
 *  VS Code versions and forks. */
export function isUriLike(v: unknown): v is vscode.Uri {
  if (!v || typeof v !== 'object') return false;
  const u = v as { scheme?: unknown; fsPath?: unknown; path?: unknown };
  // A real Uri always has a string `scheme` and either `fsPath` or `path`.
  if (typeof u.scheme !== 'string') return false;
  return typeof u.fsPath === 'string' || typeof u.path === 'string';
}

/** Best-effort extraction of a notebook URI from whatever argument a
 *  `notebook/toolbar` command receives. Returns `undefined` only when
 *  every known shape misses — callers should treat that as "no hint,
 *  fall back to heuristics" rather than a hard failure. */
export function extractNotebookHint(arg: unknown): vscode.Uri | undefined {
  // Direct Uri (rare but documented).
  if (isUriLike(arg)) return arg;
  if (!arg || typeof arg !== 'object') return undefined;
  const obj = arg as Record<string, unknown>;
  // `{ uri: Uri }` — NotebookDocument shape.
  if (isUriLike(obj.uri)) return obj.uri;
  // `{ notebookUri: Uri }` — transitional.
  if (isUriLike(obj.notebookUri)) return obj.notebookUri;
  // `NotebookEditor` exposes `.notebook: NotebookDocument`.
  const notebook = obj.notebook;
  if (notebook && typeof notebook === 'object') {
    const nbUri = (notebook as { uri?: unknown }).uri;
    if (isUriLike(nbUri)) return nbUri;
  }
  // `{ document: NotebookDocument }` — web flavour.
  const document = obj.document;
  if (document && typeof document === 'object') {
    const docUri = (document as { uri?: unknown }).uri;
    if (isUriLike(docUri)) return docUri;
  }
  return undefined;
}
