//! Column storage: one enum per supported dtype. Nullable cells are
//! represented as `Option<T>` rather than a separate validity bitmap — simpler
//! and fast enough for our working sizes.

use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};

#[derive(Debug, Clone)]
pub enum ColumnData {
    Int64(Vec<Option<i64>>),
    Float64(Vec<Option<f64>>),
    Utf8(Vec<Option<String>>),
    Boolean(Vec<Option<bool>>),
    /// Epoch milliseconds, UTC.
    DateTime(Vec<Option<i64>>),
}

impl ColumnData {
    pub fn len(&self) -> usize {
        match self {
            ColumnData::Int64(v) => v.len(),
            ColumnData::Float64(v) => v.len(),
            ColumnData::Utf8(v) => v.len(),
            ColumnData::Boolean(v) => v.len(),
            ColumnData::DateTime(v) => v.len(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn dtype_name(&self) -> &'static str {
        match self {
            ColumnData::Int64(_) => "int64",
            ColumnData::Float64(_) => "float64",
            ColumnData::Utf8(_) => "utf8",
            ColumnData::Boolean(_) => "bool",
            ColumnData::DateTime(_) => "datetime",
        }
    }

    /// Format a single cell as a string for the grid. `None` becomes `None`
    /// (the TS side renders that as a dimmed "null").
    pub fn cell_to_string(&self, row: usize) -> Option<String> {
        match self {
            ColumnData::Int64(v) => v.get(row).copied().flatten().map(|x| x.to_string()),
            ColumnData::Float64(v) => v.get(row).copied().flatten().map(format_float),
            ColumnData::Utf8(v) => v.get(row).and_then(|x| x.clone()),
            ColumnData::Boolean(v) => v.get(row).copied().flatten().map(|b| b.to_string()),
            ColumnData::DateTime(v) => v
                .get(row)
                .copied()
                .flatten()
                .and_then(|ms| DateTime::<Utc>::from_timestamp_millis(ms))
                .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string()),
        }
    }

    pub fn is_missing(&self, row: usize) -> bool {
        match self {
            ColumnData::Int64(v) => v.get(row).map_or(true, |c| c.is_none()),
            ColumnData::Float64(v) => v
                .get(row)
                .map_or(true, |c| c.map_or(true, |x| x.is_nan())),
            ColumnData::Utf8(v) => v.get(row).map_or(true, |c| c.is_none()),
            ColumnData::Boolean(v) => v.get(row).map_or(true, |c| c.is_none()),
            ColumnData::DateTime(v) => v.get(row).map_or(true, |c| c.is_none()),
        }
    }

    pub fn count_missing(&self) -> usize {
        (0..self.len()).filter(|&i| self.is_missing(i)).count()
    }
}

fn format_float(x: f64) -> String {
    if x.is_nan() {
        "NaN".to_string()
    } else if x.fract() == 0.0 && x.abs() < 1e16 {
        format!("{:.1}", x)
    } else {
        format!("{}", x)
    }
}

/// A friendlier dtype label for UI display.
pub fn infer_column_dtype(col: &ColumnData) -> &'static str {
    match col {
        ColumnData::Int64(_) => "integer",
        ColumnData::Float64(_) => "float",
        ColumnData::Utf8(_) => "string",
        ColumnData::Boolean(_) => "boolean",
        ColumnData::DateTime(_) => "datetime",
    }
}

