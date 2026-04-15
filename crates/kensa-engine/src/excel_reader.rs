//! Excel reader via calamine. Reads a single sheet into raw string cells then
//! runs the same type inference path as the CSV reader.

use crate::column::{build_typed_column, infer_type_from_samples, is_na_token};
use crate::errors::{KensaError, KensaResult};
use crate::DataFrame;
use calamine::{open_workbook_auto, Data, Reader};

const TYPE_INFERENCE_SAMPLE_SIZE: usize = 2048;

pub fn read_excel(path: &str, sheet: Option<&str>) -> KensaResult<DataFrame> {
    let mut workbook = open_workbook_auto(path).map_err(|e| KensaError::Excel(e.to_string()))?;
    let sheet_name = match sheet {
        Some(s) => s.to_string(),
        None => workbook
            .sheet_names()
            .first()
            .cloned()
            .ok_or_else(|| KensaError::Excel("workbook has no sheets".into()))?,
    };
    let range = workbook
        .worksheet_range(&sheet_name)
        .map_err(|e| KensaError::Excel(e.to_string()))?;

    let mut rows = range.rows();
    let header_row: Vec<String> = rows
        .next()
        .map(|r| r.iter().map(cell_to_string).collect())
        .unwrap_or_default();
    let n_cols = header_row.len();

    let mut raw_columns: Vec<Vec<Option<String>>> = vec![Vec::new(); n_cols];
    for row in rows {
        for i in 0..n_cols {
            let v = row.get(i).map(cell_to_string).unwrap_or_default();
            let cell = if v.is_empty() || is_na_token(&v) {
                None
            } else {
                Some(v)
            };
            // `.get_mut(i)` rather than `raw_columns[i]`. `i < n_cols` and
            // `raw_columns.len() == n_cols`, so the bounds hold — but
            // CodeQL can't see that invariant.
            if let Some(col) = raw_columns.get_mut(i) {
                col.push(cell);
            }
        }
    }

    let columns = raw_columns
        .into_iter()
        .map(|col| {
            let sample: Vec<&str> = col
                .iter()
                .take(TYPE_INFERENCE_SAMPLE_SIZE)
                .filter_map(|o| o.as_deref())
                .collect();
            let ty = infer_type_from_samples(&sample);
            build_typed_column(col, ty)
        })
        .collect();

    Ok(DataFrame::new(columns, header_row))
}

fn cell_to_string(cell: &Data) -> String {
    match cell {
        Data::Empty => String::new(),
        Data::String(s) => s.clone(),
        Data::Float(f) => f.to_string(),
        Data::Int(i) => i.to_string(),
        Data::Bool(b) => b.to_string(),
        Data::DateTime(d) => d.to_string(),
        Data::DateTimeIso(s) => s.clone(),
        Data::DurationIso(s) => s.clone(),
        Data::Error(e) => format!("#ERR:{:?}", e),
    }
}
