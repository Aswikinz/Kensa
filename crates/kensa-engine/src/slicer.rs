//! Row slicing for pagination. Returns rows as `Vec<Vec<Option<String>>>` —
//! the TS side receives JSON-friendly stringified cells and reparses as needed.
//! Slicing respects the current view order (sort/filter) when `view_indices` is
//! provided.

use crate::types::DataSlice;
use crate::DataFrame;

pub fn get_slice(
    df: &DataFrame,
    view_indices: Option<&[usize]>,
    start: usize,
    end: usize,
) -> DataSlice {
    let total = match view_indices {
        Some(v) => v.len(),
        None => df.row_count,
    };
    let start = start.min(total);
    let end = end.min(total).max(start);

    let mut rows = Vec::with_capacity(end - start);
    // View-index lookup uses `.get(i)` rather than `v[i]`. `i < end <= total`
    // and `total == v.len()`, so this is infallible by construction — but
    // CodeQL's Rust extractor can't see that, and flags the raw index as a
    // potential OOB deref under `rust/access-invalid-pointer`.
    for i in start..end {
        let row_idx = match view_indices {
            Some(v) => match v.get(i) {
                Some(&idx) => idx,
                None => break,
            },
            None => i,
        };
        let row: Vec<Option<String>> = df
            .columns
            .iter()
            .map(|col| col.cell_to_string(row_idx))
            .collect();
        rows.push(row);
    }

    DataSlice {
        rows,
        start_row: start as u32,
        end_row: end as u32,
        total_rows: total as u32,
        column_names: df.column_names.clone(),
        column_dtypes: df.columns.iter().map(|c| c.dtype_name().to_string()).collect(),
    }
}
