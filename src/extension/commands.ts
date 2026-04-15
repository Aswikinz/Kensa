// Command registration for Kensa. Each contributed command is registered
// against a thin dispatcher that delegates to the webview provider.

import * as vscode from 'vscode';
import { KernelManager } from './kernelManager';
import { WebviewProvider } from './webviewProvider';
import { SUPPORTED_EXTENSIONS } from './fileHandler';
import { extractNotebookHint } from './notebookArgParser';

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
    // Resolve the notebook once up front so the downstream probe + real
    // extraction share the exact same URI and can't drift onto a
    // different notebook between calls.
    const km = new KernelManager(context.extensionPath, output);
    const notebook = km.resolveNotebookDocument(undefined);
    await km.dispose();
    if (!notebook) {
      vscode.window.showErrorMessage(
        'Kensa: no Jupyter notebook is currently open. Open an .ipynb notebook, run a cell that defines your DataFrame, then try again.'
      );
      return;
    }
    await webviewProvider.openNotebookVariable(name, notebook.uri);
  });

  // Notebook toolbar entry point: discover DataFrame variables in the active
  // kernel, let the user pick one, and open it in Kensa. VS Code passes
  // either a NotebookEditor (when invoked from the notebook toolbar) or
  // nothing (when invoked from the command palette). We feed that hint to
  // the KernelManager so it doesn't have to guess.
  reg('kensa.viewDataFromNotebook', async (...args: unknown[]) => {
    const hint = extractNotebookHint(args[0]);
    output.appendLine(
      `[kensa:cmd] viewDataFromNotebook argShape=${describeArg(args[0])} ` +
        `extractedHint=${hint?.toString() ?? '<none>'}`
    );
    const km = new KernelManager(context.extensionPath, output);
    try {
      // Resolve the notebook ONCE at the top. Everything downstream —
      // listDataFrameVariables, the probe extractVariableToPickle, and
      // the router's real extract call — receives `notebook.uri` as the
      // hint. Because that URI came straight out of
      // `vscode.workspace.notebookDocuments`, the subsequent strict-match
      // lookups are guaranteed to return the same notebook. This
      // eliminates the "list ran against B but extract ran against A"
      // drift that caused the `variable not defined in the kernel: X`
      // symptom when switching notebooks.
      const notebook = km.resolveNotebookDocument(hint);
      if (!notebook) {
        vscode.window.showErrorMessage(
          'Kensa: no Jupyter notebook is currently open. Open an .ipynb notebook, run a cell that defines your DataFrame, then try again.'
        );
        return;
      }
      const resolvedHint = notebook.uri;

      const variables = await km.listDataFrameVariables(resolvedHint);
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
        await webviewProvider.openNotebookVariable(typed, resolvedHint);
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
      await webviewProvider.openNotebookVariable(pick.label, resolvedHint);
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

/** Short summary of whatever VS Code passed as arg[0] to a notebook/toolbar
 *  command. Lets the output channel record the *shape* of the argument
 *  without dumping the whole object graph when we're diagnosing a
 *  resolver bug. */
function describeArg(arg: unknown): string {
  if (arg === undefined) return 'undefined';
  if (arg === null) return 'null';
  if (typeof arg !== 'object') return typeof arg;
  const keys = Object.keys(arg as Record<string, unknown>).slice(0, 6);
  return `{${keys.join(',')}}`;
}
