//! Value frequency ("top N") for any column. String cells are counted directly;
//! numeric cells are stringified with one decimal for consistent keys.

use crate::column::ColumnData;
use crate::types::FrequencyEntry;
use std::collections::HashMap;

pub fn top_n(col: &ColumnData, n: usize) -> Vec<FrequencyEntry> {
    let mut counts: HashMap<String, u32> = HashMap::new();

    match col {
        ColumnData::Int64(v) => {
            for x in v.iter().flatten() {
                *counts.entry(x.to_string()).or_insert(0) += 1;
            }
        }
        ColumnData::Float64(v) => {
            for x in v.iter().filter_map(|o| o.filter(|n| !n.is_nan())) {
                *counts.entry(format!("{}", x)).or_insert(0) += 1;
            }
        }
        ColumnData::Utf8(v) => {
            for s in v.iter().flatten() {
                *counts.entry(s.clone()).or_insert(0) += 1;
            }
        }
        ColumnData::Boolean(v) => {
            for b in v.iter().flatten() {
                *counts.entry(b.to_string()).or_insert(0) += 1;
            }
        }
        ColumnData::DateTime(v) => {
            for x in v.iter().flatten() {
                *counts.entry(x.to_string()).or_insert(0) += 1;
            }
        }
    }

    let mut entries: Vec<(String, u32)> = counts.into_iter().collect();
    entries.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    entries.truncate(n);
    entries
        .into_iter()
        .map(|(value, count)| FrequencyEntry { value, count })
        .collect()
}
