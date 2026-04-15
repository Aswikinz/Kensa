//! JSON Lines reader: one JSON object per line. Column set is the union of
//! keys across all rows; per-column type inference picks the most specific
//! type that holds across the whole column.

use crate::column::{build_typed_column, infer_type_from_samples};
use crate::errors::KensaResult;
use crate::DataFrame;
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{BufRead, BufReader};

pub fn read_jsonl(path: &str) -> KensaResult<DataFrame> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);

    let mut rows: Vec<BTreeMap<String, Value>> = Vec::new();
    let mut key_order: Vec<String> = Vec::new();

    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let parsed: Value = serde_json::from_str(&line)?;
        let obj = match parsed {
            Value::Object(m) => m.into_iter().collect::<BTreeMap<_, _>>(),
            other => {
                let mut m = BTreeMap::new();
                m.insert("value".to_string(), other);
                m
            }
        };
        for k in obj.keys() {
            if !key_order.iter().any(|e| e == k) {
                key_order.push(k.clone());
            }
        }
        rows.push(obj);
    }

    let n_rows = rows.len();
    let mut raw_columns: Vec<Vec<Option<String>>> =
        key_order.iter().map(|_| Vec::with_capacity(n_rows)).collect();

    // `.get_mut(col_idx)` instead of `raw_columns[col_idx]`. `col_idx` comes
    // from the enumerated iterator over `key_order`, and `raw_columns` was
    // built with one entry per key — but CodeQL's Rust extractor can't prove
    // `raw_columns.len() == key_order.len()` and flags the raw index as a
    // potential OOB deref.
    for row in &rows {
        for (col_idx, key) in key_order.iter().enumerate() {
            let cell = row.get(key).and_then(value_to_string);
            if let Some(col) = raw_columns.get_mut(col_idx) {
                col.push(cell);
            }
        }
    }

    let columns = raw_columns
        .into_iter()
        .map(|col| {
            let sample: Vec<&str> = col.iter().filter_map(|o| o.as_deref()).take(2048).collect();
            let ty = infer_type_from_samples(&sample);
            build_typed_column(col, ty)
        })
        .collect();

    Ok(DataFrame::new(columns, key_order))
}

fn value_to_string(v: &Value) -> Option<String> {
    match v {
        Value::Null => None,
        Value::Bool(b) => Some(b.to_string()),
        Value::Number(n) => Some(n.to_string()),
        Value::String(s) => Some(s.clone()),
        Value::Array(_) | Value::Object(_) => Some(v.to_string()),
    }
}
