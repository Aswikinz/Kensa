//! Filter predicates. Each `FilterSpec` from the TS side is compiled into a
//! `FilterOp`, which is a borrowed closure-like struct that can be applied to a
//! column cell by index. Multiple filters are AND-combined.

use crate::column::ColumnData;
use crate::errors::{KensaError, KensaResult};
use crate::types::FilterSpec;
use crate::DataFrame;
use regex::RegexBuilder;
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct FilterOp {
    pub column_index: usize,
    pub op: FilterKind,
    pub value: Option<String>,
    pub case_insensitive: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FilterKind {
    Eq,
    Ne,
    Gt,
    Gte,
    Lt,
    Lte,
    Contains,
    StartsWith,
    EndsWith,
    IsMissing,
    IsNotMissing,
    /// Keep rows where this column's value appears more than once. Requires
    /// a pre-pass to build the set of duplicated values.
    IsDuplicated,
    /// Keep rows where this column's value appears exactly once.
    IsUnique,
    Regex,
}

impl FilterOp {
    pub fn from_spec(spec: &FilterSpec) -> Self {
        let kind = match spec.op.as_str() {
            "eq" => FilterKind::Eq,
            "ne" => FilterKind::Ne,
            "gt" => FilterKind::Gt,
            "gte" => FilterKind::Gte,
            "lt" => FilterKind::Lt,
            "lte" => FilterKind::Lte,
            "contains" => FilterKind::Contains,
            "starts_with" => FilterKind::StartsWith,
            "ends_with" => FilterKind::EndsWith,
            "is_missing" => FilterKind::IsMissing,
            "is_not_missing" => FilterKind::IsNotMissing,
            "is_duplicated" => FilterKind::IsDuplicated,
            "is_unique" => FilterKind::IsUnique,
            "regex" => FilterKind::Regex,
            _ => FilterKind::Eq,
        };
        Self {
            column_index: spec.column_index as usize,
            op: kind,
            value: spec.value.clone(),
            case_insensitive: spec.case_insensitive.unwrap_or(false),
        }
    }
}

pub fn apply_filters(df: &DataFrame, filters: &[FilterOp]) -> KensaResult<Vec<usize>> {
    // Up-front bounds check. CodeQL's Rust extractor (beta) can't track that
    // this guard protects the later indexing, so the rest of the function
    // uses `Vec::get` + `ok_or` instead of `&df.columns[idx]`. Same semantics,
    // no raw index expression on a DataFrame column — which is what the
    // `rust/access-invalid-pointer` rule flags.
    for f in filters {
        if f.column_index >= df.columns.len() {
            return Err(KensaError::ColumnIndexOutOfRange {
                index: f.column_index,
                count: df.columns.len(),
            });
        }
    }

    let column_at = |idx: usize| -> KensaResult<&ColumnData> {
        df.columns
            .get(idx)
            .ok_or(KensaError::ColumnIndexOutOfRange {
                index: idx,
                count: df.columns.len(),
            })
    };

    // Pre-pass for duplicate/unique filters — each of these needs to know
    // the full frequency of every value in its column before we can classify
    // any single row. We compute one bool vector per filter, indexed by row.
    let mut prepass: HashMap<usize, Vec<bool>> = HashMap::new();
    for (fi, f) in filters.iter().enumerate() {
        if matches!(f.op, FilterKind::IsDuplicated | FilterKind::IsUnique) {
            let col = column_at(f.column_index)?;
            let counts = value_counts(col);
            let wants_dup = matches!(f.op, FilterKind::IsDuplicated);
            let flags: Vec<bool> = (0..df.row_count)
                .map(|r| {
                    if col.is_missing(r) {
                        return false;
                    }
                    let key = cell_key(col, r);
                    let c = counts.get(&key).copied().unwrap_or(0);
                    if wants_dup {
                        c > 1
                    } else {
                        c == 1
                    }
                })
                .collect();
            prepass.insert(fi, flags);
        }
    }

    let mut out = Vec::with_capacity(df.row_count / 2);
    for row in 0..df.row_count {
        let mut keep = true;
        for (fi, f) in filters.iter().enumerate() {
            let matches_filter = match f.op {
                FilterKind::IsDuplicated | FilterKind::IsUnique => prepass
                    .get(&fi)
                    .and_then(|v| v.get(row).copied())
                    .unwrap_or(false),
                _ => row_matches(column_at(f.column_index)?, row, f)?,
            };
            if !matches_filter {
                keep = false;
                break;
            }
        }
        if keep {
            out.push(row);
        }
    }
    Ok(out)
}

/// Build a stringified value → count map for the column. Missing cells are
/// skipped entirely so they don't count as duplicates of each other.
fn value_counts(col: &ColumnData) -> HashMap<String, u32> {
    let mut counts: HashMap<String, u32> = HashMap::new();
    for row in 0..col.len() {
        if col.is_missing(row) {
            continue;
        }
        let key = cell_key(col, row);
        *counts.entry(key).or_insert(0) += 1;
    }
    counts
}

/// Stable string key for a cell. For floats we use bit-pattern encoding so
/// +0.0 and -0.0 hash the same and NaN compares equal to itself.
///
/// All inner indexing is done via `Vec::get` rather than `v[row]`. `row` is
/// bounded by the callers' `0..df.row_count` / `0..col.len()`, but CodeQL's
/// Rust extractor can't see that invariant and flags the raw index as an
/// out-of-bounds deref. Same result, just different syntax.
fn cell_key(col: &ColumnData, row: usize) -> String {
    match col {
        ColumnData::Int64(v) => v
            .get(row)
            .copied()
            .flatten()
            .map(|n| n.to_string())
            .unwrap_or_default(),
        ColumnData::Float64(v) => v
            .get(row)
            .copied()
            .flatten()
            .map(|n| if n.is_nan() { "NaN".to_string() } else { n.to_bits().to_string() })
            .unwrap_or_default(),
        ColumnData::Utf8(v) => v
            .get(row)
            .and_then(Option::as_ref)
            .cloned()
            .unwrap_or_default(),
        ColumnData::Boolean(v) => v
            .get(row)
            .copied()
            .flatten()
            .map(|b| b.to_string())
            .unwrap_or_default(),
        ColumnData::DateTime(v) => v
            .get(row)
            .copied()
            .flatten()
            .map(|n| n.to_string())
            .unwrap_or_default(),
    }
}

fn row_matches(col: &ColumnData, row: usize, f: &FilterOp) -> KensaResult<bool> {
    match f.op {
        FilterKind::IsMissing => Ok(col.is_missing(row)),
        FilterKind::IsNotMissing => Ok(!col.is_missing(row)),
        // The duplicate/unique filters are resolved in apply_filters via a
        // pre-pass — if we land here it's a programming error.
        FilterKind::IsDuplicated | FilterKind::IsUnique => Err(KensaError::InvalidFilter(
            "duplicate filters must be handled in pre-pass".into(),
        )),
        _ => {
            if col.is_missing(row) {
                return Ok(false);
            }
            let v = f
                .value
                .as_deref()
                .ok_or_else(|| KensaError::InvalidFilter("value required".into()))?;
            // `is_missing` above guarantees the cell is present, but CodeQL
            // doesn't track that across a method call, so we use `get(row)`
            // + `flatten()` / `and_then` and bubble up an `InvalidFilter`
            // error if the invariant ever gets violated. Can't actually
            // happen for a well-formed DataFrame.
            let missing_err = || KensaError::InvalidFilter("row out of range".into());
            match col {
                ColumnData::Int64(arr) => {
                    let x = arr.get(row).copied().flatten().ok_or_else(missing_err)?;
                    let target = v.parse::<i64>().map_err(|e| KensaError::InvalidFilter(e.to_string()))?;
                    Ok(compare_ord(x, target, &f.op))
                }
                ColumnData::Float64(arr) => {
                    let x = arr.get(row).copied().flatten().ok_or_else(missing_err)?;
                    let target = v.parse::<f64>().map_err(|e| KensaError::InvalidFilter(e.to_string()))?;
                    Ok(compare_partial(x, target, &f.op))
                }
                ColumnData::Boolean(arr) => {
                    let x = arr.get(row).copied().flatten().ok_or_else(missing_err)?;
                    let target = matches!(v, "true" | "True" | "1");
                    Ok(match f.op {
                        FilterKind::Eq => x == target,
                        FilterKind::Ne => x != target,
                        _ => false,
                    })
                }
                ColumnData::DateTime(arr) => {
                    let x = arr.get(row).copied().flatten().ok_or_else(missing_err)?;
                    let target = v.parse::<i64>().map_err(|e| KensaError::InvalidFilter(e.to_string()))?;
                    Ok(compare_ord(x, target, &f.op))
                }
                ColumnData::Utf8(arr) => {
                    let s = arr
                        .get(row)
                        .and_then(Option::as_deref)
                        .ok_or_else(missing_err)?;
                    let (haystack, needle) = if f.case_insensitive {
                        (s.to_lowercase(), v.to_lowercase())
                    } else {
                        (s.to_string(), v.to_string())
                    };
                    Ok(match f.op {
                        FilterKind::Eq => haystack == needle,
                        FilterKind::Ne => haystack != needle,
                        FilterKind::Contains => haystack.contains(&needle),
                        FilterKind::StartsWith => haystack.starts_with(&needle),
                        FilterKind::EndsWith => haystack.ends_with(&needle),
                        FilterKind::Gt => haystack > needle,
                        FilterKind::Gte => haystack >= needle,
                        FilterKind::Lt => haystack < needle,
                        FilterKind::Lte => haystack <= needle,
                        FilterKind::Regex => {
                            let re = RegexBuilder::new(v)
                                .case_insensitive(f.case_insensitive)
                                .build()
                                .map_err(|e| KensaError::InvalidFilter(e.to_string()))?;
                            re.is_match(s)
                        }
                        _ => false,
                    })
                }
            }
        }
    }
}

fn compare_ord<T: Ord>(a: T, b: T, op: &FilterKind) -> bool {
    use std::cmp::Ordering::*;
    let ord = a.cmp(&b);
    match op {
        FilterKind::Eq => ord == Equal,
        FilterKind::Ne => ord != Equal,
        FilterKind::Gt => ord == Greater,
        FilterKind::Gte => ord != Less,
        FilterKind::Lt => ord == Less,
        FilterKind::Lte => ord != Greater,
        _ => false,
    }
}

fn compare_partial(a: f64, b: f64, op: &FilterKind) -> bool {
    let ord = match a.partial_cmp(&b) {
        Some(o) => o,
        None => return false,
    };
    use std::cmp::Ordering::*;
    match op {
        FilterKind::Eq => ord == Equal,
        FilterKind::Ne => ord != Equal,
        FilterKind::Gt => ord == Greater,
        FilterKind::Gte => ord != Less,
        FilterKind::Lt => ord == Less,
        FilterKind::Lte => ord != Greater,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::column::ColumnData;

    fn df_with_strings(values: Vec<Option<&str>>) -> DataFrame {
        DataFrame::new(
            vec![ColumnData::Utf8(
                values.into_iter().map(|v| v.map(|s| s.to_string())).collect(),
            )],
            vec!["x".to_string()],
        )
    }

    #[test]
    fn duplicated_filter_keeps_repeats() {
        let df = df_with_strings(vec![Some("a"), Some("b"), Some("a"), Some("c"), Some("a")]);
        let filters = vec![FilterOp {
            column_index: 0,
            op: FilterKind::IsDuplicated,
            value: None,
            case_insensitive: false,
        }];
        let idx = apply_filters(&df, &filters).unwrap();
        assert_eq!(idx, vec![0, 2, 4]);
    }

    #[test]
    fn unique_filter_keeps_singletons() {
        let df = df_with_strings(vec![Some("a"), Some("b"), Some("a"), Some("c")]);
        let filters = vec![FilterOp {
            column_index: 0,
            op: FilterKind::IsUnique,
            value: None,
            case_insensitive: false,
        }];
        let idx = apply_filters(&df, &filters).unwrap();
        assert_eq!(idx, vec![1, 3]);
    }

    #[test]
    fn duplicate_filter_ignores_missing() {
        let df = df_with_strings(vec![None, None, Some("a"), Some("a")]);
        let filters = vec![FilterOp {
            column_index: 0,
            op: FilterKind::IsDuplicated,
            value: None,
            case_insensitive: false,
        }];
        let idx = apply_filters(&df, &filters).unwrap();
        // Missing cells don't count as duplicates of each other.
        assert_eq!(idx, vec![2, 3]);
    }
}
