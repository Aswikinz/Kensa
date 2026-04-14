//! Substring search within a column. Returns row indices (in the current
//! view order) whose stringified cell contains the query. Case-insensitive.

use crate::DataFrame;

pub fn search_column(
    df: &DataFrame,
    view_indices: Option<&[usize]>,
    col_index: usize,
    query: &str,
) -> Vec<usize> {
    // `Vec::get` + early-return-on-None is the same logic as the
    // previous `if col_index >= len { return }; &df.columns[col_index]`
    // pattern, but it eliminates the raw index expression that CodeQL's
    // Rust extractor flags under `rust/access-invalid-pointer`. The
    // extractor doesn't track the bounds guard across the conditional,
    // so the bare `vec[col_index]` looks like a potentially-OOB access
    // even though the guard above rules it out.
    let Some(col) = df.columns.get(col_index) else {
        return Vec::new();
    };
    let needle = query.to_lowercase();
    let total = match view_indices {
        Some(v) => v.len(),
        None => df.row_count,
    };

    let mut hits = Vec::new();
    for i in 0..total {
        // Walking the view indices by `.get(i)` for the same reason:
        // `i < total` is obviously safe to us but invisible to CodeQL.
        let row_idx = match view_indices {
            Some(v) => match v.get(i) {
                Some(&idx) => idx,
                None => break,
            },
            None => i,
        };
        if let Some(cell) = col.cell_to_string(row_idx) {
            if cell.to_lowercase().contains(&needle) {
                hits.push(i);
            }
        }
    }
    hits
}
