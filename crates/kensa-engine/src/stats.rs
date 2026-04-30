//! Column statistics. Two public entry points:
//!   - `column_stats` — full stats for one column (detail panel)
//!   - `quick_insight` — compact representation for the header strip
//!
//! The heavy numeric work (sort for percentiles, bin counting) is straightforward
//! sequential code; parallelism comes from running this across all columns at
//! once via `rayon` from `lib.rs`.

use crate::column::ColumnData;
use crate::frequency::top_n;
use crate::histogram::compute as compute_histogram;
use crate::types::{ColumnStats, QuickInsight};

pub fn column_stats(col: &ColumnData, name: &str) -> ColumnStats {
    let len = col.len() as u32;
    let missing = col.count_missing() as u32;
    let distinct = count_distinct(col) as u32;
    let count = len - missing;

    let mut stats = ColumnStats {
        name: name.to_string(),
        dtype: col.dtype_name().to_string(),
        count,
        missing,
        distinct,
        min: None,
        max: None,
        mean: None,
        std: None,
        sum: None,
        p25: None,
        p50: None,
        p75: None,
        top_value: None,
        top_count: None,
    };

    match col {
        ColumnData::Int64(v) => {
            let nums: Vec<f64> = v.iter().filter_map(|x| x.map(|n| n as f64)).collect();
            fill_numeric_stats(&mut stats, &nums);
        }
        ColumnData::Float64(v) => {
            let nums: Vec<f64> = v.iter().filter_map(|x| x.filter(|n| !n.is_nan())).collect();
            fill_numeric_stats(&mut stats, &nums);
        }
        ColumnData::Utf8(_) => {
            let freq = top_n(col, 1);
            if let Some(first) = freq.first() {
                stats.top_value = Some(first.value.clone());
                stats.top_count = Some(first.count);
            }
        }
        ColumnData::Boolean(_) => {
            let freq = top_n(col, 1);
            if let Some(first) = freq.first() {
                stats.top_value = Some(first.value.clone());
                stats.top_count = Some(first.count);
            }
        }
        ColumnData::DateTime(v) => {
            let nums: Vec<i64> = v.iter().filter_map(|x| *x).collect();
            if !nums.is_empty() {
                stats.min = nums.iter().min().map(|n| n.to_string());
                stats.max = nums.iter().max().map(|n| n.to_string());
            }
        }
    }

    stats
}

fn fill_numeric_stats(stats: &mut ColumnStats, nums: &[f64]) {
    if nums.is_empty() {
        return;
    }
    let sum: f64 = nums.iter().sum();
    let mean = sum / nums.len() as f64;
    let variance =
        nums.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / nums.len() as f64;
    let std = variance.sqrt();

    let mut sorted = nums.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    stats.sum = Some(sum);
    stats.mean = Some(mean);
    stats.std = Some(std);
    // `first()` / `last()` instead of `sorted[0]` / `sorted[sorted.len()-1]`.
    // The `is_empty` guard above makes both raw indexes safe, but CodeQL's
    // Rust extractor (beta) can't see that across the early return and flags
    // the bare indexes under `rust/access-invalid-pointer`.
    stats.min = sorted.first().map(|v| v.to_string());
    stats.max = sorted.last().map(|v| v.to_string());
    stats.p25 = Some(percentile(&sorted, 0.25));
    stats.p50 = Some(percentile(&sorted, 0.50));
    stats.p75 = Some(percentile(&sorted, 0.75));
}

/// Linear-interpolation percentile (same as numpy's default, type 7).
///
/// `lo` / `hi` are derived from `p * (n-1)` where `n = sorted.len()`, so both
/// are in `[0, n-1]` by construction. We still go through `Vec::get` because
/// CodeQL can't track that arithmetic as a bounds proof.
fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return f64::NAN;
    }
    let n = sorted.len();
    if n == 1 {
        return sorted.first().copied().unwrap_or(f64::NAN);
    }
    let idx = p * (n - 1) as f64;
    let lo = idx.floor() as usize;
    let hi = idx.ceil() as usize;
    let lo_val = sorted.get(lo).copied().unwrap_or(f64::NAN);
    let hi_val = sorted.get(hi).copied().unwrap_or(f64::NAN);
    if lo == hi {
        lo_val
    } else {
        let frac = idx - lo as f64;
        lo_val * (1.0 - frac) + hi_val * frac
    }
}

