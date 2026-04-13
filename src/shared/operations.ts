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
  | 'code';

export interface ParameterSchema {
  readonly key: string;
  readonly label: string;
  readonly kind: ParameterKind;
  readonly required?: boolean;
  readonly defaultValue?: unknown;
  /** Raw option values. Kept as machine-friendly identifiers (e.g. `not_equals`)
   *  so the generator's switch cases don't drift. Display labels come from
   *  `optionLabels` or a humanized fallback. */
  readonly options?: readonly string[];
  /** Optional display labels paired with each option value. If omitted, the
   *  option value is humanized on render (e.g. `is_not_missing` → "Is not
   *  missing"). */
  readonly optionLabels?: Readonly<Record<string, string>>;
  readonly placeholder?: string;
  readonly description?: string;
}

/** Convert an internal option value like `not_equals` or `is_not_missing`
 *  into a reader-friendly label for the form. Underscores become spaces and
 *  the first letter is capitalized. Use `optionLabels` on a parameter to
 *  override specific entries. */
export function humanizeOption(value: string): string {
  const spaced = value.replace(/_/g, ' ').trim();
  if (!spaced) return value;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
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
  | 'Custom';

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

/** Format a user-entered value as a Python literal. If the string parses as
 *  a finite number, emit it as a numeric literal — otherwise as a JSON
 *  string. This makes the filter/fill forms DWIM: typing `5` in a numeric
 *  column generates `== 5`, typing `"NY"` in a string column generates
 *  `== "NY"`. Without this, filter/fill on numeric columns silently
 *  produced type-mismatched comparisons that returned empty results. */
function pyLiteral(raw: unknown): string {
  const s = String(raw ?? '');
  if (s === '') return '""';
  // Booleans first so "true"/"false" don't get stringified.
  if (s === 'true' || s === 'True') return 'True';
  if (s === 'false' || s === 'False') return 'False';
  if (s === 'None' || s === 'null') return 'None';
  // Number detection: strict — reject "1.2.3", "1e", NaN, Infinity, etc.
  // and anything with leading/trailing whitespace (which is probably a
  // typo rather than an intentional literal).
  if (/^-?\d+$/.test(s)) return s;
  if (/^-?\d*\.\d+$/.test(s)) return s;
  if (/^-?\d+\.\d*$/.test(s)) return s;
  if (/^-?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(s)) return s;
  return JSON.stringify(s);
}

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
          'is_not_missing',
          'is_duplicated',
          'is_unique'
        ],
        optionLabels: {
          equals: 'Equals',
          not_equals: 'Not equals',
          greater_than: 'Greater than',
          less_than: 'Less than',
          contains: 'Contains',
          starts_with: 'Starts with',
          ends_with: 'Ends with',
          is_missing: 'Is missing',
          is_not_missing: 'Is not missing',
          is_duplicated: 'Is duplicated',
          is_unique: 'Is unique'
        },
        defaultValue: 'equals'
      },
      { key: 'value', label: 'Value', kind: 'string' }
    ],
    generate: (p) => {
      const col = colName(p.column);
      // DWIM literal: "5" → 5, "NY" → "NY". See `pyLiteral` for the rules.
      const v = pyLiteral(p.value);
      // `str.contains` / startswith / endswith always want the needle as a
      // string, not a numeric literal, so we re-stringify for those branches.
      const vStr = JSON.stringify(String(p.value ?? ''));
      switch (p.condition) {
        case 'not_equals':
          return `df = df[df[${col}] != ${v}]`;
        case 'greater_than':
          return `df = df[df[${col}] > ${v}]`;
        case 'less_than':
          return `df = df[df[${col}] < ${v}]`;
        case 'contains':
          return `df = df[df[${col}].astype(str).str.contains(${vStr}, na=False)]`;
        case 'starts_with':
          return `df = df[df[${col}].astype(str).str.startswith(${vStr}, na=False)]`;
        case 'ends_with':
          return `df = df[df[${col}].astype(str).str.endswith(${vStr}, na=False)]`;
        case 'is_missing':
          return `df = df[df[${col}].isna()]`;
        case 'is_not_missing':
          return `df = df[df[${col}].notna()]`;
        case 'is_duplicated':
          return `df = df[df[${col}].duplicated(keep=False)]`;
        case 'is_unique':
          return `df = df[~df[${col}].duplicated(keep=False)]`;
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
          // DWIM literal — typing `0` in a numeric column produces the
          // integer 0 rather than the string "0", so the column dtype
          // isn't silently demoted to object.
          return `df[${col}] = df[${col}].fillna(${pyLiteral(p.value)})`;
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
    label: 'Split text into columns',
    category: 'Text Transforms',
    description: 'Split a text column by a delimiter into separate columns.',
    parameters: [
      { key: 'column', label: 'Column', kind: 'column', required: true },
      { key: 'delimiter', label: 'Delimiter', kind: 'string', defaultValue: ',' },
      { key: 'maxSplits', label: 'Max splits (-1 = all)', kind: 'number', defaultValue: -1 }
    ],
    generate: (p) => {
      const col = colName(p.column);
      const src = String(p.column);
      const d = JSON.stringify(String(p.delimiter ?? ','));
      const n = Number(p.maxSplits ?? -1);
      // Split into a DataFrame of parts, prefix the new column names with
      // the source column's name, then concat back onto df. The original
      // column stays in place — users who want to drop it can use Drop
      // Column as a follow-up step.
      return (
        `_parts = df[${col}].astype(str).str.split(${d}, n=${n}, expand=True)\n` +
        `_parts.columns = [f"${src}_{i + 1}" for i in range(len(_parts.columns))]\n` +
        `df = pd.concat([df, _parts], axis=1)`
      );
    }
  },
  {
    id: 'capitalize',
    label: 'Capitalize',
    category: 'Text Transforms',
    description: 'Capitalize the first character of each value (rest lowercased). Leading/trailing whitespace is stripped first so real-world messy data works as expected.',
    parameters: [{ key: 'column', label: 'Column', kind: 'column', required: true }],
    // `.str.capitalize()` is a no-op when the first character isn't a
    // letter (space, quote, digit, etc.) because Python's str.capitalize
    // only uppercases position 0. Stripping whitespace first makes the
    // operation behave like users expect — "  alice smith" → "Alice smith".
    generate: (p) =>
      `df[${colName(p.column)}] = df[${colName(p.column)}].astype(str).str.strip().str.capitalize()`
  },
  {
    id: 'lowercase',
    label: 'Lowercase',
    category: 'Text Transforms',
    description: 'Convert text to lowercase. Leading/trailing whitespace is stripped so the result is consistent.',
    parameters: [{ key: 'column', label: 'Column', kind: 'column', required: true }],
    generate: (p) =>
      `df[${colName(p.column)}] = df[${colName(p.column)}].astype(str).str.strip().str.lower()`
  },
  {
    id: 'uppercase',
    label: 'Uppercase',
    category: 'Text Transforms',
    description: 'Convert text to uppercase. Leading/trailing whitespace is stripped so the result is consistent.',
    parameters: [{ key: 'column', label: 'Column', kind: 'column', required: true }],
    generate: (p) =>
      `df[${colName(p.column)}] = df[${colName(p.column)}].astype(str).str.strip().str.upper()`
  },
  {
    id: 'title_case',
    label: 'Title case',
    category: 'Text Transforms',
    description: 'Title-case every word ("alice smith" → "Alice Smith"). Leading/trailing whitespace is stripped first.',
    parameters: [{ key: 'column', label: 'Column', kind: 'column', required: true }],
    generate: (p) =>
      `df[${colName(p.column)}] = df[${colName(p.column)}].astype(str).str.strip().str.title()`
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
