// Operation catalog: the 29 built-in operations grouped by category, each with
// a parameter schema that the ParameterForm component renders and a code
// generator function that produces idiomatic Pandas code.

export type ParameterKind =
  | 'column'
  | 'columnMulti'
  | 'string'
  | 'number'
  | 'enum'
  | 'boolean'
  | 'code'
  | 'examples';

export interface ParameterSchema {
  readonly key: string;
  readonly label: string;
  readonly kind: ParameterKind;
  readonly required?: boolean;
  readonly defaultValue?: unknown;
  readonly options?: readonly string[];
  readonly placeholder?: string;
  readonly description?: string;
}

export type OperationCategory =
  | 'Sort & Filter'
  | 'Column Management'
  | 'Data Cleaning'
  | 'Text Transforms'
  | 'Type Conversion'
  | 'Encoding'
  | 'Numeric'
  | 'Aggregation'
  | 'Custom'
  | 'DateTime';

export interface OperationSpec {
  readonly id: string;
  readonly label: string;
  readonly category: OperationCategory;
  readonly description: string;
  readonly parameters: readonly ParameterSchema[];
  readonly generate: (params: Record<string, unknown>) => string;
}

const colName = (v: unknown): string => JSON.stringify(String(v));
const colNames = (v: unknown): string => {
  const arr = Array.isArray(v) ? v : [v];
  return '[' + arr.map((s) => JSON.stringify(String(s))).join(', ') + ']';
};

