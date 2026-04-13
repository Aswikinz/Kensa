// Command registration for Kensa. Each contributed command is registered
// against a thin dispatcher that delegates to the webview provider.

import * as vscode from 'vscode';
import { KernelManager } from './kernelManager';
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

  // Notebook toolbar entry point: discover DataFrame variables in the active
  // kernel, let the user pick one, and open it in Kensa. VS Code passes
  // either a NotebookEditor (when invoked from the notebook toolbar) or
  // nothing (when invoked from the command palette). We feed that hint to
  // the KernelManager so it doesn't have to guess.
  reg('kensa.viewDataFromNotebook', async (...args: unknown[]) => {
    const hint = extractNotebookUri(args[0]);
    const km = new KernelManager(context.extensionPath, output);
    try {
      const variables = await km.listDataFrameVariables(hint);
      if (variables.length === 0) {
        const choice = await vscode.window.showWarningMessage(
          'Kensa: no DataFrame variables found in the active kernel. Have you executed a cell that defines your DataFrame yet?',
          'Type a name',
          'Cancel'
        );
        if (choice !== 'Type a name') return;
        const typed = await vscode.window.showInputBox({
          prompt: 'DataFrame variable name',
          placeHolder: 'df'
        });
        if (!typed) return;
        await webviewProvider.openNotebookVariable(typed, hint);
        return;
      }

      const pick = await vscode.window.showQuickPick(
        variables.map((name) => ({ label: name, description: 'DataFrame' })),
        {
          title: 'Kensa — View DataFrame',
          placeHolder: 'Select a DataFrame to open in Kensa'
        }
      );
      if (!pick) return;
      await webviewProvider.openNotebookVariable(pick.label, hint);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Kensa: ${message}`);
    } finally {
      await km.dispose();
    }
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

/** Best-effort extraction of a notebook URI from whatever argument VS Code
 *  passes to a notebook/toolbar command. Different VS Code versions pass
 *  different things (NotebookEditor, NotebookDocument, {notebookUri}, or
 *  nothing at all), so we probe each known shape. */
function extractNotebookUri(arg: unknown): vscode.Uri | undefined {
  if (!arg || typeof arg !== 'object') return undefined;
  const obj = arg as Record<string, unknown>;
  if (obj.uri instanceof vscode.Uri) return obj.uri;
  if (obj.notebookUri instanceof vscode.Uri) return obj.notebookUri;
  const notebook = obj.notebook as { uri?: vscode.Uri } | undefined;
  if (notebook?.uri instanceof vscode.Uri) return notebook.uri;
  const document = obj.document as { uri?: vscode.Uri } | undefined;
  if (document?.uri instanceof vscode.Uri) return document.uri;
  return undefined;
}
