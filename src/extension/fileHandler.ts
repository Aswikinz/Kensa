// File-type detection + default reader parameters. Knows which loader to call
// on the Rust engine based on the file extension.

import * as path from 'node:path';

export const SUPPORTED_EXTENSIONS = new Set([
  '.csv',
  '.tsv',
  '.parquet',
  '.xlsx',
  '.xls',
  '.jsonl'
]);

export type FileKind = 'csv' | 'tsv' | 'parquet' | 'excel' | 'jsonl';

export interface FileDescriptor {
  readonly fsPath: string;
  readonly kind: FileKind;
  readonly name: string;
  readonly extension: string;
}

export function describeFile(fsPath: string): FileDescriptor | null {
  const ext = path.extname(fsPath).toLowerCase();
  const name = path.basename(fsPath);
  const kind = kindFromExtension(ext);
  if (!kind) return null;
  return { fsPath, kind, name, extension: ext };
}

export function kindFromExtension(ext: string): FileKind | null {
  switch (ext) {
    case '.csv':
      return 'csv';
    case '.tsv':
      return 'tsv';
    case '.parquet':
      return 'parquet';
    case '.xls':
    case '.xlsx':
      return 'excel';
    case '.jsonl':
      return 'jsonl';
    default:
      return null;
  }
}

export interface CsvOptions {
  readonly delimiter: string;
  readonly encoding: string;
  readonly hasHeader: boolean;
}

export function defaultCsvOptions(kind: FileKind): CsvOptions {
  return {
    delimiter: kind === 'tsv' ? '\t' : ',',
    encoding: 'utf-8',
    hasHeader: true
  };
}
