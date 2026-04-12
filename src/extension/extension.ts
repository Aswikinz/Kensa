// Entry point for the Kensa VS Code extension. Wires up commands, the
// notebook renderer controller, and the webview factory; everything else
// lives in the specialized modules.

import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { WebviewProvider } from './webviewProvider';
import { getRustBridge } from './rustBridge';
import { registerNotebookController } from './notebookController';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Kensa');
  context.subscriptions.push(output);
  output.appendLine('[kensa] activating...');

  // Attempt to load the Rust engine. A failure here is non-fatal — the router
  // will fall back to Python-only mode. We log the failure for diagnostics.
  const bridge = getRustBridge();
  try {
    await bridge.load();
    output.appendLine(
      bridge.isLoaded()
        ? '[kensa] Rust engine loaded successfully'
        : '[kensa] Rust engine unavailable — falling back to Python-only mode'
    );
  } catch (err) {
    output.appendLine(`[kensa] Rust engine failed to load: ${String(err)}`);
  }

  const webviewProvider = new WebviewProvider(context, output);
  context.subscriptions.push(webviewProvider);

  registerCommands(context, webviewProvider, output);
  registerNotebookController(context, webviewProvider, output);

  output.appendLine('[kensa] activation complete');
}

export function deactivate(): void {
  // Individual subscriptions handle their own teardown via context.subscriptions.
}
