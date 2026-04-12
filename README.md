# Kensa

**Kensa** is an open-source VS Code extension for visual tabular data exploration and cleaning. It ships with a Rust-powered viewer for instant loading of CSV/Parquet/Excel/JSONL files and a Python/Pandas code-generating editor for interactive transformation.

> Independent, clean-room reimplementation. Not affiliated with any proprietary data wrangling product.

## Features

- **Fast viewer** — open a 200 MB CSV in under two seconds. No Python required for viewing.
- **Virtualized data grid** — smoothly scroll through millions of rows.
- **Column quick insights** — histograms for numeric columns, top-N bars for categorical columns, missing/distinct counts.
- **Sort & filter** — per-column sort/filter controls, no code required in viewing mode.
- **Detailed statistics** — click any column to see count, mean, std, percentiles, top value, etc.
- **Editing mode with code generation** — every GUI operation produces equivalent Python/Pandas code, viewable and editable in a code preview panel, exportable to a notebook cell.
- **29 built-in operations** — sort, filter, drop, fill missing, deduplicate, find & replace, one-hot encode, group-by, scale, round, FlashFill-style by-example string transforms, and more.
- **Graceful degradation** — if the Rust native module fails to load, the extension falls back to Python-only mode and still works.

## Architecture

Kensa uses a **dual-path hybrid** data engine:

| Path | When used | Technology |
|---|---|---|
| Rust engine | Viewing mode — loading, slicing, sort, filter, stats | `napi-rs` native addon with `csv`, `parquet`, `calamine`, `rayon` |
| Python backend | Editing mode — any operation that must produce exportable code | Python subprocess running `pandas` |

A `DataRouter` in the extension host dispatches webview requests to the right engine based on the current mode. Mode switching from Viewing to Editing re-reads the file via Pandas so every subsequent operation can emit code.

### Project layout

```
kensa/
├── package.json                 VS Code extension manifest
├── crates/kensa-engine/         Rust native data engine (napi-rs)
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs               #[napi] DataEngine entry
│       ├── csv_reader.rs        CSV + encoding detection
│       ├── parquet_reader.rs    Parquet via arrow
│       ├── excel_reader.rs      xlsx/xls via calamine
│       ├── jsonl_reader.rs      JSON Lines
│       ├── column.rs            ColumnData enum + type inference
│       ├── stats.rs             Column statistics
│       ├── histogram.rs         Histogram binning
│       ├── frequency.rs         Top-N value counting
│       ├── sort.rs              Index-based sort
│       ├── filter.rs            Predicate filter compilation
│       ├── slicer.rs            Row slicing for pagination
│       ├── search.rs            Substring search
│       ├── export.rs            CSV/Parquet export
│       └── flashfill.rs         FlashFill pattern inference
├── src/
│   ├── extension/               TS extension host
│   │   ├── extension.ts         activate()
│   │   ├── commands.ts          Command registration
│   │   ├── dataRouter.ts        Rust/Python dispatcher
│   │   ├── rustBridge.ts        napi-rs module loader
│   │   ├── kernelManager.ts     Python kernel / subprocess
│   │   ├── pythonBackend.ts     Python JSON protocol
│   │   ├── codeGenerator.ts     Step → Python code
│   │   ├── fileHandler.ts       File type detection
│   │   ├── webviewProvider.ts   Webview panel lifecycle
│   │   └── modeManager.ts       Viewing ↔ Editing policy
│   │
│   ├── webview/                 React UI inside the webview iframe
│   │   ├── index.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── DataGrid.tsx
│   │   │   ├── ColumnHeader.tsx
│   │   │   ├── QuickInsightViz.tsx
│   │   │   ├── SummaryPanel.tsx
│   │   │   ├── OperationsPanel.tsx
│   │   │   ├── StepsPanel.tsx
│   │   │   ├── CodePreview.tsx
│   │   │   ├── Toolbar.tsx
│   │   │   └── ParameterForm.tsx
│   │   ├── state/store.ts
│   │   ├── styles/app.css
│   │   └── vscodeApi.ts
│   │
│   ├── shared/                  TS types shared by both sides
│   │   ├── messages.ts          postMessage protocol
│   │   ├── operations.ts        29 operations + code generators
│   │   └── types.ts             Domain types
│   │
│   └── python/
│       ├── kensa_helpers.py     Subprocess command loop
│       └── requirements.txt
│
├── .github/workflows/build.yml  Cross-platform CI (6 targets)
├── scripts/
│   ├── build.mjs                esbuild orchestration
│   ├── test.mjs                 Node test runner for TS
│   └── ts-loader.mjs
├── test/
│   ├── shared/                  Code-generator unit tests
│   └── rust/                    (Rust tests live inline with #[cfg(test)])
└── tsconfig*.json
```

## Development

### Prerequisites

- Node.js 20+
- Rust stable toolchain
- Python 3.9+ with `pandas` (only required for Editing mode)
- VS Code 1.85+

### Build

```bash
npm install

# Build the Rust native module (produces a .node file next to the crate)
npm run build:rust:debug

# Build the extension host + webview bundles via esbuild
npm run build:ts
```

Run `npm run build` to do both in sequence. `npm run build:ts:watch` enables incremental rebuilds for TS/React.

### Run the extension

From VS Code, press `F5` to launch an Extension Development Host with the extension installed. Then right-click a CSV/Parquet/Excel/JSONL file in the Explorer and choose **Open in Kensa**.

### Tests

```bash
cargo test --manifest-path crates/kensa-engine/Cargo.toml  # Rust unit tests
npm test                                                   # TS unit tests
```

### Package

```bash
npx vsce package --target linux-x64
```

The CI workflow (`.github/workflows/build.yml`) produces platform-specific VSIXes for linux-x64, linux-arm64, macos-x64, macos-arm64, windows-x64, and windows-arm64.

## Settings

| Setting | Default | Description |
|---|---|---|
| `kensa.defaultMode` | `viewing` | Default mode when opening a file. |
| `kensa.grid.defaultColumnWidth` | `200` | Default column width in pixels. |
| `kensa.grid.showColumnStats` | `true` | Show quick insights in column headers. |
| `kensa.defaultFilter` | `quick` | Default filter UI. |
| `kensa.pythonPath` | `""` | Override Python interpreter path. |
| `kensa.startInEditModeForFiles` | `false` | Start files directly in Editing mode. |
| `kensa.rust.enabled` | `true` | Use the Rust engine (disable for Python fallback). |

## License

MIT
