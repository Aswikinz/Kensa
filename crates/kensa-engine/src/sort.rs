//! Index-based sort. We never mutate the underlying columns — instead we
//! produce a permutation of row indices that the slicer/export layers use
//! when reading rows.
//!
//! Missing values always sort last, regardless of direction. This matches
//! Pandas' `na_position='last'` default.
//!
//! Two entry points:
//!   - `sort_indices` — single-key sort starting from full dataset order.
//!     Kept for the existing single-column callers and for tests.
//!   - `sort_indices_multi` — composite stable sort on a *given* indices
//!     vec, keyed on a chain of `(column, ascending)` pairs. The starting
//!     indices are the caller's: passing the result of `apply_filters` lets
//!     filter and multi-sort compose. The first key is primary; ties
//!     fall through to the second key; etc. Stability of the sort means
//!     rows that are equal on every key preserve the caller's original
//!     order — important when that order itself comes from a filter.

use crate::column::ColumnData;
use crate::errors::{KensaError, KensaResult};
use crate::types::SortSpec;
use crate::DataFrame;
use std::cmp::Ordering;

/// Single-key convenience wrapper kept around for the existing test
/// suite. Production callers go through `sort_indices_multi` directly
/// — the engine's `sort()` method now accepts a multi-key spec
/// list, so this helper is `cfg(test)` to keep production binaries
/// from carrying a now-unused symbol.
#[cfg(test)]
pub fn sort_indices(df: &DataFrame, col_index: usize, ascending: bool) -> KensaResult<Vec<usize>> {
    let mut indices: Vec<usize> = (0..df.row_count).collect();
    let spec = SortSpec {
        column_index: col_index as u32,
        ascending,
    };
    sort_indices_multi(df, &mut indices, std::slice::from_ref(&spec))?;
    Ok(indices)
}

/// Multi-key composite stable sort. `indices` is mutated in place: pass
/// the result of `apply_filters` to compose filter + sort, or pass
/// `(0..row_count).collect()` to sort the full dataset.
///
/// All `SortSpec.column_index` values are validated up front; an
/// out-of-range index yields `KensaError::ColumnIndexOutOfRange` and
/// the indices vec is left untouched. We capture validated `&ColumnData`
/// references in a small `keys` vec and have the comparator iterate
/// that — no raw indexing inside the closure, which keeps CodeQL's
/// Rust extractor happy and removes any per-comparison bounds-check.
pub fn sort_indices_multi(
    df: &DataFrame,
    indices: &mut [usize],
    sorts: &[SortSpec],
) -> KensaResult<()> {
    if sorts.is_empty() {
        return Ok(());
    }
    let keys: Vec<(&ColumnData, bool)> = sorts
        .iter()
        .map(|s| {
            let col_idx = s.column_index as usize;
            df.columns
                .get(col_idx)
                .map(|col| (col, s.ascending))
                .ok_or(KensaError::ColumnIndexOutOfRange {
                    index: col_idx,
                    count: df.columns.len(),
                })
        })
        .collect::<KensaResult<_>>()?;

    indices.sort_by(|&a, &b| {
        for &(col, ascending) in &keys {
            let order = cmp_at(col, a, b, ascending);
            if order != Ordering::Equal {
                return order;
            }
        }
        Ordering::Equal
    });
    Ok(())
}

/// Compare two row positions on a single column, honouring missing-last
/// and the `ascending` flag. Used by the multi-key comparator above
/// once per key per pair, so it stays branch-free per dtype.
fn cmp_at(col: &ColumnData, a: usize, b: usize, ascending: bool) -> Ordering {
    match col {
        ColumnData::Int64(v) => {
            let va = v.get(a).copied().unwrap_or(None);
            let vb = v.get(b).copied().unwrap_or(None);
            cmp_opt(va, vb, ascending)
        }
        ColumnData::Float64(v) => {
            let va = v.get(a).copied().unwrap_or(None).filter(|x| !x.is_nan());
            let vb = v.get(b).copied().unwrap_or(None).filter(|x| !x.is_nan());
            cmp_opt_partial(va, vb, ascending)
        }
        ColumnData::Utf8(v) => {
            let va = v.get(a).and_then(Option::as_ref);
            let vb = v.get(b).and_then(Option::as_ref);
            cmp_opt(va, vb, ascending)
        }
        ColumnData::Boolean(v) => {
            let va = v.get(a).copied().unwrap_or(None);
            let vb = v.get(b).copied().unwrap_or(None);
            cmp_opt(va, vb, ascending)
        }
        ColumnData::DateTime(v) => {
            let va = v.get(a).copied().unwrap_or(None);
            let vb = v.get(b).copied().unwrap_or(None);
            cmp_opt(va, vb, ascending)
        }
    }
}

fn cmp_opt<T: Ord + Copy>(a: Option<T>, b: Option<T>, ascending: bool) -> Ordering {
    match (a, b) {
        (Some(x), Some(y)) => if ascending { x.cmp(&y) } else { y.cmp(&x) },
        (None, None) => Ordering::Equal,
        (None, _) => Ordering::Greater,
        (_, None) => Ordering::Less,
    }
}

fn cmp_opt_partial(a: Option<f64>, b: Option<f64>, ascending: bool) -> Ordering {
    match (a, b) {
        (Some(x), Some(y)) => {
            let o = x.partial_cmp(&y).unwrap_or(Ordering::Equal);
            if ascending { o } else { o.reverse() }
        }
        (None, None) => Ordering::Equal,
        (None, _) => Ordering::Greater,
        (_, None) => Ordering::Less,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::column::ColumnData;

    #[test]
    fn sorts_integers_ascending_with_missing_last() {
        let df = DataFrame::new(
            vec![ColumnData::Int64(vec![Some(3), None, Some(1), Some(2)])],
            vec!["x".into()],
        );
        let idx = sort_indices(&df, 0, true).unwrap();
        assert_eq!(idx, vec![2, 3, 0, 1]);
    }

    #[test]
    fn sorts_strings_descending() {
        let df = DataFrame::new(
            vec![ColumnData::Utf8(vec![
                Some("b".into()),
                Some("a".into()),
                Some("c".into()),
            ])],
            vec!["x".into()],
        );
        let idx = sort_indices(&df, 0, false).unwrap();
        assert_eq!(idx, vec![2, 0, 1]);
    }

    #[test]
    fn multi_key_uses_secondary_as_tiebreaker() {
        // Group by `region` ASC, then within each region by `revenue`
        // DESC. Rows 0/2 share region "EU"; row 2 has higher revenue
        // so it should land first within the group.
        let df = DataFrame::new(
            vec![
                ColumnData::Utf8(vec![
                    Some("EU".into()),
                    Some("US".into()),
                    Some("EU".into()),
                    Some("US".into()),
                ]),
                ColumnData::Int64(vec![Some(10), Some(50), Some(30), Some(20)]),
            ],
            vec!["region".into(), "revenue".into()],
        );
        let mut indices: Vec<usize> = (0..4).collect();
        let sorts = vec![
            SortSpec {
                column_index: 0,
                ascending: true,
            },
            SortSpec {
                column_index: 1,
                ascending: false,
            },
        ];
        sort_indices_multi(&df, &mut indices, &sorts).unwrap();
        // EU group first (ASC on region), revenue 30 before 10 (DESC).
        // Then US group, revenue 50 before 20.
        assert_eq!(indices, vec![2, 0, 1, 3]);
    }
}
