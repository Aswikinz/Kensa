// Minimal TypeScript loader for node --test: transpile .ts/.tsx on the fly
// using esbuild, and resolve extension-less imports by trying .ts then .tsx.
// Kept intentionally tiny — enough for unit tests, not a full bundler.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformSync } from 'esbuild';

const tsExtensions = ['.ts', '.tsx'];

export function resolve(specifier, context, defaultResolve) {
  // Only try the extension fallback for relative imports. Node built-ins and
  // bare package imports go through the default resolver.
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const parentUrl = context.parentURL;
    if (parentUrl) {
      const baseUrl = new URL(specifier, parentUrl);
      const basePath = fileURLToPath(baseUrl);
      if (!existsSync(basePath)) {
        for (const ext of tsExtensions) {
          const candidate = basePath + ext;
          if (existsSync(candidate)) {
            return defaultResolve(pathToFileURL(candidate).href, context, defaultResolve);
          }
        }
        // Directory/index fallback.
        for (const ext of tsExtensions) {
          const candidate = basePath + '/index' + ext;
          if (existsSync(candidate)) {
            return defaultResolve(pathToFileURL(candidate).href, context, defaultResolve);
          }
        }
      }
    }
  }
  return defaultResolve(specifier, context, defaultResolve);
}

export function load(url, context, defaultLoad) {
  if (tsExtensions.some((ext) => url.endsWith(ext))) {
    const filename = fileURLToPath(url);
    const source = readFileSync(filename, 'utf8');
    const { code } = transformSync(source, {
      loader: url.endsWith('.tsx') ? 'tsx' : 'ts',
      format: 'esm',
      target: 'es2022',
      sourcefile: filename
    });
    return { format: 'module', source: code, shortCircuit: true };
  }
  return defaultLoad(url, context, defaultLoad);
}
