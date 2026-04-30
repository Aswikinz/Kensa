//! Kensa native data engine — a columnar in-memory store with CSV/Parquet/Excel
//! readers, parallel statistics, and fast sort/filter/slice primitives, exposed
//! to Node.js via napi-rs.
//!
//! The top-level `DataEngine` struct owns a `DataFrame` plus an optional
//! `view_indices` vector that represents the current sort/filter order without
//! mutating the underlying columns. All public methods are `#[napi]`-exported
//! so the TypeScript extension host can call them synchronously or on the
//! napi thread pool via the async wrappers.

#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;

mod column;
mod csv_reader;
mod errors;
mod excel_reader;
mod export;
mod filter;
mod flashfill;
mod frequency;
mod histogram;
mod jsonl_reader;
mod parquet_reader;
mod search;
mod slicer;
mod sort;
mod stats;
mod types;

use crate::column::{infer_column_dtype, ColumnData};
use crate::errors::KensaError;
use crate::filter::{apply_filters, FilterOp};
use crate::types::{
    ColumnStats, DatasetInfo, DataSlice, ExamplePair, FilterSpec, FrequencyEntry, HistogramBin,
    QuickInsight,
};
use napi::bindgen_prelude::*;
use rayon::prelude::*;
use std::sync::Arc;

/// The in-memory columnar dataset owned by a `DataEngine`.
pub(crate) struct DataFrame {
    pub columns: Vec<ColumnData>,
    pub column_names: Vec<String>,
    pub row_count: usize,
}

impl DataFrame {
    pub fn new(columns: Vec<ColumnData>, column_names: Vec<String>) -> Self {
        let row_count = columns.first().map(|c| c.len()).unwrap_or(0);
        Self { columns, column_names, row_count }
    }

    pub fn column_count(&self) -> usize {
        self.columns.len()
    }
}

/// The engine exposed to Node.js. Holds at most one dataset at a time — open a
/// new file and the previous one is dropped.
#[napi]
pub struct DataEngine {
    df: Option<Arc<DataFrame>>,
    view_indices: Option<Vec<usize>>,
    current_path: Option<String>,
}

