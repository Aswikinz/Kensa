// Shared number / percentage formatters used across the webview.
//
// Centralized so every stat on screen reads consistently — e.g. "14%
// missing" in the column header looks identical to "14%" in the detail
// panel, and the dataset-level "92% complete" shares the same rounding
// rules. The old code scattered locale/toExponential calls inline; this
// module pulls them all together.

/** Integer count with locale separators. `1234` → `"1,234"`. */
export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString();
}

/** Compact count — `1234567` → `"1.23M"`. Used in toolbar stats. */
export function formatCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2).replace(/\.?0+$/, '') + 'B';
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (abs >= 10_000) return (n / 1_000).toFixed(1).replace(/\.?0+$/, '') + 'K';
  return n.toLocaleString();
}

/** Percentage of `part` out of `total`, rounded to the minimum number of
 *  decimals that keeps the output meaningful:
 *    - 0 or 100 → "0%" / "100%"
 *    - [1, 99]  → "14%"
 *    - (0, 1)   → "0.2%" (shows one decimal so it doesn't round to 0)
 *    - > 99 but < 100 → "99.8%"
 *  Returns "—" when `total` is zero to avoid /0 artifacts. */
export function formatPercent(part: number | null | undefined, total: number): string {
  if (part === null || part === undefined || Number.isNaN(part)) return '—';
  if (total === 0) return '—';
  const pct = (part / total) * 100;
  if (pct === 0) return '0%';
  if (pct === 100) return '100%';
  if (pct < 1) return `${pct.toFixed(1)}%`;
  if (pct > 99 && pct < 100) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

/** Direct percentage — when you already have a 0–1 fraction. */
export function formatRatio(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return '—';
  return formatPercent(ratio * 100, 100);
}

/** Numeric value for stat panels. Uses exponential notation for very large
 *  or very small values, otherwise fixed-point trimmed of trailing zeros.
 *  Same behaviour as the old inline `formatNumber` so detail-panel output
 *  stays stable across the refactor. */
export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (Math.abs(n) >= 1e6 || (Math.abs(n) < 1e-3 && n !== 0)) return n.toExponential(3);
  return n.toFixed(4).replace(/\.?0+$/, '');
}

/** Truncate a string for display in a toast / tooltip. Keeps the start so
 *  the beginning of a long value stays recognizable. */
export function truncateForToast(s: string, max = 48): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

/** Short text + CSS class to display for a missing cell, picked by the
 *  column's dtype so the user can tell different kinds of "absent" apart
 *  at a glance:
 *    - numeric columns   → `nan` (Python / pandas / numpy convention)
 *    - datetime columns  → `nat` (pandas' Not-a-Time sentinel)
 *    - boolean columns   → `null`
 *    - everything else   → `none` (Python None / generic absence)
 *
 *  Backends that lose the distinction between `None` and `NaN` over
 *  JSON can still round-trip the *dtype* of the column, so we can
 *  display the right sentinel even if the actual missing value looked
 *  identical on the wire. That's good enough to flag a NaN-in-string
 *  column as unusual without requiring protocol changes. */
export function missingLabelForDtype(dtype: string): { text: string; kind: 'nan' | 'nat' | 'null' | 'none' } {
  const d = dtype.toLowerCase();
  if (
    d.startsWith('int') ||
    d.startsWith('uint') ||
    d.startsWith('float') ||
    d === 'number' ||
    d === 'integer' ||
    d === 'numeric'
  ) {
    return { text: 'nan', kind: 'nan' };
  }
  if (
    d.includes('datetime') ||
    d.includes('timestamp') ||
    d === 'date' ||
    d === 'time'
  ) {
    return { text: 'nat', kind: 'nat' };
  }
  if (d.includes('bool')) return { text: 'null', kind: 'null' };
  return { text: 'none', kind: 'none' };
}

/** Column-alignment kind inferred from the dtype string.
 *
 *  Follows Excel's convention so users can spot mis-typed columns at a
 *  glance — a column that *looks* numeric but aligns left is actually
 *  stored as a string. Rules:
 *    - Right-align: integers, floats, datetimes, timestamps
 *    - Center-align: booleans (Excel centres TRUE/FALSE)
 *    - Left-align: everything else (strings, object, categorical, nulls)
 *
 *  Accepts both pandas dtype strings ("int64", "float32",
 *  "datetime64[ns]", "object", "bool") and the Rust engine's dtype
 *  names ("integer", "float", "text", "boolean", "datetime"). */
export type CellAlign = 'left' | 'right' | 'center';
export function alignForDtype(dtype: string): CellAlign {
  const d = dtype.toLowerCase();
  if (/^(bool|boolean)$/.test(d) || d.includes('bool')) return 'center';
  if (
    d.startsWith('int') ||
    d.startsWith('uint') ||
    d.startsWith('float') ||
    d === 'number' ||
    d === 'integer' ||
    d === 'numeric'
  ) {
    return 'right';
  }
  if (
    d.includes('datetime') ||
    d.includes('timestamp') ||
    d === 'date' ||
    d === 'time'
  ) {
    return 'right';
  }
  return 'left';
}
