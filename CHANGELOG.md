# Changelog

All notable changes to Kensa are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Kensa follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.4] — 2026-04-15

### Fixed

- **Notebook-variable panel now tracks the source notebook.** Opening `df`
  from a second notebook used to silently reuse the first notebook's Kensa
  panel and drop the new hint — the panel would then refresh against the
  original notebook's kernel and surface a confusing "No kernel is attached
  to <previous notebook>" error without ever loading the new dataframe.
  The panel cache key now includes the notebook URI, so each `(variable,
  notebook)` pair gets its own panel.
- **`findWorkingNotebook` no longer silently retargets a closed notebook.**
  When the notebook-toolbar hint pointed at a notebook that had been
  closed, the helper used to fall through to `notebookDocuments[0]` — the
  first-ever-opened notebook in the session, which was almost always the
  wrong one. The fallback is removed; a stale hint now fails with a clear
  `"The notebook 'foo.ipynb' is no longer open"` error that tells the user
  exactly what happened. The hint-less command-palette path still walks
  `activeNotebookEditor` → visible editors, which is the correct
  behaviour.

## [0.1.3] — 2026-04-15

### Security

- Closed CodeQL `rust/access-invalid-pointer` across the Rust engine.
  Every raw `&df.columns[idx]` / `v[i]` / `v[row]` / `arr[row]` expression
  reachable from the `DataEngine` API has been rewritten to go through
  `Vec::get` (with an explicit `ok_or` when we need to propagate an
  error). Affected files: `filter.rs`, `slicer.rs`, `export.rs`,
  `histogram.rs`. Behavior is unchanged — the guards were already in
  place, but CodeQL's Rust extractor (beta) cannot track bounds checks
  across control flow and was flagging every raw index expression as a
  potential out-of-bounds deref.
- Closed CodeQL `js/build-code-injection` in `kernelManager.ts`. The
  Jupyter variable extractor no longer substitutes `variableName` into a
  Python `eval()` call. It now validates each dotted segment against a
  strict identifier allowlist (`[A-Za-z_][A-Za-z0-9_]*`), then embeds
  the validated parts as a JSON string array (which is a Python list
  literal on the kernel side) and walks the attribute chain via explicit
  `globals()` / `locals()` lookups + `getattr`. No code is constructed
  from user input anymore, even before the allowlist gate — so even an
  attacker-controlled variable name can't be evaluated as Python.

### Fixed

- Version-bump fix-up release: `v0.1.2` was tagged without bumping
  `package.json` or `crates/kensa-engine/Cargo.toml`, so vsce built a
  VSIX still stamped `0.1.1` and the marketplace publish silently no-op'd
  as "already published". `v0.1.3` bumps both manifests in lockstep so
  the build actually produces a new version.

## [0.1.1] — 2026-04-13

### Fixed
- Renamed the extension's internal `name` from `kensa` to `kensa-viewer`
  because the short name `kensa` is already registered by a different
  publisher on the VS Code Marketplace. The user-visible `displayName`
  remains "Kensa"; only the marketplace identifier changes (now
  `AswinKithalawaarachchi.kensa-viewer`). This was discovered when the
  `v0.1.0` marketplace publish failed with *"The extension 'kensa'
  already exists in the Marketplace"*.

## [0.1.0] — 2026-04-13

First public release (never reached the marketplace — see 0.1.1).

### Rust engine

- Columnar in-memory data model (`ColumnData` enum — Int64, Float64, Utf8,
  Boolean, DateTime) with nullable cells and dtype-aware formatting.
- Readers for **CSV / TSV** (`csv` crate, with `encoding_rs` transcoding and
  BOM sniffing), **Parquet** (`parquet` + `arrow` streaming record batches),
  **Excel `.xlsx` / `.xls`** (`calamine`), and **JSON Lines** (per-line
  `serde_json` with union-of-keys column inference).
- Automatic type inference from a 2048-row sample, falling back to `Utf8`
  for ambiguous columns.
- Parallel column statistics (`rayon`): count, missing, distinct, mean,
  std, min/max, p25/p50/p75, top value.
- Per-column quick insights — histograms for numeric/datetime, top-N
  frequency bars for categorical/boolean — computed in parallel across
  every column in one pass.
- Index-based sort (stable; missing values sorted last regardless of
  direction).
- Filter compilation with 13 predicate ops: eq, ne, gt, gte, lt, lte,
  contains, starts_with, ends_with, is_missing, is_not_missing,
  is_duplicated, is_unique, regex. Duplicate/unique use a pre-pass to
  build a value-count map before row classification.