#[napi]
impl DataEngine {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self { df: None, view_indices: None, current_path: None }
    }

    /// Load a CSV or TSV file. `delimiter` defaults to comma, `encoding`
    /// defaults to UTF-8 with BOM-sniffing fallback to whatever
    /// `encoding_rs::Encoding::for_bom` finds.
    #[napi]
    pub fn load_csv(
        &mut self,
        path: String,
        delimiter: Option<String>,
        encoding: Option<String>,
        has_header: Option<bool>,
    ) -> Result<DatasetInfo> {
        let delim = delimiter
            .as_deref()
            .and_then(|s| s.as_bytes().first().copied())
            .unwrap_or(b',');
        let df = csv_reader::read_csv(&path, delim, encoding.as_deref(), has_header.unwrap_or(true))
            .map_err(to_napi)?;
        let info = build_info(&df);
        self.df = Some(Arc::new(df));
        self.view_indices = None;
        self.current_path = Some(path);
        Ok(info)
    }

    /// Load a Parquet file. Fast — reads the Arrow batches directly and
    /// converts each `ArrayRef` into the engine's `ColumnData`.
    #[napi]
    pub fn load_parquet(&mut self, path: String) -> Result<DatasetInfo> {
        let df = parquet_reader::read_parquet(&path).map_err(to_napi)?;
        let info = build_info(&df);
        self.df = Some(Arc::new(df));
        self.view_indices = None;
        self.current_path = Some(path);
        Ok(info)
    }

    /// Load a single sheet from an Excel workbook. `sheet` defaults to the
    /// first sheet in the workbook.
    #[napi]
    pub fn load_excel(&mut self, path: String, sheet: Option<String>) -> Result<DatasetInfo> {
        let df = excel_reader::read_excel(&path, sheet.as_deref()).map_err(to_napi)?;
        let info = build_info(&df);
        self.df = Some(Arc::new(df));
        self.view_indices = None;
        self.current_path = Some(path);
        Ok(info)
    }

    /// Load a JSON Lines file (one JSON object per line). Types are inferred
    /// per column after a full scan.
    #[napi]
    pub fn load_jsonl(&mut self, path: String) -> Result<DatasetInfo> {
        let df = jsonl_reader::read_jsonl(&path).map_err(to_napi)?;
        let info = build_info(&df);
        self.df = Some(Arc::new(df));
        self.view_indices = None;
        self.current_path = Some(path);
        Ok(info)
    }

    /// Return a slice of rows in the current view order. Inclusive `start`,
    /// exclusive `end`. Clamps to the dataset bounds.
    #[napi]
    pub fn get_slice(&self, start: u32, end: u32) -> Result<DataSlice> {
        let df = self.require_df()?;
        let slice = slicer::get_slice(df, self.view_indices.as_deref(), start as usize, end as usize);
        Ok(slice)
    }

    /// Detailed statistics for a single column. Expensive on huge columns;
    /// cache on the TS side.
    #[napi]
    pub fn get_column_stats(&self, col_index: u32) -> Result<ColumnStats> {
        let df = self.require_df()?;
        let (col, name) = column_at(df, col_index)?;
        Ok(stats::column_stats(col, name))
    }

    /// Compute quick insights (tiny histogram or frequency bars) for every
    /// column in parallel via rayon. This is what the column headers render.
    ///
    /// When `view_indices` is set (sort or filter active), each column is
    /// projected through it before computing the insight so the histogram
    /// / frequency bars reflect the rows the user is actually looking at.
    /// Without this, applying a filter would leave the headers showing the
    /// pre-filter distribution — confusing, especially after a heavy
    /// filter that drops most rows.
    #[napi]
    pub fn get_all_quick_insights(&self) -> Result<Vec<QuickInsight>> {
        let df = self.require_df()?;
        let view = self.view_indices.as_deref();
        // `.zip()` pairs each column with its matching name in lockstep,
        // eliminating the `names[i]` indexing that the previous version
        // used. CodeQL's Rust extractor couldn't prove that
        // `df.column_names.len() == df.columns.len()`, so it flagged the
        // bare `names[i]` as a potentially out-of-bounds indexing under
        // `rust/access-invalid-pointer`. Zipping the two parallel
        // iterators advances them together and removes the index
        // expression entirely.
        let insights: Vec<QuickInsight> = df
            .columns
            .par_iter()
            .zip(df.column_names.par_iter())
            .enumerate()
            .map(|(i, (col, name))| match view {
                Some(indices) => {
                    let filtered = col.filter_by_indices(indices);
                    stats::quick_insight(&filtered, name.as_str(), i as u32)
                }
                None => stats::quick_insight(col, name.as_str(), i as u32),
            })
            .collect();
        Ok(insights)
    }

    /// Sort by one column in the current view. Replaces `view_indices` with a
    /// freshly computed permutation. Stable sort.
    #[napi]
    pub fn sort(&mut self, col_index: u32, ascending: bool) -> Result<()> {
        let df = self.require_df()?;
        let indices = sort::sort_indices(df, col_index as usize, ascending)
            .map_err(to_napi)?;
        self.view_indices = Some(indices);
        Ok(())
    }

    /// Clear any active sort/filter view and return to dataset order.
    #[napi]
    pub fn reset_view(&mut self) -> Result<()> {
        self.view_indices = None;
        Ok(())
    }

    /// Apply a list of filter predicates (AND-combined). Returns the number of
    /// rows that passed the filter.
    #[napi]
    pub fn filter(&mut self, filters: Vec<FilterSpec>) -> Result<u32> {
        let df = self.require_df()?;
        let predicates: Vec<FilterOp> = filters.iter().map(FilterOp::from_spec).collect();
        let indices = apply_filters(df, &predicates).map_err(to_napi)?;
        let n = indices.len();
        self.view_indices = Some(indices);
        Ok(n as u32)
    }

    /// Substring search within a column. Returns indices into the current
    /// view order (not raw row indices).
    #[napi]
    pub fn search_values(&self, col_index: u32, query: String) -> Result<Vec<u32>> {
        let df = self.require_df()?;
        let hits = search::search_column(df, self.view_indices.as_deref(), col_index as usize, &query);
        Ok(hits.into_iter().map(|v| v as u32).collect())
    }

    /// Export the current view (post sort/filter) to a CSV file.
    #[napi]
    pub fn export_csv(&self, path: String) -> Result<()> {
        let df = self.require_df()?;
        export::export_csv(df, self.view_indices.as_deref(), &path).map_err(to_napi)
    }

    /// Export the current view to Parquet. Uses the default snappy compression.
    #[napi]
    pub fn export_parquet(&self, path: String) -> Result<()> {
        let df = self.require_df()?;
        export::export_parquet(df, self.view_indices.as_deref(), &path).map_err(to_napi)
    }

    /// Compute a histogram for a numeric column with a caller-chosen bin count.
    #[napi]
    pub fn compute_histogram(&self, col_index: u32, bins: u32) -> Result<Vec<HistogramBin>> {
        let df = self.require_df()?;
        let (col, _) = column_at(df, col_index)?;
        Ok(histogram::compute(col, bins.max(1) as usize))
    }

    /// Top-N value frequency for a column. Works on any column type.
    #[napi]
    pub fn compute_frequency(&self, col_index: u32, top_n: u32) -> Result<Vec<FrequencyEntry>> {
        let df = self.require_df()?;
        let (col, _) = column_at(df, col_index)?;
        Ok(frequency::top_n(col, top_n as usize))
    }

    /// FlashFill pattern inference. Given input/output example pairs, try to
    /// find a rule that maps column values to the outputs. Returns a generated
    /// Python/Pandas expression if a pattern is found.
    #[napi]
    pub fn infer_pattern(
        &self,
        col_index: u32,
        examples: Vec<ExamplePair>,
    ) -> Result<Option<String>> {
        let df = self.require_df()?;
        let (col, _) = column_at(df, col_index)?;
        Ok(flashfill::infer(col, &examples))
    }

    /// Current file path, if any — used by the TS mode-switching code to hand
    /// off to Python.
    #[napi]
    pub fn current_file_path(&self) -> Option<String> {
        self.current_path.clone()
    }

    /// Total row count in the current view (post-filter).
    #[napi]
    pub fn view_row_count(&self) -> u32 {
        match (&self.df, &self.view_indices) {
            (Some(df), Some(indices)) => indices.len().min(df.row_count) as u32,
            (Some(df), None) => df.row_count as u32,
            _ => 0,
        }
    }

    /// Underlying dataset row count (ignoring filters).
    #[napi]
    pub fn total_row_count(&self) -> u32 {
        self.df.as_ref().map(|d| d.row_count as u32).unwrap_or(0)
    }

    #[napi]
    pub fn column_count(&self) -> u32 {
        self.df.as_ref().map(|d| d.column_count() as u32).unwrap_or(0)
    }

    /// Drop the current dataset. The engine itself remains usable.
    #[napi]
    pub fn clear(&mut self) {
        self.df = None;
        self.view_indices = None;
        self.current_path = None;
    }
}

