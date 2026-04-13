//! Engine-internal error type. Converted to `napi::Error` at the FFI boundary
//! by `to_napi` in `lib.rs`.

use thiserror::Error;

#[derive(Debug, Error)]
#[allow(dead_code)]
pub enum KensaError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("csv parse error: {0}")]
    Csv(String),

    #[error("parquet error: {0}")]
    Parquet(String),

    #[error("excel error: {0}")]
    Excel(String),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("invalid filter: {0}")]
    InvalidFilter(String),

    #[error("column index {index} out of range (column count = {count})")]
    ColumnIndexOutOfRange { index: usize, count: usize },

    #[error("unsupported dtype for operation: {0}")]
    UnsupportedDtype(String),

    #[error("encoding error: {0}")]
    Encoding(String),

    #[error("{0}")]
    Other(String),
}

impl From<csv::Error> for KensaError {
    fn from(e: csv::Error) -> Self {
        KensaError::Csv(e.to_string())
    }
}

impl From<calamine::Error> for KensaError {
    fn from(e: calamine::Error) -> Self {
        KensaError::Excel(e.to_string())
    }
}

impl From<calamine::XlsxError> for KensaError {
    fn from(e: calamine::XlsxError) -> Self {
        KensaError::Excel(e.to_string())
    }
}

impl From<parquet::errors::ParquetError> for KensaError {
    fn from(e: parquet::errors::ParquetError) -> Self {
        KensaError::Parquet(e.to_string())
    }
}

impl From<arrow::error::ArrowError> for KensaError {
    fn from(e: arrow::error::ArrowError) -> Self {
        KensaError::Parquet(e.to_string())
    }
}

pub type KensaResult<T> = Result<T, KensaError>;
