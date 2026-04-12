// Notebook renderer controller. VS Code's `notebooks.createRendererMessaging`
// returns a bus that lets the extension host talk to a specific renderer
// bundle (matched by id). Our renderer posts
// `{ type: 'kensa.openVariable', variable }` when the user clicks the
// "Open in Kensa" button in a cell output; we catch that here and delegate
// to the WebviewProvider, which opens the full panel.
//
// This file also exposes helpers for Python helpers to emit DataFrame outputs
// using our custom mime type — the helper writes JSON with the payload shape
// the renderer expects.

import * as vscode from 'vscode';
import type { WebviewProvider } from './webviewProvider';

interface RendererMessage {
  readonly type: string;
  readonly variable?: string;
}

export function registerNotebookController(
  context: vscode.ExtensionContext,
  webviewProvider: WebviewProvider,
  output: vscode.OutputChannel
): void {
  const messaging = vscode.notebooks.createRendererMessaging('kensa-dataframe-renderer');
  const sub = messaging.onDidReceiveMessage((event) => {
    const msg = event.message as RendererMessage | undefined;
    if (!msg || typeof msg.type !== 'string') return;
    output.appendLine(`[kensa:renderer] ${JSON.stringify(msg)}`);

    if (msg.type === 'kensa.openVariable' && typeof msg.variable === 'string') {
      webviewProvider.openNotebookVariable(msg.variable).catch((err) => {
        vscode.window.showErrorMessage(
          `Kensa: failed to open variable '${msg.variable}' — ${String(err)}`
        );
      });
    }
  });

  context.subscriptions.push(sub);
}
