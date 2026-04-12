//! Napi-visible DTO structs. These are the types that cross the Rust/Node.js
//! boundary. Kept separate from internal representations so we can change the
//! columnar layout without breaking the TS-facing API.

use napi_derive::napi;

/// Returned from every `load_*` call. Summarizes the freshly-loaded dataset.
#[napi(object)]
pub struct DatasetInfo {
    pub column_names: Vec<String>,
    /// Physical storage dtype ("int64", "float64", "utf8", "bool", "datetime").
    pub column_dtypes: Vec<String>,
    /// A friendlier inferred dtype label (e.g. "integer", "string").
    pub inferred_dtypes: Vec<String>,
    pub row_count: u32,
    pub column_count: u32,
}

/// A rectangular slice of the dataset in the current view order. Cells are
/// encoded as JSON-friendly strings because napi-rs does not yet have a clean
/// way to return a heterogeneous `Vec<Vec<Value>>` without custom serde work.
/// The TS side parses numeric values back as needed.
#[napi(object)]
pub struct DataSlice {
    pub rows: Vec<Vec<Option<String>>>,
    pub start_row: u32,
    pub end_row: u32,
    pub total_rows: u32,
    pub column_names: Vec<String>,
    pub column_dtypes: Vec<String>,
}

#[napi(object)]
pub struct ColumnStats {
    pub name: String,
    pub dtype: String,
    pub count: u32,
    pub missing: u32,
    pub distinct: u32,
    pub min: Option<String>,
    pub max: Option<String>,
    pub mean: Option<f64>,
    pub std: Option<f64>,
    pub sum: Option<f64>,
    pub p25: Option<f64>,
    pub p50: Option<f64>,
    pub p75: Option<f64>,
    pub top_value: Option<String>,
    pub top_count: Option<u32>,
}

#[napi(object)]
pub struct QuickInsight {
    pub column_index: u32,
    pub name: String,
    pub dtype: String,
    pub kind: String, // "numeric" | "categorical" | "boolean" | "datetime" | "empty"
    pub missing: u32,
    pub distinct: u32,
    pub histogram: Option<Vec<HistogramBin>>,
    pub frequency: Option<Vec<FrequencyEntry>>,
}

#[napi(object)]
pub struct HistogramBin {
    pub lower: f64,
    pub upper: f64,
    pub count: u32,
}

#[napi(object)]
pub struct FrequencyEntry {
    pub value: String,
    pub count: u32,
}

#[napi(object)]
pub struct FilterSpec {
    pub column_index: u32,
    /// "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains" | "starts_with"
    /// | "ends_with" | "is_missing" | "is_not_missing" | "regex"
    pub op: String,
    /// Stringified value. Numeric ops parse as f64; string ops compare raw.
    pub value: Option<String>,
    pub case_insensitive: Option<bool>,
}

#[napi(object)]
pub struct ExamplePair {
    pub input: String,
    pub output: String,
}
