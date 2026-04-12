//! Index-based sort. We never mutate the underlying columns — instead we
//! produce a permutation of row indices that the slicer/export layers use
//! when reading rows.
//!
//! Missing values always sort last, regardless of direction. This matches
//! Pandas' `na_position='last'` default.

use crate::column::ColumnData;
use crate::errors::{KensaError, KensaResult};
use crate::DataFrame;
use std::cmp::Ordering;

pub fn sort_indices(df: &DataFrame, col_index: usize, ascending: bool) -> KensaResult<Vec<usize>> {
    if col_index >= df.columns.len() {
        return Err(KensaError::ColumnIndexOutOfRange {
            index: col_index,
            count: df.columns.len(),
        });
    }
    let col = &df.columns[col_index];
    let mut indices: Vec<usize> = (0..df.row_count).collect();
    match col {
        ColumnData::Int64(v) => {
            indices.sort_by(|&a, &b| cmp_opt(v[a], v[b], ascending));
        }
        ColumnData::Float64(v) => {
            indices.sort_by(|&a, &b| {
                let va = v[a].filter(|x| !x.is_nan());
                let vb = v[b].filter(|x| !x.is_nan());
                cmp_opt_partial(va, vb, ascending)
            });
        }
        ColumnData::Utf8(v) => {
            indices.sort_by(|&a, &b| cmp_opt(v[a].as_ref(), v[b].as_ref(), ascending));
        }
        ColumnData::Boolean(v) => {
            indices.sort_by(|&a, &b| cmp_opt(v[a], v[b], ascending));
        }
        ColumnData::DateTime(v) => {
            indices.sort_by(|&a, &b| cmp_opt(v[a], v[b], ascending));
        }
    }
    Ok(indices)
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
}
