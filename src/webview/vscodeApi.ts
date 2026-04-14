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

/** Accepted origins for inbound `message` events.
 *
 *  VS Code webviews run in a sandboxed iframe under the `vscode-webview://`
 *  scheme and the extension host's `panel.webview.postMessage` calls arrive
 *  same-origin — so `evt.origin === window.location.origin` is the correct
 *  positive check at runtime. We additionally accept the literal `"null"`
 *  origin string because sandboxed iframes without `allow-same-origin`
 *  report that, and older VS Code versions have been observed to route
 *  messages this way. Any other origin is either a stray cross-frame
 *  postMessage or something hostile, and we drop it silently. */
function isTrustedOrigin(origin: string): boolean {
  if (origin === '' || origin === 'null') return true;
  if (origin === window.location.origin) return true;
  return false;
}

/** Shape guard for inbound messages. Every variant of
 *  `ExtensionToWebviewMessage` is a `{ type: string, ... }` discriminated
 *  union, so anything that doesn't parse as an object with a string `type`
 *  is rejected before the handler ever sees it. This is a belt-and-braces
 *  defense on top of the origin check: even a same-origin sender can't
 *  smuggle malformed data through. */
function isExtensionMessage(data: unknown): data is ExtensionToWebviewMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { type?: unknown }).type === 'string'
  );
}

export function onMessage(handler: (msg: ExtensionToWebviewMessage) => void): () => void {
  const wrapped = (evt: MessageEvent) => {
    // Origin verification — required to satisfy the CodeQL
    // `js/missing-origin-verification` rule and to provide real
    // defense-in-depth against stray cross-frame postMessage calls
    // that might land in this iframe.
    if (!isTrustedOrigin(evt.origin)) {
      return;
    }
    if (!isExtensionMessage(evt.data)) {
      return;
    }
    handler(evt.data);
  };
  window.addEventListener('message', wrapped);
  return () => window.removeEventListener('message', wrapped);
}