fn count_distinct(col: &ColumnData) -> usize {
    use std::collections::HashSet;
    match col {
        ColumnData::Int64(v) => {
            let set: HashSet<_> = v.iter().filter_map(|x| *x).collect();
            set.len()
        }
        ColumnData::Float64(v) => {
            // Float bitpattern-based dedup — good enough for cardinality.
            let set: HashSet<_> = v
                .iter()
                .filter_map(|x| x.filter(|n| !n.is_nan()).map(|n| n.to_bits()))
                .collect();
            set.len()
        }
        ColumnData::Utf8(v) => {
            let set: HashSet<&String> = v.iter().filter_map(|x| x.as_ref()).collect();
            set.len()
        }
        ColumnData::Boolean(v) => {
            let set: HashSet<_> = v.iter().filter_map(|x| *x).collect();
            set.len()
        }
        ColumnData::DateTime(v) => {
            let set: HashSet<_> = v.iter().filter_map(|x| *x).collect();
            set.len()
        }
    }
}

/// Compact header-strip representation: histogram for numeric, top-N bars for
/// text/bool, missing/distinct counts always.
pub fn quick_insight(col: &ColumnData, name: &str, column_index: u32) -> QuickInsight {
    let missing = col.count_missing() as u32;
    let distinct = count_distinct(col) as u32;
    match col {
        ColumnData::Int64(_) | ColumnData::Float64(_) => QuickInsight {
            column_index,
            name: name.to_string(),
            dtype: col.dtype_name().to_string(),
            kind: "numeric".to_string(),
            missing,
            distinct,
            histogram: Some(compute_histogram(col, 12)),
            frequency: None,
        },
        ColumnData::Boolean(_) => QuickInsight {
            column_index,
            name: name.to_string(),
            dtype: col.dtype_name().to_string(),
            kind: "boolean".to_string(),
            missing,
            distinct,
            histogram: None,
            frequency: Some(top_n(col, 2)),
        },
        ColumnData::DateTime(_) => QuickInsight {
            column_index,
            name: name.to_string(),
            dtype: col.dtype_name().to_string(),
            kind: "datetime".to_string(),
            missing,
            distinct,
            histogram: Some(compute_histogram(col, 12)),
            frequency: None,
        },
        ColumnData::Utf8(_) => QuickInsight {
            column_index,
            name: name.to_string(),
            dtype: col.dtype_name().to_string(),
            kind: "categorical".to_string(),
            missing,
            distinct,
            histogram: None,
            frequency: Some(top_n(col, 5)),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::column::ColumnData;

    #[test]
    fn numeric_stats_match_expected() {
        let col = ColumnData::Float64(vec![Some(1.0), Some(2.0), Some(3.0), Some(4.0), Some(5.0)]);
        let s = column_stats(&col, "x");
        assert_eq!(s.count, 5);
        assert_eq!(s.missing, 0);
        assert!((s.mean.unwrap() - 3.0).abs() < 1e-9);
        assert!((s.p50.unwrap() - 3.0).abs() < 1e-9);
    }

    #[test]
    fn string_stats_report_top_value() {
        let col = ColumnData::Utf8(vec![
            Some("A".into()),
            Some("B".into()),
            Some("A".into()),
            None,
        ]);
        let s = column_stats(&col, "x");
        assert_eq!(s.missing, 1);
        assert_eq!(s.top_value.as_deref(), Some("A"));
    }

    #[test]
    fn quick_insight_on_filtered_subset_uses_subset_distinct() {
        // The whole column has 3 distinct values; the filtered view (rows
        // 0 and 2) only has 1. quick_insight on the filtered column
        // should reflect the smaller cardinality, which is the property
        // that lets the column-header viz update post-filter.
        let col = ColumnData::Utf8(vec![
            Some("A".into()),
            Some("B".into()),
            Some("A".into()),
            Some("C".into()),
        ]);
        let filtered = col.filter_by_indices(&[0, 2]);
        let insight = quick_insight(&filtered, "x", 0);
        assert_eq!(insight.distinct, 1);
        assert_eq!(insight.missing, 0);
        let freq = insight.frequency.expect("Utf8 column should emit frequency");
        assert_eq!(freq.len(), 1);
        assert_eq!(freq[0].value, "A");
        assert_eq!(freq[0].count, 2);
    }
}
