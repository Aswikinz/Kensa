//! CSV / Parquet export. Always writes rows in the current view order (i.e.
//! respects sort + filter).
//!
//! The Parquet writer converts our `ColumnData` back into Arrow arrays and
//! uses the parquet crate's `ArrowWriter`. Utf8 and primitive types only;
//! datetime is written as INT64 millis without timezone.

use crate::column::ColumnData;
use crate::errors::{KensaError, KensaResult};
use crate::DataFrame;
use arrow::array::{
    ArrayRef, BooleanArray, Float64Array, Int64Array, StringArray, TimestampMillisecondArray,
};
use arrow::datatypes::{DataType, Field, Schema, TimeUnit};
use arrow::record_batch::RecordBatch;
use parquet::arrow::ArrowWriter;
use parquet::basic::Compression;
use parquet::file::properties::WriterProperties;
use std::fs::File;
use std::sync::Arc;

pub fn export_csv(
    df: &DataFrame,
    view_indices: Option<&[usize]>,
    path: &str,
) -> KensaResult<()> {
    let file = File::create(path)?;
    let mut wtr = csv::Writer::from_writer(file);
    wtr.write_record(&df.column_names)?;
    let total = match view_indices {
        Some(v) => v.len(),
        None => df.row_count,
    };
    for i in 0..total {
        let row_idx = match view_indices {
            Some(v) => v[i],
            None => i,
        };
        let row: Vec<String> = df
            .columns
            .iter()
            .map(|c| c.cell_to_string(row_idx).unwrap_or_default())
            .collect();
        wtr.write_record(&row)?;
    }
    wtr.flush().map_err(KensaError::Io)?;
    Ok(())
}

pub fn export_parquet(
    df: &DataFrame,
    view_indices: Option<&[usize]>,
    path: &str,
) -> KensaResult<()> {
    let total = match view_indices {
        Some(v) => v.len(),
        None => df.row_count,
    };

    let fields: Vec<Field> = df
        .columns
        .iter()
        .zip(df.column_names.iter())
        .map(|(c, n)| Field::new(n, dtype_for_column(c), true))
        .collect();
    let schema = Arc::new(Schema::new(fields));

    let arrays: Vec<ArrayRef> = df
        .columns
        .iter()
        .map(|c| column_to_array(c, view_indices, total))
        .collect();
    let batch = RecordBatch::try_new(schema.clone(), arrays)?;

    let props = WriterProperties::builder()
        .set_compression(Compression::SNAPPY)
        .build();
    let file = File::create(path)?;
    let mut writer = ArrowWriter::try_new(file, schema, Some(props))?;
    writer.write(&batch)?;
    writer.close()?;
    Ok(())
}

fn dtype_for_column(col: &ColumnData) -> DataType {
    match col {
        ColumnData::Int64(_) => DataType::Int64,
        ColumnData::Float64(_) => DataType::Float64,
        ColumnData::Utf8(_) => DataType::Utf8,
        ColumnData::Boolean(_) => DataType::Boolean,
        ColumnData::DateTime(_) => DataType::Timestamp(TimeUnit::Millisecond, None),
    }
}

fn column_to_array(col: &ColumnData, view: Option<&[usize]>, total: usize) -> ArrayRef {
    let idx_for = |i: usize| match view {
        Some(v) => v[i],
        None => i,
    };
    match col {
        ColumnData::Int64(v) => {
            let iter = (0..total).map(|i| v[idx_for(i)]);
            Arc::new(Int64Array::from_iter(iter))
        }
        ColumnData::Float64(v) => {
            let iter = (0..total).map(|i| v[idx_for(i)]);
            Arc::new(Float64Array::from_iter(iter))
        }
        ColumnData::Utf8(v) => {
            let iter = (0..total).map(|i| v[idx_for(i)].clone());
            Arc::new(StringArray::from_iter(iter))
        }
        ColumnData::Boolean(v) => {
            let iter = (0..total).map(|i| v[idx_for(i)]);
            Arc::new(BooleanArray::from_iter(iter))
        }
        ColumnData::DateTime(v) => {
            let iter = (0..total).map(|i| v[idx_for(i)]);
            Arc::new(TimestampMillisecondArray::from_iter(iter))
        }
    }
}
