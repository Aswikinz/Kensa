// Wrapper around `acquireVsCodeApi()`. The function can only be called once
// per webview load, so we stash the handle in a module-level variable and
// expose strongly typed post/listen helpers to the rest of the webview.

import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage
} from '../shared/messages';

interface VsCodeApi {
  postMessage(message: WebviewToExtensionMessage): void;
  setState(state: unknown): void;
  getState(): unknown;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

let api: VsCodeApi | null = null;

export function initVsCodeApi(): void {
  if (typeof window.acquireVsCodeApi === 'function') {
    api = window.acquireVsCodeApi();
  }
}

export function postMessage(message: WebviewToExtensionMessage): void {
  if (api) {
    api.postMessage(message);
  } else {
    // Dev mode fallback — log so the developer can see the intent.
    // eslint-disable-next-line no-console
    console.log('[kensa:postMessage]', message);
  }
}

export function onMessage(handler: (msg: ExtensionToWebviewMessage) => void): () => void {
  // Snapshot the trusted origin once at listener-setup time so the hot
  // handler path is just a string compare. VS Code webviews run in a
  // sandboxed iframe under the `vscode-webview://` scheme and the
  // extension host's `panel.webview.postMessage` calls arrive
  // same-origin — so `evt.origin === window.location.origin` is the
  // correct positive check at runtime.
  const trustedOrigin = window.location.origin;

  const wrapped = (evt: MessageEvent) => {
    // IMPORTANT: the origin comparison MUST live inline here and not
    // be routed through a helper function. CodeQL's data-flow analysis
    // for `js/missing-origin-verification` does not trace through
    // user-defined functions — a `isTrustedOrigin(evt.origin)` helper
    // call looks identical to "no origin check at all" from the
    // analyzer's perspective, even if the helper is a one-line equality
    // check. Keeping the comparison inline is what clears the alert.
    // See: https://codeql.github.com/codeql-query-help/javascript/js-missing-origin-verification/
    if (evt.origin !== trustedOrigin) {
      return;
    }
    // Shape guard: every variant of `ExtensionToWebviewMessage` is a
    // `{ type: string, ... }` discriminated union. Reject anything that
    // doesn't parse as an object with a string `type` before the
    // handler sees it — belt-and-braces in case a same-origin sender
    // manages to smuggle malformed data through.
    const data: unknown = evt.data;
    if (
      typeof data !== 'object' ||
      data === null ||
      typeof (data as { type?: unknown }).type !== 'string'
    ) {
      return;
    }
    handler(data as ExtensionToWebviewMessage);
  };
  window.addEventListener('message', wrapped);
  return () => window.removeEventListener('message', wrapped);
}
