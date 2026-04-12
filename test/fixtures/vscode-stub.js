// Minimal `vscode` module stub used by the end-to-end smoke test. The bundled
// extension.js requires('vscode'), which is provided by VS Code at runtime.
// For a headless Node test we substitute this small fake that records calls
// and returns benign defaults so activation can walk through its init logic.

const subscribers = [];

function createDisposable() {
  return { dispose() {} };
}

function createOutputChannel(name) {
  const lines = [];
  return {
    name,
    appendLine(line) { lines.push(line); },
    append(text) { lines.push(text); },
    dispose() {},
    // Test helper (not part of the real API):
    _lines: lines
  };
}

const registeredCommands = new Map();

const api = {
  ExtensionContext: class {},
  Uri: {
    file: (p) => ({ fsPath: p, toString: () => 'file://' + p }),
    joinPath: (base, ...parts) => ({
      fsPath: [base.fsPath ?? base, ...parts].join('/'),
      toString: () => 'file://' + [base.fsPath ?? base, ...parts].join('/')
    })
  },
  ViewColumn: { One: 1, Active: -1, Beside: -2 },
  CancellationTokenSource: class {
    constructor() { this.token = { isCancellationRequested: false }; }
    dispose() {}
  },
  commands: {
    registerCommand(id, fn) {
      registeredCommands.set(id, fn);
      return createDisposable();
    },
    executeCommand(id, ...args) {
      const fn = registeredCommands.get(id);
      return fn ? fn(...args) : undefined;
    },
    // Test helper:
    _registered: registeredCommands
  },
  window: {
    createOutputChannel,
    createWebviewPanel(viewType, title, _col, _opts) {
      const listeners = [];
      return {
        viewType,
        title,
        active: true,
        webview: {
          html: '',
          cspSource: 'vscode-webview://test',
          onDidReceiveMessage(fn) { listeners.push(fn); return createDisposable(); },
          postMessage(msg) { return true; },
          asWebviewUri(uri) { return uri; }
        },
        reveal() {},
        dispose() {},
        onDidDispose() { return createDisposable(); },
        _listeners: listeners
      };
    },
    showErrorMessage(msg) { console.log('[stub:error]', msg); return Promise.resolve(undefined); },
    showInformationMessage(msg) { console.log('[stub:info]', msg); return Promise.resolve(undefined); },
    showOpenDialog() { return Promise.resolve(undefined); },
    showSaveDialog() { return Promise.resolve(undefined); },
    showInputBox() { return Promise.resolve(undefined); },
    activeNotebookEditor: undefined
  },
  workspace: {
    getConfiguration() {
      return {
        get(key, defaultValue) { return defaultValue; }
      };
    },
    openTextDocument() { return Promise.resolve({}); }
  },
  extensions: {
    getExtension() { return undefined; }
  },
  notebooks: {
    createRendererMessaging() {
      return {
        onDidReceiveMessage() { return createDisposable(); },
        postMessage() { return Promise.resolve(true); }
      };
    }
  },
  Disposable: class {
    constructor(fn) { this.fn = fn; }
    dispose() { if (typeof this.fn === 'function') this.fn(); }
  }
};

module.exports = api;
