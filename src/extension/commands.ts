// Command registration for Kensa. Each contributed command is registered
// against a thin dispatcher that delegates to the webview provider.

import * as vscode from 'vscode';
import { WebviewProvider } from './webviewProvider';
import { SUPPORTED_EXTENSIONS } from './fileHandler';

export function registerCommands(
  context: vscode.ExtensionContext,
  webviewProvider: WebviewProvider,
  output: vscode.OutputChannel
): void {
  const reg = (id: string, fn: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('kensa.openFile', async () => {
    const uri = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: {
        'Tabular data': Array.from(SUPPORTED_EXTENSIONS).map((e) => e.replace('.', ''))
      }
    });
    if (uri && uri[0]) {
      await webviewProvider.openFile(uri[0]);
    }
  });

  reg('kensa.openFromExplorer', async (arg: unknown) => {
    const uri = arg instanceof vscode.Uri ? arg : undefined;
    if (!uri) {
      vscode.window.showErrorMessage('Kensa: no file selected.');
      return;
    }
    await webviewProvider.openFile(uri);
  });

  reg('kensa.openVariable', async () => {
    const name = await vscode.window.showInputBox({
      prompt: 'DataFrame variable name',
      placeHolder: 'df'
    });
    if (!name) return;
    await webviewProvider.openNotebookVariable(name);
  });

  reg('kensa.clearRuntime', async () => {
    await webviewProvider.clearRuntime();
    vscode.window.showInformationMessage('Kensa: Python runtime cleared.');
  });

  reg('kensa.exportCode', async () => {
    await webviewProvider.requestExportCode();
  });

  reg('kensa.exportData', async () => {
    await webviewProvider.requestExportData();
  });

  output.appendLine('[kensa] commands registered');
}
