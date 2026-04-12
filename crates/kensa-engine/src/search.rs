//! Substring search within a column. Returns row indices (in the current
//! view order) whose stringified cell contains the query. Case-insensitive.

use crate::DataFrame;

pub fn search_column(
    df: &DataFrame,
    view_indices: Option<&[usize]>,
    col_index: usize,
    query: &str,
) -> Vec<usize> {
    if col_index >= df.columns.len() {
        return Vec::new();
    }
    let col = &df.columns[col_index];
    let needle = query.to_lowercase();
    let total = match view_indices {
        Some(v) => v.len(),
        None => df.row_count,
    };

    let mut hits = Vec::new();
    for i in 0..total {
        let row_idx = match view_indices {
            Some(v) => v[i],
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