export const OPERATIONS: readonly OperationSpec[] = [
  {
    id: 'sort',
    label: 'Sort',
    category: 'Sort & Filter',
    description: 'Sort rows by one or more columns.',
    parameters: [
      { key: 'columns', label: 'Column(s)', kind: 'columnMulti', required: true },
      {
        key: 'direction',
        label: 'Direction',
        kind: 'enum',
        options: ['ascending', 'descending'],
        defaultValue: 'ascending'
      }
    ],
    generate: (p) => {
      const asc = p.direction !== 'descending';
      return `df = df.sort_values(by=${colNames(p.columns)}, ascending=${asc ? 'True' : 'False'})`;
    }
  },
  {
    id: 'filter',
    label: 'Filter',
    category: 'Sort & Filter',
    description: 'Keep only rows matching a condition.',
    parameters: [
      { key: 'column', label: 'Column', kind: 'column', required: true },
      {
        key: 'condition',
        label: 'Condition',
        kind: 'enum',
        options: [
          'equals',
          'not_equals',
          'greater_than',
          'less_than',
          'contains',
          'starts_with',
          'ends_with',
          'is_missing',
          'is_not_missing'
        ],
        defaultValue: 'equals'
      },
      { key: 'value', label: 'Value', kind: 'string' }
    ],
    generate: (p) => {
      const col = colName(p.column);
      const v = JSON.stringify(String(p.value ?? ''));
      switch (p.condition) {
        case 'not_equals':
          return `df = df[df[${col}] != ${v}]`;
        case 'greater_than':
          return `df = df[df[${col}] > ${v}]`;
        case 'less_than':
          return `df = df[df[${col}] < ${v}]`;
        case 'contains':
          return `df = df[df[${col}].astype(str).str.contains(${v}, na=False)]`;
        case 'starts_with':
          return `df = df[df[${col}].astype(str).str.startswith(${v}, na=False)]`;
        case 'ends_with':
          return `df = df[df[${col}].astype(str).str.endswith(${v}, na=False)]`;
        case 'is_missing':
          return `df = df[df[${col}].isna()]`;
        case 'is_not_missing':
          return `df = df[df[${col}].notna()]`;
        case 'equals':
        default:
          return `df = df[df[${col}] == ${v}]`;
      }
    }
  },
  {
    id: 'calc_text_length',
    label: 'Calculate text length',
    category: 'Text Transforms',
    description: 'Add a column with the character length of a text column.',
    parameters: [{ key: 'column', label: 'Column', kind: 'column', required: true }],
    generate: (p) => {
      const src = String(p.column);
      return `df[${colName(src + '_length')}] = df[${colName(src)}].astype(str).str.len()`;
    }
  },
  {
    id: 'one_hot_encode',
    label: 'One-hot encode',
    category: 'Encoding',
    description: 'Expand a categorical column into indicator columns.',
    parameters: [{ key: 'column', label: 'Column', kind: 'column', required: true }],
    generate: (p) => `df = pd.get_dummies(df, columns=${colNames(p.column)})`
  },
  {
    id: 'multi_label_binarizer',
    label: 'Multi-label binarizer',
    category: 'Encoding',
    description: 'Split a delimited-label column into binary indicator columns.',
    parameters: [
      { key: 'column', label: 'Column', kind: 'column', required: true },
      { key: 'delimiter', label: 'Delimiter', kind: 'string', defaultValue: ',' }
    ],
    generate: (p) => {
      const col = colName(p.column);
      const d = JSON.stringify(String(p.delimiter ?? ','));
      return `df = df.join(df[${col}].astype(str).str.get_dummies(sep=${d}))`;
    }
  },
  {
    id: 'formula_column',
    label: 'New column from formula',
    category: 'Custom',
    description: 'Create a new column from a Python expression.',
    parameters: [
      { key: 'name', label: 'New column name', kind: 'string', required: true },
      { key: 'expression', label: 'Expression', kind: 'code', required: true, placeholder: "df['a'] + df['b']" }
    ],
    generate: (p) => `df[${colName(p.name)}] = ${String(p.expression ?? '')}`
  },
  {
    id: 'change_type',
    label: 'Change column type',
    category: 'Type Conversion',
    description: 'Cast a column to a different dtype.',
    parameters: [
      { key: 'column', label: 'Column', kind: 'column', required: true },
      {
        key: 'targetType',
        label: 'Target type',
        kind: 'enum',
        options: ['int64', 'float64', 'string', 'boolean', 'datetime'],
        required: true
      }
    ],
    generate: (p) => {
      const col = colName(p.column);
      switch (p.targetType) {
        case 'datetime':
          return `df[${col}] = pd.to_datetime(df[${col}], errors='coerce')`;
        case 'string':
          return `df[${col}] = df[${col}].astype(str)`;
        case 'boolean':
          return `df[${col}] = df[${col}].astype(bool)`;
        case 'float64':
          return `df[${col}] = pd.to_numeric(df[${col}], errors='coerce')`;
        case 'int64':
        default:
          return `df[${col}] = pd.to_numeric(df[${col}], errors='coerce').astype('Int64')`;
      }
    }
  },
  {
    id: 'drop_column',
    label: 'Drop column',
    category: 'Column Management',
    description: 'Remove one or more columns.',
    parameters: [{ key: 'columns', label: 'Columns', kind: 'columnMulti', required: true }],
    generate: (p) => `df = df.drop(columns=${colNames(p.columns)})`
  },
  {
    id: 'select_columns',
    label: 'Select columns',
    category: 'Column Management',
    description: 'Keep only the selected columns.',
    parameters: [{ key: 'columns', label: 'Columns to keep', kind: 'columnMulti', required: true }],
    generate: (p) => `df = df[${colNames(p.columns)}]`
  },
  {
    id: 'rename_column',
    label: 'Rename column',
    category: 'Column Management',
    description: 'Rename a column.',
    parameters: [
      { key: 'oldName', label: 'Current name', kind: 'column', required: true },
      { key: 'newName', label: 'New name', kind: 'string', required: true }
    ],
    generate: (p) =>
      `df = df.rename(columns={${colName(p.oldName)}: ${JSON.stringify(String(p.newName))}})`
  },
  {
    id: 'clone_column',
    label: 'Clone column',
    category: 'Column Management',
    description: 'Duplicate a column with a new name.',
    parameters: [{ key: 'column', label: 'Column', kind: 'column', required: true }],
    generate: (p) => {
      const src = String(p.column);
      return `df[${colName(src + '_copy')}] = df[${colName(src)}].copy()`;
    }
  },
  {
    id: 'drop_missing',
    label: 'Drop missing values',
    category: 'Data Cleaning',
    description: 'Remove rows with missing values in the selected columns.',
    parameters: [
      { key: 'columns', label: 'Columns (optional)', kind: 'columnMulti' },
      { key: 'how', label: 'How', kind: 'enum', options: ['any', 'all'], defaultValue: 'any' }
    ],
    generate: (p) => {
      const cols = p.columns ? `, subset=${colNames(p.columns)}` : '';
      return `df = df.dropna(how=${JSON.stringify(String(p.how ?? 'any'))}${cols})`;
    }
  },
  {
    id: 'drop_duplicates',
    label: 'Drop duplicate rows',
    category: 'Data Cleaning',
    description: 'Remove duplicated rows.',
    parameters: [
      { key: 'columns', label: 'Columns (optional)', kind: 'columnMulti' },
      {
        key: 'keep',
        label: 'Keep',
        kind: 'enum',
        options: ['first', 'last', 'none'],
        defaultValue: 'first'
      }
    ],
    generate: (p) => {
      const subset = p.columns ? `subset=${colNames(p.columns)}, ` : '';
      const keep = p.keep === 'none' ? 'False' : JSON.stringify(String(p.keep ?? 'first'));
      return `df = df.drop_duplicates(${subset}keep=${keep})`;
    }
  },
  {
    id: 'fill_missing',
    label: 'Fill missing values',
    category: 'Data Cleaning',
    description: 'Replace missing values with a literal or computed value.',
    parameters: [
      { key: 'column', label: 'Column', kind: 'column', required: true },
      {
        key: 'method',
        label: 'Method',
        kind: 'enum',
        options: ['value', 'mean', 'median', 'mode', 'ffill', 'bfill'],
        defaultValue: 'value'
      },
      { key: 'value', label: 'Value (if method = value)', kind: 'string' }
    ],
    generate: (p) => {
      const col = colName(p.column);
      switch (p.method) {
        case 'mean':
          return `df[${col}] = df[${col}].fillna(df[${col}].mean())`;
        case 'median':
          return `df[${col}] = df[${col}].fillna(df[${col}].median())`;
        case 'mode':
          return `df[${col}] = df[${col}].fillna(df[${col}].mode().iloc[0])`;
        case 'ffill':
          return `df[${col}] = df[${col}].ffill()`;
        case 'bfill':
          return `df[${col}] = df[${col}].bfill()`;
        case 'value':
        default:
          return `df[${col}] = df[${col}].fillna(${JSON.stringify(String(p.value ?? ''))})`;
      }
    }
  },
  {
    id: 'find_replace',
    label: 'Find and replace',
    category: 'Data Cleaning',
    description: 'Replace a pattern in a text column.',
    parameters: [
      { key: 'column', label: 'Column', kind: 'column', required: true },
      { key: 'find', label: 'Find', kind: 'string', required: true },
      { key: 'replace', label: 'Replace with', kind: 'string' },
      { key: 'regex', label: 'Use regex', kind: 'boolean', defaultValue: false }
    ],
    generate: (p) => {
      const col = colName(p.column);
      const find = JSON.stringify(String(p.find ?? ''));
      const rep = JSON.stringify(String(p.replace ?? ''));
      const rx = p.regex ? 'True' : 'False';
      return `df[${col}] = df[${col}].astype(str).str.replace(${find}, ${rep}, regex=${rx})`;
    }
  },
  {
    id: 'group_by_agg',
    label: 'Group by and aggregate',
    category: 'Aggregation',
    description: 'Group rows and compute summary statistics per group.',
    parameters: [
      { key: 'groupBy', label: 'Group by', kind: 'columnMulti', required: true },
      { key: 'aggColumn', label: 'Aggregate column', kind: 'column', required: true },
      {
        key: 'aggFunc',
        label: 'Function',
        kind: 'enum',
        options: ['sum', 'mean', 'median', 'count', 'min', 'max', 'std'],
        defaultValue: 'sum'
      }
    ],
    generate: (p) => {
      const g = colNames(p.groupBy);
      const col = colName(p.aggColumn);
      const fn = JSON.stringify(String(p.aggFunc ?? 'sum'));
      return `df = df.groupby(${g}).agg({${col}: ${fn}}).reset_index()`;
    }
  },
  {
    id: 'strip_whitespace',
    label: 'Strip whitespace',
    category: 'Data Cleaning',
    description: 'Remove leading/trailing whitespace.',
    parameters: [{ key: 'column', label: 'Column', kind: 'column', required: true }],
    generate: (p) => `df[${colName(p.column)}] = df[${colName(p.column)}].astype(str).str.strip()`
  },
  {
    id: 'split_text',
    label: 'Split text',
    category: 'Text Transforms',
    description: 'Split a text column by a delimiter.',
    parameters: [
      { key: 'column', label: 'Column', kind: 'column', required: true },
      { key: 'delimiter', label: 'Delimiter', kind: 'string', defaultValue: ',' },
      { key: 'maxSplits', label: 'Max splits', kind: 'number', defaultValue: -1 }
    ],
    generate: (p) => {
      const col = colName(p.column);
      const d = JSON.stringify(String(p.delimiter ?? ','));
      const n = Number(p.maxSplits ?? -1);
      return `df[${col}] = df[${col}].astype(str).str.split(${d}, n=${n})`;
    }
  },
  {
    id: 'capitalize',
    label: 'Capitalize',
    category: 'Text Transforms',
    description: 'Capitalize the first character of each value.',
    parameters: [{ key: 'column', label: 'Column', kind: 'column', required: true }],
    generate: (p) => `df[${colName(p.column)}] = df[${colName(p.column)}].astype(str).str.capitalize()`
  },
  {
    id: 'lowercase',
    label: 'Lowercase',
    category: 'Text Transforms',
    description: 'Convert text to lowercase.',
    parameters: [{ key: 'column', label: 'Column', kind: 'column', required: true }],
    generate: (p) => `df[${colName(p.column)}] = df[${colName(p.column)}].astype(str).str.lower()`
  },
  {
    id: 'uppercase',
    label: 'Uppercase',
    category: 'Text Transforms',
    description: 'Convert text to uppercase.',
    parameters: [{ key: 'column', label: 'Column', kind: 'column', required: true }],
    generate: (p) => `df[${colName(p.column)}] = df[${colName(p.column)}].astype(str).str.upper()`
  },
  {
    id: 'flashfill_string',
    label: 'String transform by example',
    category: 'Text Transforms',
    description: 'Transform a column using input/output examples (FlashFill).',
    parameters: [
      { key: 'column', label: 'Source column', kind: 'column', required: true },
      { key: 'examples', label: 'Examples', kind: 'examples', required: true }
    ],
    generate: (p) => {
      const col = colName(p.column);
      const expr = String(p.inferredExpression ?? 's');
      return `s = df[${col}]\ndf[${col}] = ${expr}`;
    }
  },
  {
    id: 'flashfill_datetime',
    label: 'DateTime formatting by example',
    category: 'DateTime',
    description: 'Reformat a datetime column by showing example outputs.',
    parameters: [
      { key: 'column', label: 'Source column', kind: 'column', required: true },
      { key: 'format', label: 'strftime pattern', kind: 'string', defaultValue: '%Y-%m-%d' }
    ],
    generate: (p) => {
      const col = colName(p.column);
      const fmt = JSON.stringify(String(p.format ?? '%Y-%m-%d'));
      return `df[${col}] = pd.to_datetime(df[${col}], errors='coerce').dt.strftime(${fmt})`;
    }
  },
  {
    id: 'new_column_by_example',
    label: 'New column by example',
    category: 'Custom',
    description: 'Derive a new column from examples of its contents.',
    parameters: [
      { key: 'name', label: 'New column name', kind: 'string', required: true },
      { key: 'sourceColumn', label: 'Source column', kind: 'column', required: true },
      { key: 'examples', label: 'Examples', kind: 'examples', required: true }
    ],
    generate: (p) => {
      const newCol = colName(p.name);
      const src = colName(p.sourceColumn);
      const expr = String(p.inferredExpression ?? 's');
      return `s = df[${src}]\ndf[${newCol}] = ${expr}`;
    }
  },
  {
    id: 'scale_min_max',
    label: 'Scale min/max',
    category: 'Numeric',
    description: 'Linearly rescale a numeric column to a new range.',
    parameters: [
      { key: 'column', label: 'Column', kind: 'column', required: true },
      { key: 'newMin', label: 'New min', kind: 'number', defaultValue: 0 },
      { key: 'newMax', label: 'New max', kind: 'number', defaultValue: 1 }
    ],
    generate: (p) => {
      const col = colName(p.column);
      const lo = Number(p.newMin ?? 0);
      const hi = Number(p.newMax ?? 1);
      return `_c = df[${col}]\ndf[${col}] = (_c - _c.min()) / (_c.max() - _c.min()) * (${hi} - ${lo}) + ${lo}`;
    }
  },
  {
    id: 'round',
    label: 'Round',
    category: 'Numeric',
    description: 'Round a numeric column to N decimal places.',
    parameters: [
      { key: 'column', label: 'Column', kind: 'column', required: true },
      { key: 'decimals', label: 'Decimals', kind: 'number', defaultValue: 2 }
    ],
    generate: (p) => `df[${colName(p.column)}] = df[${colName(p.column)}].round(${Number(p.decimals ?? 2)})`
  },
  {
    id: 'floor',
    label: 'Floor',
    category: 'Numeric',
    description: 'Apply floor() to a numeric column.',
    parameters: [{ key: 'column', label: 'Column', kind: 'column', required: true }],
    generate: (p) => `df[${colName(p.column)}] = np.floor(df[${colName(p.column)}])`
  },
  {
    id: 'ceiling',
    label: 'Ceiling',
    category: 'Numeric',
    description: 'Apply ceil() to a numeric column.',
    parameters: [{ key: 'column', label: 'Column', kind: 'column', required: true }],
    generate: (p) => `df[${colName(p.column)}] = np.ceil(df[${colName(p.column)}])`
  },
  {
    id: 'custom',
    label: 'Custom operation',
    category: 'Custom',
    description: 'Run an arbitrary Pandas snippet against df.',
    parameters: [
      { key: 'code', label: 'Python code', kind: 'code', required: true, placeholder: 'df = df.query("age > 25")' }
    ],
    generate: (p) => String(p.code ?? '')
  }
];

export function getOperation(id: string): OperationSpec | undefined {
  return OPERATIONS.find((op) => op.id === id);
}

export function operationsByCategory(): Map<OperationCategory, OperationSpec[]> {
  const map = new Map<OperationCategory, OperationSpec[]>();
  for (const op of OPERATIONS) {
    const list = map.get(op.category) ?? [];
    list.push(op);
    map.set(op.category, list);
  }
  return map;
}
