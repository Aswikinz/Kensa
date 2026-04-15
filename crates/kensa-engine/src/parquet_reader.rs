//! Parquet reader. Uses the `parquet` crate to stream Arrow `RecordBatch`es
//! and converts each Arrow array into `ColumnData`. Only the common dtypes are
//! mapped natively; everything else is stringified via the Arrow display
//! formatter.

use crate::column::ColumnData;
use crate::errors::KensaResult;
use crate::DataFrame;
use arrow::array::{
    Array, BooleanArray, Float32Array, Float64Array, Int16Array, Int32Array, Int64Array,
    Int8Array, StringArray, TimestampMicrosecondArray, TimestampMillisecondArray,
    TimestampNanosecondArray, TimestampSecondArray, UInt16Array, UInt32Array, UInt64Array,
    UInt8Array,
};
use arrow::datatypes::{DataType, TimeUnit};
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use std::fs::File;

pub fn read_parquet(path: &str) -> KensaResult<DataFrame> {
    let file = File::open(path)?;
    let builder = ParquetRecordBatchReaderBuilder::try_new(file)?;
    let schema = builder.schema().clone();
    let reader = builder.build()?;

    let column_names: Vec<String> = schema.fields().iter().map(|f| f.name().clone()).collect();
    let mut accumulators: Vec<ColumnAccumulator> = schema
        .fields()
        .iter()
        .map(|f| ColumnAccumulator::from_dtype(f.data_type()))
        .collect();

    // `.get_mut(i)` instead of `accumulators[i]`. `accumulators` was built
    // from the parquet schema and each `RecordBatch` is produced from the
    // same schema, so `i < accumulators.len()` holds at runtime — but
    // CodeQL can't track the schema/batch correspondence and flags the
    // raw index as a potential OOB deref.
    for batch in reader {
        let batch = batch?;
        for (i, array) in batch.columns().iter().enumerate() {
            if let Some(acc) = accumulators.get_mut(i) {
                acc.extend(array.as_ref());
            }
        }
    }

    let columns: Vec<ColumnData> = accumulators.into_iter().map(|a| a.finish()).collect();
    Ok(DataFrame::new(columns, column_names))
}

/// Per-column intermediate state while reading record batches.
enum ColumnAccumulator {
    Int64(Vec<Option<i64>>),
    Float64(Vec<Option<f64>>),
    Utf8(Vec<Option<String>>),
    Boolean(Vec<Option<bool>>),
    DateTime(Vec<Option<i64>>),
}

impl ColumnAccumulator {
    fn from_dtype(dt: &DataType) -> Self {
        match dt {
            DataType::Int8
            | DataType::Int16
            | DataType::Int32
            | DataType::Int64
            | DataType::UInt8
            | DataType::UInt16
            | DataType::UInt32
            | DataType::UInt64 => Self::Int64(Vec::new()),
            DataType::Float16 | DataType::Float32 | DataType::Float64 => Self::Float64(Vec::new()),
            DataType::Boolean => Self::Boolean(Vec::new()),
            DataType::Timestamp(_, _) | DataType::Date32 | DataType::Date64 => {
                Self::DateTime(Vec::new())
            }
            _ => Self::Utf8(Vec::new()),
        }
    }

    fn extend(&mut self, array: &dyn Array) {
        match self {
            Self::Int64(v) => extend_int(v, array),
            Self::Float64(v) => extend_float(v, array),
            Self::Boolean(v) => {
                if let Some(arr) = array.as_any().downcast_ref::<BooleanArray>() {
                    for i in 0..arr.len() {
                        v.push(if arr.is_null(i) { None } else { Some(arr.value(i)) });
                    }
                } else {
                    for _ in 0..array.len() {
                        v.push(None);
                    }
                }
            }
            Self::DateTime(v) => extend_timestamp(v, array),
            Self::Utf8(v) => extend_string(v, array),
        }
    }

