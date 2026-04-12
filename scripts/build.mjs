#!/usr/bin/env node
// Build script for Kensa TypeScript + React bundles.
// Produces two bundles:
//   1. dist/extension/extension.js - CommonJS, VS Code extension host
//   2. dist/webview/webview.js     - ESM/IIFE, loaded inside the webview iframe
// The Rust native module is built separately via `napi build`.

import { build, context } from 'esbuild';
import { mkdirSync, cpSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const outDir = resolve(root, 'dist');
mkdirSync(resolve(outDir, 'extension'), { recursive: true });
mkdirSync(resolve(outDir, 'webview'), { recursive: true });

// Copy the static webview HTML template into the dist folder.
const htmlSrc = resolve(root, 'src/webview/index.html');
if (existsSync(htmlSrc)) {
  cpSync(htmlSrc, resolve(outDir, 'webview/index.html'));
}

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: [resolve(root, 'src/extension/extension.ts')],
  bundle: true,
  outfile: resolve(outDir, 'extension/extension.js'),
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  sourcemap: !production,
  minify: production,
  external: ['vscode', '@napi-rs/cli'],
  // The napi-rs generated wrapper resolves the prebuilt .node binary at
  // runtime; bundling it is safe because it just uses require().
  loader: { '.node': 'copy' },
  logLevel: 'info'
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  entryPoints: [resolve(root, 'src/webview/index.tsx')],
  bundle: true,
  outfile: resolve(outDir, 'webview/webview.js'),
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  sourcemap: !production,
  minify: production,
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development')
  },
  logLevel: 'info'
};

// Notebook output renderer bundle. VS Code loads the file directly via its
// ESM `activate` export, so the format must be ESM (not IIFE).
/** @type {import('esbuild').BuildOptions} */
const rendererConfig = {
  entryPoints: [resolve(root, 'src/webview/renderer.ts')],
  bundle: true,
  outfile: resolve(outDir, 'webview/renderer.js'),
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  sourcemap: !production,
  minify: production,
  logLevel: 'info'
};

if (watch) {
  const [extCtx, webCtx, rendCtx] = await Promise.all([
    context(extensionConfig),
    context(webviewConfig),
    context(rendererConfig)
  ]);
  await Promise.all([extCtx.watch(), webCtx.watch(), rendCtx.watch()]);
  console.log('[kensa] esbuild watching for changes...');
} else {
  await Promise.all([
    build(extensionConfig),
    build(webviewConfig),
    build(rendererConfig)
  ]);
  console.log('[kensa] build complete');
}
