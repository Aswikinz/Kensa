// End-to-end activation smoke test. Patches the Node module resolver so that
// `require('vscode')` returns our stub, then loads the *bundled* extension
// (dist/extension/extension.js) and invokes `activate` with a fake context.
// Verifies that:
//   - activation doesn't throw
//   - all expected commands are registered
//   - the Rust bridge loads successfully (because we built the .node file)
//
// This test is skipped if the bundle or the native module aren't present.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const root = process.cwd();
const bundlePath = join(root, 'dist', 'extension', 'extension.js');
const nativePath = join(root, 'crates', 'kensa-engine');

interface VsCodeStub {
  commands: { _registered: Map<string, unknown> };
  window: { createOutputChannel: (name: string) => { _lines: string[] } };
}

test(
  'bundled extension activates and registers all commands',
  { skip: !existsSync(bundlePath) || !existsSync(nativePath) },
  async () => {
    // Patch Node's resolver so the bundled extension's `require('vscode')`
    // call resolves to our stub instead of throwing.
    const stubPath = join(root, 'test', 'fixtures', 'vscode-stub.js');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = Module as unknown as { _resolveFilename: (req: string, parent: unknown, ...rest: unknown[]) => string };
    const original = mod._resolveFilename.bind(mod);
    mod._resolveFilename = function (request: string, parent: unknown, ...rest: unknown[]): string {
      if (request === 'vscode') return original(stubPath, parent, ...rest);
      return original(request, parent, ...rest);
    };

    try {
      // Force re-require so any cached modules from a previous test run don't
      // short-circuit the activation path.
      delete require.cache[require.resolve(bundlePath)];
      const extension = require(bundlePath) as {
        activate: (context: unknown) => Promise<void>;
      };

      const subscriptions: unknown[] = [];
      const outputLines: string[] = [];
      const context = {
        subscriptions,
        extensionUri: { fsPath: root, toString: () => 'file://' + root },
        extensionPath: root
      };

      // Intercept the OutputChannel so we can inspect what activation logged.
      const vscodeStub = require(stubPath) as VsCodeStub;
      const origCreate = vscodeStub.window.createOutputChannel;
      vscodeStub.window.createOutputChannel = (name: string) => {
        const ch = origCreate(name);
        const orig = ch._lines;
        return {
          ...ch,
          appendLine(line: string) {
            orig.push(line);
            outputLines.push(line);
          },
          append(text: string) { orig.push(text); outputLines.push(text); },
          dispose() {}
        } as unknown as ReturnType<typeof origCreate>;
      };

      await extension.activate(context);

      // Commands registered?
      const commands = vscodeStub.commands._registered;
      assert.ok(commands.has('kensa.openFile'), 'kensa.openFile should be registered');
      assert.ok(commands.has('kensa.openFromExplorer'));
      assert.ok(commands.has('kensa.openVariable'));
      assert.ok(commands.has('kensa.clearRuntime'));
      assert.ok(commands.has('kensa.exportCode'));
      assert.ok(commands.has('kensa.exportData'));

      // Activation logged the Rust engine status line.
      const hasRustLog = outputLines.some((l) => l.includes('Rust engine'));
      assert.ok(hasRustLog, 'activation should log Rust engine status');

      // Subscription list populated.
      assert.ok(subscriptions.length > 0);
    } finally {
      mod._resolveFilename = original;
    }
  }
);