    fn finish(self) -> ColumnData {
        match self {
            Self::Int64(v) => ColumnData::Int64(v),
            Self::Float64(v) => ColumnData::Float64(v),
            Self::Boolean(v) => ColumnData::Boolean(v),
            Self::DateTime(v) => ColumnData::DateTime(v),
            Self::Utf8(v) => ColumnData::Utf8(v),
        }
    }
}

fn extend_int(out: &mut Vec<Option<i64>>, array: &dyn Array) {
    macro_rules! push_signed {
        ($ty:ty) => {{
            if let Some(arr) = array.as_any().downcast_ref::<$ty>() {
                for i in 0..arr.len() {
                    out.push(if arr.is_null(i) { None } else { Some(arr.value(i) as i64) });
                }
                return;
            }
        }};
    }
    macro_rules! push_unsigned {
        ($ty:ty) => {{
            if let Some(arr) = array.as_any().downcast_ref::<$ty>() {
                for i in 0..arr.len() {
                    out.push(if arr.is_null(i) { None } else { Some(arr.value(i) as i64) });
                }
                return;
            }
        }};
    }
    push_signed!(Int64Array);
    push_signed!(Int32Array);
    push_signed!(Int16Array);
    push_signed!(Int8Array);
    push_unsigned!(UInt64Array);
    push_unsigned!(UInt32Array);
    push_unsigned!(UInt16Array);
    push_unsigned!(UInt8Array);
    for _ in 0..array.len() {
        out.push(None);
    }
}

fn extend_float(out: &mut Vec<Option<f64>>, array: &dyn Array) {
    if let Some(arr) = array.as_any().downcast_ref::<Float64Array>() {
        for i in 0..arr.len() {
            out.push(if arr.is_null(i) { None } else { Some(arr.value(i)) });
        }
        return;
    }
    if let Some(arr) = array.as_any().downcast_ref::<Float32Array>() {
        for i in 0..arr.len() {
            out.push(if arr.is_null(i) { None } else { Some(arr.value(i) as f64) });
        }
        return;
    }
    for _ in 0..array.len() {
        out.push(None);
    }
}

fn extend_string(out: &mut Vec<Option<String>>, array: &dyn Array) {
    if let Some(arr) = array.as_any().downcast_ref::<StringArray>() {
        for i in 0..arr.len() {
            out.push(if arr.is_null(i) {
                None
            } else {
                Some(arr.value(i).to_string())
            });
        }
        return;
    }
    for i in 0..array.len() {
        if array.is_null(i) {
            out.push(None);
        } else {
            out.push(Some(format!("{:?}", array)));
        }
    }
}

fn extend_timestamp(out: &mut Vec<Option<i64>>, array: &dyn Array) {
    match array.data_type() {
        DataType::Timestamp(TimeUnit::Millisecond, _) => {
            if let Some(arr) = array.as_any().downcast_ref::<TimestampMillisecondArray>() {
                for i in 0..arr.len() {
                    out.push(if arr.is_null(i) { None } else { Some(arr.value(i)) });
                }
            }
        }
        DataType::Timestamp(TimeUnit::Second, _) => {
            if let Some(arr) = array.as_any().downcast_ref::<TimestampSecondArray>() {
                for i in 0..arr.len() {
                    out.push(if arr.is_null(i) {
                        None
                    } else {
                        Some(arr.value(i).saturating_mul(1000))
                    });
                }
            }
        }
        DataType::Timestamp(TimeUnit::Microsecond, _) => {
            if let Some(arr) = array.as_any().downcast_ref::<TimestampMicrosecondArray>() {
                for i in 0..arr.len() {
                    out.push(if arr.is_null(i) { None } else { Some(arr.value(i) / 1000) });
                }
            }
        }
        DataType::Timestamp(TimeUnit::Nanosecond, _) => {
            if let Some(arr) = array.as_any().downcast_ref::<TimestampNanosecondArray>() {
                for i in 0..arr.len() {
                    out.push(if arr.is_null(i) {
                        None
                    } else {
                        Some(arr.value(i) / 1_000_000)
                    });
                }
            }
        }
        _ => {
            for _ in 0..array.len() {
                out.push(None);
            }
        }
    }
}