// -- helpers ------------------------------------------------------------------

impl DataEngine {
    /// Borrow the currently-loaded `DataFrame` or return a clean napi error.
    ///
    /// We deliberately spell out the `match` + `arc.as_ref()` path instead
    /// of the terser `self.df.as_deref()` — they're semantically identical
    /// but the explicit form makes the borrow chain obvious to static
    /// analyzers (including CodeQL's Rust extractor, which was flagging
    /// the implicit `Arc: Deref` path as a potential dangling reference).
    /// The returned reference is tied to `&self` for the whole expression,
    /// which is enforced by the borrow checker — there's no way to observe
    /// the `Arc` being dropped while this reference is live.
    fn require_df(&self) -> Result<&DataFrame> {
        match &self.df {
            Some(arc) => Ok(arc.as_ref()),
            None => Err(napi_err("no dataset loaded — call load_* first")),
        }
    }
}

/// Bounds-checked column access. Returns the column plus its header name
/// as a pair of references tied to the borrow of `df`.
///
/// All four public `#[napi]` methods that take a `col_index: u32` route
/// through here instead of hand-rolling `if idx >= len { err }; vec[idx]`.
/// Using `Vec::get` makes it impossible to ever produce a dangling
/// reference or trigger a panic on out-of-bounds access, even if the
/// caller passes a wild index from JS. The previous pattern was
/// equivalent in practice but CodeQL's bounds-check tracking didn't
/// see the guard and flagged the subsequent index as a potential
/// invalid-pointer dereference.
fn column_at<'df>(df: &'df DataFrame, col_index: u32) -> Result<(&'df ColumnData, &'df str)> {
    let idx = col_index as usize;
    let col = df
        .columns
        .get(idx)
        .ok_or_else(|| napi_err("column index out of range"))?;
    let name = df
        .column_names
        .get(idx)
        .map(String::as_str)
        .ok_or_else(|| napi_err("column index out of range"))?;
    Ok((col, name))
}

fn build_info(df: &DataFrame) -> DatasetInfo {
    let dtypes: Vec<String> = df.columns.iter().map(|c| c.dtype_name().to_string()).collect();
    let inferred: Vec<String> = df
        .columns
        .iter()
        .map(|c| infer_column_dtype(c).to_string())
        .collect();
    DatasetInfo {
        column_names: df.column_names.clone(),
        column_dtypes: dtypes,
        inferred_dtypes: inferred,
        row_count: df.row_count as u32,
        column_count: df.column_count() as u32,
    }
}

fn to_napi(err: KensaError) -> napi::Error {
    napi::Error::new(Status::GenericFailure, err.to_string())
}

fn napi_err(msg: &str) -> napi::Error {
    napi::Error::new(Status::InvalidArg, msg.to_string())
}