- Index-based slicer for paginated grid requests with O(1) row lookup in
  the current view order.
- Substring search within a column, case-insensitive.
- **FlashFill** string-transform-by-example engine: constant outputs,
  identity, case transforms (upper/lower/title/capitalize), split-by-delim
  (6 delimiters × first/last), prefix/suffix slicing, whitespace trim.
- CSV and Parquet export (with Arrow's `ArrowWriter`, snappy compressed).
- Exposed via `napi-rs` as a native Node.js addon (`DataEngine`) with a
  `Result<T, KensaError>` error path end-to-end — no `unwrap()` on
  untrusted input.
- 15 unit tests covering type inference, CSV parsing, stats correctness,
  sort semantics, FlashFill patterns, and filter pre-pass classification.

### Extension host (TypeScript)

- Dual-path `DataRouter` that dispatches requests to the Rust engine
  (viewing mode) or the Python subprocess backend (editing mode) based on
  the current mode. Transparent Rust → Python handoff when the user
  switches modes, with step-history replay for file sources.
- `PythonBackend` subprocess with newline-delimited JSON protocol, a 15s
  readiness timeout, `stderr` capture for diagnostic error messages,
  and safe handling of subprocess exit-before-ready.
- `rustBridge` lazy loader with graceful degradation — if the native
  `.node` binary can't be loaded (unsupported platform, build skipped),
  the extension falls back to Python-only mode instead of crashing.
- `KernelManager` with per-source Jupyter integration:
  - Extracts live DataFrame variables from the attached kernel via
    `pickle.dump` to a temp file, then hands the temp file to the Python
    subprocess for isolated processing.
  - Variable listing via a kernel-side JSON dump of all global DataFrames
    (pandas or polars, detected by class `__module__`).
  - Widens notebook discovery from `activeNotebookEditor` to all visible
    notebook editors and finally any open notebook document, so the
    command palette doesn't lose the user's notebook when it steals focus.
  - Specific error messages for every failure mode (extension missing,
    no notebook open, no kernel attached, variable undefined, variable
    isn't a DataFrame, kernel execution failed, pickle empty).
- `WebviewProvider` owning per-file panel lifecycles, a strict per-panel
  Content-Security-Policy with script nonces, and a typed
  `postMessage` protocol.
- Notebook integration: renderer controller, `notebook/toolbar` button
  ("View Data in Kensa"), quick-pick of kernel DataFrame variables, and
  an error-surfacing flow that shows a toast before spawning a panel.

### Webview (React)

- Single scroll container layout with `position: sticky` column headers,
  so horizontal scroll moves the headers in lockstep with the body.
- Hand-rolled row virtualization (absolute-positioned rows inside a
  `totalRows × 28px` layer, 6-row overscan) — smooth on 100k+ row
  datasets without a dependency.
- Column headers render the name, dtype, and a compact quick-insight
  visualization (mini histogram or top-N frequency bars) in flow; no
  absolute-positioning tricks, no overlap with the data rows.
- Column dropdown menu with distinct popover styling (solid background,
  rounded border, drop shadow, pointer arrow, click-outside scrim)
  replacing the previous flat strip that blended into the grid.
- **Sort** menu items and **Quick filters** (Hide missing, Only missing,
  Only duplicates, Only unique values) behave as toggles — clicking the
  same item twice removes it, ✓ rendered next to the active row, little
  dot on the column header when filtered.
- **Transient view filters**: filters are re-evaluated on every read
  rather than baked into the Pandas step history. In editing mode they
  live in a separate `view_filters` / `view_sort` layer on the Python
  side so clearing instantly restores hidden rows.
- Toolbar filter-count badge that shows when filters or sort are active
  and doubles as a one-click "clear everything" button.
- Toolbar refresh button — re-pulls the current source (re-reads a file
  from disk, or re-extracts a Jupyter variable from the live kernel).
- Zustand store with self-dispatching actions
  (`addOrReplaceColumnFilter`, `removeColumnFilter`, `clearAllFilters`,
  `applySort`) that update local state AND post the extension message
  atomically.
- **Preview overlay**: operations preview against a Python copy of the
  dataframe and return a diff-overlaid slice with a "Previewing changes"
  banner. Cells flip to yellow (modified) or green (added column). Apply
  commits; selecting a different operation cancels.
- Summary panel with dataset-level and per-column statistics (count,
  missing, distinct, mean, std, min/25/50/75/max, sum, top value).
- Operations panel with searchable, categorized list of all 29 operations.
- Dynamic parameter form per operation with humanized enum display
  (`not_equals` → "Not equals", etc.) via `humanizeOption` and
  per-schema `optionLabels` overrides.
- Cleaning Steps panel with per-step code preview and undo.
- Bottom Code Preview with a tiny embedded Python code editor, live
  execute (`Run` + Ctrl/Cmd+Enter), "Export to notebook" and "Copy"
  actions.
- Professional SVG icon set (`icons.tsx`) — replaces Unicode glyphs with
  Feather/Lucide-style 16x16 inline SVGs: operations, code, summary,
  export, filter, refresh, bolt (Rust), terminal (Python), eye, pencil.
  All use `currentColor` so they theme correctly. No emoji, no third-party
  logos.
- 30x30 icon buttons with `aria-pressed` active state, VS Code
  `toolbar-hoverBackground` / `toolbar-activeBackground` theming, 120ms
  transitions, keyboard focus ring, subtle click-press scale feedback.
- Rounded engine indicator pills (Rust yellow, Python blue) with the
  corresponding SVG icon instead of emoji.

### Operations catalog

- **29 built-in operations** with Pandas code generation, grouped into
  categories: Sort & Filter, Column Management, Data Cleaning, Text
  Transforms, Type Conversion, Encoding, Numeric, Aggregation,
  Custom, DateTime.
- Sort, Filter (with 11 conditions), Calculate Text Length, One-Hot
  Encode, Multi-Label Binarizer, Formula Column, Change Column Type,
  Drop / Select / Rename / Clone Column, Drop Missing, Drop Duplicates,
  Fill Missing (value/mean/median/mode/ffill/bfill), Find & Replace,
  Group By + Aggregate, Strip Whitespace, Split Text, Capitalize,
  Lowercase, Uppercase, String Transform by Example, DateTime Formatting,
  New Column by Example, Scale Min/Max, Round, Floor, Ceiling, Custom.

### Build, CI, and release

- `esbuild`-based build script producing three bundles: the extension
  host (CJS), the webview (IIFE + CSS), and the notebook renderer (ESM).
- Cross-platform GitHub Actions matrix (`build.yml`) that compiles the
  Rust engine and packages a platform-specific VSIX for each of
  `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64`,
  and `win32-arm64`.
- Tag-triggered release workflow (`release.yml`): push `v*.*.*` to build
  all platforms, extract the matching changelog section, and publish a
  GitHub Release with every VSIX + SHA-256 checksums attached.
- `.vscodeignore` trims the VSIX payload from ~500 MB (source +
  node_modules + cargo target) down to the actual runtime (~4.3 MB).
- `vscode:prepublish` pinned to the release Rust profile so packaging
  never ships a debug `.node` binary.
- Typed `BackendCommand` / `BackendResponse` union on the TS side and
  matching dispatch map on the Python side, so adding a command fails
  type-checking if either end is missed.

### Quality + security

- CodeQL workflow (`codeql.yml`) running extended `security-and-quality`
  queries on the JavaScript/TypeScript, Python, and Rust sources. Push,
  PR, and weekly schedule.
- Dependabot configuration for `npm`, `cargo`, and `github-actions`
  ecosystems. Non-breaking patch/minor updates are grouped into single
  weekly PRs; security advisories bypass the cadence.
- `SECURITY.md` with private vulnerability reporting instructions, an
  explicit in-scope / out-of-scope list (the `exec()` in Editing mode is
  by-design and documented), and hardening notes (per-panel CSP,
  typed Rust errors, subprocess watchdog).
- MIT license.
- 16 TypeScript unit tests covering the operations catalog, code
  generation, and message protocol guards; 15 Rust unit tests covering
  CSV parsing, type inference, sort/filter/stats correctness, and
  FlashFill patterns.

### Known caveats

- The Python interpreter used for Editing mode must have `pandas >= 1.2`
  installed. Optional extras (`pyarrow`, `openpyxl`) are only needed for
  the corresponding file types. The Python path is auto-detected from
  the environment; set `kensa.pythonPath` in settings to override.
- Notebook variable refresh requires the `ms-toolsai.jupyter` extension
  to be installed and a kernel to be attached to the active notebook.
- Monaco is not embedded in the Code Preview panel in this release;
  Kensa ships a minimal syntax-highlighted editor that covers the
  common use cases.

---

[0.1.4]: https://github.com/Aswikinz/Kensa/releases/tag/v0.1.4
[0.1.3]: https://github.com/Aswikinz/Kensa/releases/tag/v0.1.3
[0.1.1]: https://github.com/Aswikinz/Kensa/releases/tag/v0.1.1
[0.1.0]: https://github.com/Aswikinz/Kensa/releases/tag/v0.1.0