/// Try to parse a raw string cell into the most-specific type that still
/// holds for the whole column. Used by the CSV reader's second pass.
pub fn infer_type_from_samples(samples: &[&str]) -> InferredType {
    let mut all_int = true;
    let mut all_float = true;
    let mut all_bool = true;
    let mut all_dt = true;
    let mut any_non_empty = false;

    for raw in samples {
        let s = raw.trim();
        if s.is_empty() || is_na_token(s) {
            continue;
        }
        any_non_empty = true;
        if all_int && s.parse::<i64>().is_err() {
            all_int = false;
        }
        if all_float && s.parse::<f64>().is_err() {
            all_float = false;
        }
        if all_bool && !is_bool_token(s) {
            all_bool = false;
        }
        if all_dt && parse_datetime(s).is_none() {
            all_dt = false;
        }
        if !all_int && !all_float && !all_bool && !all_dt {
            break;
        }
    }

    if !any_non_empty {
        return InferredType::Utf8;
    }
    if all_int {
        InferredType::Int64
    } else if all_float {
        InferredType::Float64
    } else if all_bool {
        InferredType::Boolean
    } else if all_dt {
        InferredType::DateTime
    } else {
        InferredType::Utf8
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InferredType {
    Int64,
    Float64,
    Utf8,
    Boolean,
    DateTime,
}

pub fn is_na_token(s: &str) -> bool {
    matches!(s, "" | "NA" | "N/A" | "na" | "n/a" | "NULL" | "null" | "NaN" | "nan" | "None" | "-")
}

pub fn is_bool_token(s: &str) -> bool {
    matches!(
        s,
        "true" | "false" | "True" | "False" | "TRUE" | "FALSE" | "0" | "1" | "yes" | "no"
    )
}

pub fn parse_bool(s: &str) -> Option<bool> {
    match s {
        "true" | "True" | "TRUE" | "1" | "yes" | "Yes" | "YES" => Some(true),
        "false" | "False" | "FALSE" | "0" | "no" | "No" | "NO" => Some(false),
        _ => None,
    }
}

/// Parse a datetime string into epoch millis. Accepts the common ISO forms
/// plus `YYYY-MM-DD`-only dates, which are widened to 00:00:00Z.
pub fn parse_datetime(s: &str) -> Option<i64> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Some(dt.with_timezone(&Utc).timestamp_millis());
    }
    for fmt in &[
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y/%m/%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
    ] {
        if let Ok(dt) = NaiveDateTime::parse_from_str(s, fmt) {
            return Some(dt.and_utc().timestamp_millis());
        }
    }
    if let Ok(d) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return Some(
            d.and_hms_opt(0, 0, 0)
                .unwrap_or_default()
                .and_utc()
                .timestamp_millis(),
        );
    }
    None
}

/// Build a strongly-typed column from the raw string values in a CSV row vec,
/// using the previously inferred type.
pub fn build_typed_column(raw: Vec<Option<String>>, ty: InferredType) -> ColumnData {
    match ty {
        InferredType::Int64 => ColumnData::Int64(
            raw.into_iter()
                .map(|o| o.and_then(|s| s.trim().parse::<i64>().ok()))
                .collect(),
        ),
        InferredType::Float64 => ColumnData::Float64(
            raw.into_iter()
                .map(|o| o.and_then(|s| s.trim().parse::<f64>().ok()))
                .collect(),
        ),
        InferredType::Boolean => ColumnData::Boolean(
            raw.into_iter()
                .map(|o| o.and_then(|s| parse_bool(s.trim())))
                .collect(),
        ),
        InferredType::DateTime => ColumnData::DateTime(
            raw.into_iter()
                .map(|o| o.and_then(|s| parse_datetime(s.trim())))
                .collect(),
        ),
        InferredType::Utf8 => ColumnData::Utf8(raw),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn infer_numeric() {
        assert_eq!(infer_type_from_samples(&["1", "2", "3"]), InferredType::Int64);
        assert_eq!(infer_type_from_samples(&["1.0", "2", "3"]), InferredType::Float64);
    }

    #[test]
    fn infer_bool() {
        assert_eq!(
            infer_type_from_samples(&["true", "false", "true"]),
            InferredType::Boolean
        );
    }

    #[test]
    fn infer_falls_back_to_utf8() {
        assert_eq!(
            infer_type_from_samples(&["foo", "1", "true"]),
            InferredType::Utf8
        );
    }

    #[test]
    fn missing_values_dont_break_inference() {
        assert_eq!(
            infer_type_from_samples(&["1", "", "NA", "2"]),
            InferredType::Int64
        );
    }
}
