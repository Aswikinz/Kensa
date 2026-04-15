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
 *       (different scheme, encoding, cell fragment, etc.). This forgiving
 *       path is what was missing in v0.1.4 and broke every notebook flow
 *       whose hint URI didn't serialize identically.
 *    3. Fall through to the active notebook editor, then to any visible
 *       notebook editor. The hint is a preference, not a constraint —
 *       hard-failing on a miss is worse than picking a reasonable default.
 *    4. Never fall back to `notebookDocuments[0]`: that list is ordered
 *       by open-time, so the oldest notebook always won, which was the
 *       original "No kernel is attached to <previous notebook>" bug.
 *
 *  Returns `null` if none of the fallbacks apply. Callers are expected to
 *  surface a clear error in that case. */
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
    return first ? first.notebook : null;
  }
  return null;
}
