//! CSV / TSV reader. Two passes: one to collect raw cells into per-column
//! string vectors, a second to infer types and build typed `ColumnData`.
//! Encoding detection uses `encoding_rs`: we try the caller's hint first, then
//! BOM-sniff, then fall back to UTF-8 with lossy replacement.

use crate::column::{build_typed_column, infer_type_from_samples, is_na_token};
use crate::errors::{KensaError, KensaResult};
use crate::DataFrame;
use encoding_rs::{Encoding, UTF_8};
use encoding_rs_io::DecodeReaderBytesBuilder;
use std::fs::File;
use std::io::{BufReader, Read};

const TYPE_INFERENCE_SAMPLE_SIZE: usize = 2048;

pub fn read_csv(
    path: &str,
    delimiter: u8,
    encoding_name: Option<&str>,
    has_header: bool,
) -> KensaResult<DataFrame> {
    let file = File::open(path)?;
    let encoding = resolve_encoding(encoding_name);

    // Wrap the file in a transcoding reader so the csv crate always sees UTF-8.
    let decoded = DecodeReaderBytesBuilder::new()
        .encoding(Some(encoding))
        .bom_sniffing(true)
        .build(BufReader::new(file));

    let mut rdr = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .has_headers(has_header)
        .flexible(true)
        .from_reader(decoded);

    let headers: Vec<String> = if has_header {
        rdr.headers()?.iter().map(|s| s.to_string()).collect()
    } else {
        Vec::new()
    };

    // Collect all records as raw strings so we can run type inference in
    // column-major order afterwards.
    let mut raw_columns: Vec<Vec<Option<String>>> = Vec::new();

    for record in rdr.records() {
        let record = record?;
        if raw_columns.is_empty() {
            raw_columns = vec![Vec::new(); record.len().max(headers.len())];
        }
        for (i, field) in record.iter().enumerate() {
            if i >= raw_columns.len() {
                raw_columns.push(Vec::new());
            }
            let trimmed = field.trim();
            let cell = if trimmed.is_empty() || is_na_token(trimmed) {
                None
            } else {
                Some(field.to_string())
            };
            // `.get_mut(i)` instead of `raw_columns[i]`. The branch above
            // guarantees `i < raw_columns.len()`, but CodeQL's Rust extractor
            // can't track that and flags the raw index as a potential OOB
            // deref under `rust/access-invalid-pointer`.
            if let Some(col) = raw_columns.get_mut(i) {
                col.push(cell);
            }
        }
        // Pad short rows so all columns stay aligned.
        let max_len = raw_columns.iter().map(|c| c.len()).max().unwrap_or(0);
        for col in raw_columns.iter_mut() {
            while col.len() < max_len {
                col.push(None);
            }
        }
    }

    let column_names: Vec<String> = if headers.is_empty() {
        (0..raw_columns.len()).map(|i| format!("col_{}", i + 1)).collect()
    } else if headers.len() < raw_columns.len() {
        let mut h = headers.clone();
        for i in h.len()..raw_columns.len() {
            h.push(format!("col_{}", i + 1));
        }
        h
    } else {
        headers
    };

    // Type inference + typed build.
    let columns: Vec<_> = raw_columns
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

    Ok(DataFrame::new(columns, column_names))
}

fn resolve_encoding(name: Option<&str>) -> &'static Encoding {
    name.and_then(|n| Encoding::for_label(n.as_bytes())).unwrap_or(UTF_8)
}

/// Read the first N bytes of a file as bytes. Used for encoding sniffing
/// before committing to a full decode.
#[allow(dead_code)]
pub fn peek_raw(path: &str, n: usize) -> KensaResult<Vec<u8>> {
    let mut f = File::open(path)?;
    let mut buf = vec![0u8; n];
    let read = f.read(&mut buf).map_err(KensaError::Io)?;
    buf.truncate(read);
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn reads_basic_csv() {
        let tmp = std::env::temp_dir().join("kensa_csv_test.csv");
        let mut f = File::create(&tmp).unwrap();
        writeln!(f, "name,age,city").unwrap();
        writeln!(f, "Alice,30,NY").unwrap();
        writeln!(f, "Bob,25,LA").unwrap();
        writeln!(f, "Carol,,SF").unwrap();
        f.flush().unwrap();

        let df = read_csv(tmp.to_str().unwrap(), b',', None, true).unwrap();
        assert_eq!(df.row_count, 3);
        assert_eq!(df.column_names, vec!["name", "age", "city"]);
        assert_eq!(df.columns.len(), 3);
    }
}
