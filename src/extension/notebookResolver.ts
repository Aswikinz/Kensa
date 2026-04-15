// Pure notebook-resolution policy, kept in its own file with only `type`
// imports from `vscode` so it can be unit-tested directly under `node --test`
// without needing to stub the whole `vscode` runtime module.
//
// `kernelManager.ts` imports this helper and adapts it to the live vscode
// API (`vscode.workspace.notebookDocuments`, `vscode.window.*NotebookEditor*`).

import type * as vscode from 'vscode';

/** Minimal structural shapes — both test fakes and the real vscode types
 *  satisfy these, so the helper doesn't care which one it gets. */
export interface NotebookDocumentLike {
  readonly uri: vscode.Uri;
}
export interface NotebookEditorLike {
  readonly notebook: NotebookDocumentLike;
}

/** Pick a working notebook given an optional hint and the current vscode state.
 *
 *  Priority:
 *    1. Strict `uri.toString()` match against an open notebook. URIs from
 *       the notebook toolbar are authoritative.
 *    2. Loose `uri.fsPath` match — URI serialization can differ between
 *       what the toolbar passes us and what `notebookDocuments` stores
 *       (different scheme, encoding, cell fragment, etc.).
 *    3. Fall through to the active notebook editor, then to any visible
 *       notebook editor. The hint is a preference, not a constraint.
 *    4. Last-resort fallback: if at least one notebook document exists
 *       but none of the above matched, return the first one. This
 *       scenario happens when the Kensa webview has stolen focus from
 *       the notebook (so `activeNotebookEditor` is undefined) AND the
 *       notebook is in a tab group that's currently hidden (so
 *       `visibleNotebookEditors` is empty) AND no hint was provided.
 *       Returning `null` here produced the "No Jupyter notebook is open"
 *       error in v0.1.5 even with a notebook open; returning something
 *       reasonable is strictly better. The panel-key fix in
 *       `webviewProvider.ts` prevents this from cascading into the
 *       original cross-notebook confusion.
 *
 *  Returns `null` only when there are genuinely no open notebook documents
 *  at all — which is the one and only case where "No Jupyter notebook is
 *  open" is the correct error to show the user. */
export function pickWorkingNotebook<
  N extends NotebookDocumentLike,
  E extends NotebookEditorLike & { readonly notebook: N }
>(
  hint: vscode.Uri | undefined,
  notebookDocuments: readonly N[],
  activeEditor: E | undefined,
  visibleEditors: readonly E[]
): N | null {
  if (hint) {
    const hintStr = hint.toString();
    const strict = notebookDocuments.find((d) => d.uri.toString() === hintStr);
    if (strict) return strict;
    const loose = notebookDocuments.find((d) => d.uri.fsPath === hint.fsPath);
    if (loose) return loose;
    // Hint didn't match any open notebook — fall through rather than
    // hard-failing. The user almost always has some notebook focused.
  }
  if (activeEditor) return activeEditor.notebook;
  if (visibleEditors.length > 0) {
    const first = visibleEditors[0];
    if (first) return first.notebook;
  }
  // Last resort: at least one notebook is open but we can't tell which
  // one the user means. Return the first rather than bailing out —
  // "wrong notebook, please switch" is a recoverable UX; "no notebook
  // open" when a notebook is clearly open is not.
  if (notebookDocuments.length > 0) {
    return notebookDocuments[0] ?? null;
  }
  return null;
}
