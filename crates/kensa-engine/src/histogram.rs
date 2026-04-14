//! Histogram binning for numeric / datetime columns. Equal-width bins over
//! [min, max]. Empty columns return an empty vector.

use crate::column::ColumnData;
use crate::types::HistogramBin;

pub fn compute(col: &ColumnData, bins: usize) -> Vec<HistogramBin> {
    let values: Vec<f64> = match col {
        ColumnData::Int64(v) => v.iter().filter_map(|x| x.map(|n| n as f64)).collect(),
        ColumnData::Float64(v) => v.iter().filter_map(|x| x.filter(|n| !n.is_nan())).collect(),
        ColumnData::DateTime(v) => v.iter().filter_map(|x| x.map(|n| n as f64)).collect(),
        _ => return Vec::new(),
    };

    if values.is_empty() {
        return Vec::new();
    }

    let min = values.iter().copied().fold(f64::INFINITY, f64::min);
    let max = values.iter().copied().fold(f64::NEG_INFINITY, f64::max);

    if (max - min).abs() < f64::EPSILON {
        return vec![HistogramBin {
            lower: min,
            upper: max,
            count: values.len() as u32,
        }];
    }

    let n = bins.max(1);
    let width = (max - min) / n as f64;
    let mut counts = vec![0u32; n];

    // `idx` is clamped to `[0, n)` and `counts` has length `n`, so both the
    // write and read below are bounded by construction. CodeQL's Rust
    // extractor can't see the clamps though, so we use `.get_mut()` /
    // `.get()` — same semantics, no raw index expression for the
    // `rust/access-invalid-pointer` rule to flag.
    for v in &values {
        let mut idx = ((v - min) / width).floor() as isize;
        if idx < 0 {
            idx = 0;
        }
        if idx as usize >= n {
            idx = (n - 1) as isize;
        }
        if let Some(slot) = counts.get_mut(idx as usize) {
            *slot += 1;
        }
    }

    (0..n)
        .map(|i| HistogramBin {
            lower: min + i as f64 * width,
            upper: min + (i + 1) as f64 * width,
            count: counts.get(i).copied().unwrap_or(0),
        })
        .collect()
}
