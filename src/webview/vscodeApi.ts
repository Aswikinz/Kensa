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
  const wrapped = (evt: MessageEvent) => handler(evt.data as ExtensionToWebviewMessage);
  window.addEventListener('message', wrapped);
  return () => window.removeEventListener('message', wrapped);
}
