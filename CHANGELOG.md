# Changelog

All notable changes to Kensa are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] — Unreleased

### Added
- Initial release scaffolding: extension host, React webview, Rust native engine, Python subprocess backend.
- CSV, TSV, Parquet, Excel, and JSONL readers in the Rust engine with automatic type inference.
- Virtualized data grid with sticky column headers and row virtualization for 100k+ row datasets.
- Column quick insights (histograms for numeric columns, top-N frequency bars for categorical columns).
- Per-column sort and filter controls in Viewing mode (handled by Rust).
- Detailed column statistics panel (count, mean, std, percentiles, top value).
- 29 built-in operations with code generation (sort, filter, drop, rename, clone, fill missing, drop duplicates, find & replace, change type, one-hot encode, multi-label binarizer, strip whitespace, split text, case transforms, group-by, scale, round, floor, ceiling, formula, FlashFill by-example, datetime formatting, custom).
- Cleaning Steps panel with per-step undo and code preview.
- Python subprocess backend with newline-delimited JSON protocol.
- Rust → Python handoff on mode switch.
- Graceful fallback to Python-only mode when the Rust native module fails to load.
- Cross-platform GitHub Actions CI for linux-x64/arm64, macos-x64/arm64, windows-x64/arm64.
