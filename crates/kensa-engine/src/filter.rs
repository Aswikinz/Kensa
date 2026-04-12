//! Filter predicates. Each `FilterSpec` from the TS side is compiled into a
//! `FilterOp`, which is a borrowed closure-like struct that can be applied to a
//! column cell by index. Multiple filters are AND-combined.

use crate::column::ColumnData;
use crate::errors::{KensaError, KensaResult};
use crate::types::FilterSpec;
use crate::DataFrame;
use regex::RegexBuilder;

#[derive(Debug, Clone)]
pub struct FilterOp {
    pub column_index: usize,
    pub op: FilterKind,
    pub value: Option<String>,
    pub case_insensitive: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FilterKind {
    Eq,
    Ne,
    Gt,
    Gte,
    Lt,
    Lte,
    Contains,
    StartsWith,
    EndsWith,
    IsMissing,
    IsNotMissing,
    Regex,
}

impl FilterOp {
    pub fn from_spec(spec: &FilterSpec) -> Self {
        let kind = match spec.op.as_str() {
            "eq" => FilterKind::Eq,
            "ne" => FilterKind::Ne,
            "gt" => FilterKind::Gt,
            "gte" => FilterKind::Gte,
            "lt" => FilterKind::Lt,
            "lte" => FilterKind::Lte,
            "contains" => FilterKind::Contains,
            "starts_with" => FilterKind::StartsWith,
            "ends_with" => FilterKind::EndsWith,
            "is_missing" => FilterKind::IsMissing,
            "is_not_missing" => FilterKind::IsNotMissing,
            "regex" => FilterKind::Regex,
            _ => FilterKind::Eq,
        };
        Self {
            column_index: spec.column_index as usize,
            op: kind,
            value: spec.value.clone(),
            case_insensitive: spec.case_insensitive.unwrap_or(false),
        }
    }
}

pub fn apply_filters(df: &DataFrame, filters: &[FilterOp]) -> KensaResult<Vec<usize>> {
    for f in filters {
        if f.column_index >= df.columns.len() {
            return Err(KensaError::ColumnIndexOutOfRange {
                index: f.column_index,
                count: df.columns.len(),
            });
        }
    }

    let mut out = Vec::with_capacity(df.row_count / 2);
    for row in 0..df.row_count {
        let mut keep = true;
        for f in filters {
            if !row_matches(&df.columns[f.column_index], row, f)? {
                keep = false;
                break;
            }
        }
        if keep {
            out.push(row);
        }
    }
    Ok(out)
}

fn row_matches(col: &ColumnData, row: usize, f: &FilterOp) -> KensaResult<bool> {
    match f.op {
        FilterKind::IsMissing => Ok(col.is_missing(row)),
        FilterKind::IsNotMissing => Ok(!col.is_missing(row)),
        _ => {
            if col.is_missing(row) {
                return Ok(false);
            }
            let v = f
                .value
                .as_deref()
                .ok_or_else(|| KensaError::InvalidFilter("value required".into()))?;
            match col {
                ColumnData::Int64(arr) => {
                    let x = arr[row].unwrap();
                    let target = v.parse::<i64>().map_err(|e| KensaError::InvalidFilter(e.to_string()))?;
                    Ok(compare_ord(x, target, &f.op))
                }
                ColumnData::Float64(arr) => {
                    let x = arr[row].unwrap();
                    let target = v.parse::<f64>().map_err(|e| KensaError::InvalidFilter(e.to_string()))?;
                    Ok(compare_partial(x, target, &f.op))
                }
                ColumnData::Boolean(arr) => {
                    let x = arr[row].unwrap();
                    let target = matches!(v, "true" | "True" | "1");
                    Ok(match f.op {
                        FilterKind::Eq => x == target,
                        FilterKind::Ne => x != target,
                        _ => false,
                    })
                }
                ColumnData::DateTime(arr) => {
                    let x = arr[row].unwrap();
                    let target = v.parse::<i64>().map_err(|e| KensaError::InvalidFilter(e.to_string()))?;
                    Ok(compare_ord(x, target, &f.op))
                }
                ColumnData::Utf8(arr) => {
                    let s = arr[row].as_deref().unwrap();
                    let (haystack, needle) = if f.case_insensitive {
                        (s.to_lowercase(), v.to_lowercase())
                    } else {
                        (s.to_string(), v.to_string())
                    };
                    Ok(match f.op {
                        FilterKind::Eq => haystack == needle,
                        FilterKind::Ne => haystack != needle,
                        FilterKind::Contains => haystack.contains(&needle),
                        FilterKind::StartsWith => haystack.starts_with(&needle),
                        FilterKind::EndsWith => haystack.ends_with(&needle),
                        FilterKind::Gt => haystack > needle,
                        FilterKind::Gte => haystack >= needle,
                        FilterKind::Lt => haystack < needle,
                        FilterKind::Lte => haystack <= needle,
                        FilterKind::Regex => {
                            let re = RegexBuilder::new(v)
                                .case_insensitive(f.case_insensitive)
                                .build()
                                .map_err(|e| KensaError::InvalidFilter(e.to_string()))?;
                            re.is_match(s)
                        }
                        _ => false,
                    })
                }
            }
        }
    }
}

fn compare_ord<T: Ord>(a: T, b: T, op: &FilterKind) -> bool {
    use std::cmp::Ordering::*;
    let ord = a.cmp(&b);
    match op {
        FilterKind::Eq => ord == Equal,
        FilterKind::Ne => ord != Equal,
        FilterKind::Gt => ord == Greater,
        FilterKind::Gte => ord != Less,
        FilterKind::Lt => ord == Less,
        FilterKind::Lte => ord != Greater,
        _ => false,
    }
}

fn compare_partial(a: f64, b: f64, op: &FilterKind) -> bool {
    let ord = match a.partial_cmp(&b) {
        Some(o) => o,
        None => return false,
    };
    use std::cmp::Ordering::*;
    match op {
        FilterKind::Eq => ord == Equal,
        FilterKind::Ne => ord != Equal,
        FilterKind::Gt => ord == Greater,
        FilterKind::Gte => ord != Less,
        FilterKind::Lt => ord == Less,
        FilterKind::Lte => ord != Greater,
        _ => false,
    }
}
