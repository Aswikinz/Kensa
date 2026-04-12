#!/usr/bin/env node
// Lightweight test runner for Kensa's TS unit tests.
// Walks test/**/*.test.ts, transpiles with esbuild, runs with node --test.

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const testRoot = resolve(root, 'test');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const files = walk(testRoot).filter((f) => !f.includes('/rust/'));
// Node's --test normalizes paths — strip the project root so we pass relative
// locations. Makes failure output easier to read.
const relFiles = files.map((f) => f.replace(root + '/', ''));
// Sanity: nothing to do if the glob caught nothing.
if (relFiles.length === 0) {
  console.log('[kensa] no test files matched');
  process.exit(0);
}
if (files.length === 0) {
  console.log('[kensa] no tests found');
  process.exit(0);
}

const result = spawnSync(
  'node',
  [
    '--import',
    'data:text/javascript,' +
      encodeURIComponent(
        `import { register } from 'node:module'; import { pathToFileURL } from 'node:url'; register('./scripts/ts-loader.mjs', pathToFileURL('./'));`
      ),
    '--test',
    ...relFiles
  ],
  { stdio: 'inherit', cwd: root }
);
process.exit(result.status ?? 1);
