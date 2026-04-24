# Changelog

All notable changes to Kensa are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Kensa follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.8] — 2026-04-24

### Security

- **Closed Dependabot alert #2: `uuid` < 14.0.0 missing-buffer-bounds-check
  in v3/v5/v6 generators.** `uuid@8.3.2` was pulled transitively by
  `@vscode/vsce@^2.22.0` → `@azure/identity@4.13.1` →
  `@azure/msal-node@5.1.2` → `uuid@^8.3.0`. Bumped `@vscode/vsce` to
  `^3.9.1` and added an npm `overrides` entry forcing `uuid: "^14.0.0"`
  across the whole tree, which resolves the transitive to `uuid@14.0.0`
  without waiting on upstream to move. Verified end-to-end by re-
  packaging a VSIX (the vsce path is the one that actually exercises
  msal-node; msal-node@5.1.2 works fine against uuid@14 because it only
  calls `v4()` without passing a `buf` argument). Practical impact was
  zero — `uuid` is a build-time devDependency only and Kensa never
  ships it to end users — but we don't want the repo carrying open
  security alerts.

## [0.1.7] — 2026-04-23

Design refresh release. Every UI surface now uses a cohesive palette
built around a primary blue (`#1881C4`) and accent pink (`#EB078C`)
layered over VS Code's dark editor background, with glassy translucent
surfaces, larger radii, and a reworked stats vocabulary that answers
"is this column healthy?" at a glance instead of reporting raw counts.

### Added

- **Data dashboard in the toolbar.** The top-right of the toolbar now
  carries a three-up stat block — **Rows**, **Cols**, **Complete %**
  — with large colour-coded numbers. The completeness figure turns
  green at ≥95%, blue at ≥80%, pink below that, so data-quality
  problems are visible before the user scrolls. Compact `1.2M` / `340K`
  abbreviations keep huge datasets legible.
- **Column search in the toolbar.** A new search pill next to the
  filename finds a column by name (exact → prefix → contains) and
  smooth-scrolls the grid to it, with a pink pulse on the matched
  column so the eye lands in the right place. Debounced at 140ms so
  typing doesn't whiplash the viewport; Enter forces an immediate
  jump, Escape clears.
- **Left-click copies a cell value.** _(Later tuned in 0.1.7 so
  left-click only selects and copying is routed through the right-click
  menu — see Changed section below.)_
- **Right-click cell → context menu.** Copy cell / Copy row (TSV) /
  Copy column (TSV); Filter equals / not equals / contains; Sort asc /
  desc; Clear column filters. Menu is clamped to viewport so
  right-clicking near edges doesn't clip it.
- **Click row number to copy the whole row** as tab-separated text —
  pastes directly into Excel or Google Sheets. Pink hover tint makes
  the affordance discoverable.
- **Toast region** bottom-right shows transient confirmation for copy
  actions (cell / row / column / filter jump). Auto-dismisses after
  ~1.4s; animates in and out with cubic-bezier easing.
- **Advanced filter section** inside each column's popover menu:
  operator + value + case-insensitive toggle, operator list scoped by
  column dtype (numeric columns don't offer `contains`; text columns
  don't offer `>` / `<`). Applied advanced filters appear as removable
  chips at the top of the menu. Stacks with both the column's quick
  filter and other advanced filters, all AND-combined.
- **Themed column picker** (replaces native `<select>` + checkbox list
  in `ParameterForm`): searchable, keyboard-navigable (↑/↓/Enter/Esc),
  single and multi-select modes, dtype displayed next to each column.
  [src/webview/components/ColumnPicker.tsx](src/webview/components/ColumnPicker.tsx).
- **Themed dropdown** for small option lists
  ([src/webview/components/ThemedSelect.tsx](src/webview/components/ThemedSelect.tsx))
  — used in the Advanced filter operator so the option popup no longer
  falls back to OS / browser styling inside dark popover menus.
- **Dtype-aware missing-value rendering.** Missing cells now show
  `nan` / `nat` / `null` / `none` based on the column dtype (pandas
  sentinel conventions), italic + dotted-underlined + colour-tinted so
  they read as "this cell is absent" and can't be confused with an
  actual dash or data character.
- **Excel-convention alignment** for cell and header text. Integers,
  floats, datetimes, and timestamps right-align with tabular numerals;
  booleans centre; text / object / categorical left-align. Headers
  align to match their cells, so a column name visually sits above its
  values. A column that *looks* numeric but aligns left is a string —
  the Excel trick for spotting type mismatches at a glance.
- **Filter-badge counter** on the toolbar filter pill. Shows the
  current row count in accent pink next to the filter-count, so the
  filter hit rate is visible without opening any panel.
- **Hero stats + card grid** in the summary side panel. Dataset view
  is now a 2×2 card grid (Rows / Columns / Complete / Missing) with
  22-26px numbers. Column view auto-picks a headline: numeric columns
  show a **Mean** hero with σ underneath, categorical columns show
  **Unique %** with top value; any column with ≥20% missing flips to a
  pink **Missing** hero overriding the default so data-quality issues
  always surface first.
- **Percentage-first quick-insight stats** on each column header.
  `14% missing · 78% unique` replaces `missing 234 · distinct 512`;
  missing percentage turns pink at ≥10%, unique percentage renders in
  blue. Stats line flex-wraps to a second line when the column is
  narrow, so the numbers never clip.

### Changed

- **Left-click no longer auto-copies** a cell value — it only selects
  the cell and swaps the side-panel to that column's stats. Copying
  is routed through the right-click context menu and the row-number
  click, both of which still flash the cell and show a toast.
- **Column menu closes on outside click.** Replaced the invisible scrim
  (which was getting trapped by parent sticky / stacking contexts on
  some layouts) with a `mousedown` listener on `document`. Clicks on
  underlying cells now close the menu AND select the cell in one
  gesture; clicks on popovers rendered at document scope (the themed
  operator dropdown) are correctly excluded from the close check.
- **Default column width** bumped 160 → 184px so the worst-case stats
  row (`99.8% missing · 99.8% unique`) fits on a single line without
  clipping; narrower columns flex-wrap to two lines rather than
  truncating.
- **Column menu** is now a solid dark surface (gradient `#232326 →
  #1b1b1e`) with a larger corner radius, stronger border, and the
  tooltip arrow glyph matching. The earlier glass treatment hurt
  readability over variable grid content — the filter-op names and
  value inputs were losing contrast when a colourful column was
  visible behind the menu.
- **Filter semantics** — a single column can now carry multiple
  filters at once. Quick-filter ops (`is_missing` / `is_not_missing` /
  `is_duplicated` / `is_unique`) remain mutually exclusive within
  their set; advanced-filter ops stack freely with the quick filter
  and with each other. Removing a filter is done by clicking its chip
  × instead of by column.
- **Completeness math is clamped** to `[0%, 100%]` in both the
  toolbar stat and the summary panel card. Insights aren't refreshed
  on filter change today, so a heavily-filtered view could produce
  `totalMissing > totalCells` and yield a negative percentage —
  clamping prevents the visible regression until the backend starts
  emitting fresh insights with every filter.

### Fixed

- **Search icon in the column-search pill** now uses the shared
  `SearchIcon` SVG matching the rest of the toolbar icon set, at the
  same 12-14px stroke weight. The prior unicode `⌕` glyph rendered at
  a wildly different size.
- **Native `<select>`** option popups for enum parameters in the
  operations panel no longer show with the OS default light styling —
  appearance is stripped and the trigger gets a themed chevron.

### Tests + CI

- `c8` + `cargo-llvm-cov` coverage pipeline still runs on every push
  and PR; Codecov upload under separate `rust` / `ts` flags.
- Webview-side test coverage stable at 100% on `shared/messages`,
  `shared/operations`, `notebookResolver`, `notebookArgParser`; total
  51 TS + 15 Rust unit tests green in CI on all six release targets.

---

## [0.1.6] — 2026-04-15

### Fixed

- **Second regression of the same symptom: "No Jupyter notebook is open"
  even with a notebook open.** The 0.1.5 fix only handled the case where
  the resolver ran with no hint and no active editor. Two remaining
  bugs kept reproducing the same error for real users:

  1. **`extractNotebookUri` in `commands.ts` used `instanceof vscode.Uri`**
     to sniff the argument the `notebook/toolbar` command receives. That
     check silently returned `undefined` whenever the runtime Uri object
     didn't match the specific `vscode.Uri` class identity the extension
     host had loaded — which happens when the object comes through an
     RPC boundary, or is a plain structural clone, or arrives from a
     downstream VS Code fork. The hint was dropped here, and every
     notebook flow downstream fell back to the (also-broken) no-hint
     heuristic. Replaced with a structural duck-type check
     (`scheme` + `fsPath`/`path`) in a new dedicated helper module
     [src/extension/notebookArgParser.ts](src/extension/notebookArgParser.ts).

  2. **`pickWorkingNotebook` returned `null` when both
     `activeNotebookEditor` and `visibleNotebookEditors` were empty**
     even if notebook documents were clearly open. This combination
     happens all the time in practice: the Kensa webview panel steals
     `activeNotebookEditor`, and if the notebook is in a hidden tab
     group the visible editors list is also empty. Added a last-resort
     fallback that returns the first open notebook when we reach the
     end of the preference chain. The panel-key fix from 0.1.4 prevents
     this from cascading into cross-notebook confusion — at worst the
     user sees data from a different notebook than they meant and can
     switch, instead of the extension looking completely broken.

  `null` is now only returned in the single case where
  `notebookDocuments` is genuinely empty, which is the one and only
  case where "No Jupyter notebook is open" is the correct error.

### Tests

- New unit test file `test/shared/notebookArgParser.test.ts` with 15
  cases covering every documented notebook-toolbar argument shape
  (bare Uri, `{uri}`, `{notebookUri}`, `{notebook: {uri}}`,
  `{document: {uri}}`) plus structural edge cases. The
  `isUriLike(plain Uri-shaped object) === true` case specifically
  guards against the v0.1.5 `instanceof`-based drop.
- Expanded `test/shared/notebookResolver.test.ts` with regression
  cases for the "webview stole focus + notebook in hidden tab group"
  scenario that kept producing the user-facing bug. The test
  `regression: hint miss + webview stole focus + tab group hidden →
  still works` end-to-end reconstructs the failure and pins the new
  fallback behaviour.
- TS test count: 51 (was 35).

## [0.1.5] — 2026-04-15

### Fixed

- **Regression from 0.1.4: notebook flows hard-failed on every hint miss.**
  In 0.1.4 `findWorkingNotebook` was tightened so an unmatched hint URI
  returned `null` instead of falling through to the active/visible editor.
  That looked safer on paper but broke every real notebook flow, because
  the URI the notebook toolbar hands us doesn't always serialize
  identically to what `workspace.notebookDocuments` stores (different
  scheme, encoding, or cell fragment across VS Code versions). Users
  saw "No Jupyter notebook is open" for every variable extraction even
  with a notebook focused right in front of them. The resolver is now
  forgiving: strict match → loose `fsPath` match → active editor →
  visible editor → null. We still never fall back to
  `notebookDocuments[0]`, which was the original
  "picks-the-first-ever-opened-notebook" bug from 0.1.3.

### Tests

- New unit test file `test/shared/notebookResolver.test.ts` with ten
  cases pinning the notebook-resolution policy: strict match, loose
  fsPath match, hint miss falls through to active, hint miss falls
  through to visible, no hint chains, empty-documents corner cases, and
  hint-wins-over-active. The hint-miss cases would have caught the 0.1.4
  regression before it shipped.
- Extracted the resolution logic to [src/extension/notebookResolver.ts](src/extension/notebookResolver.ts)
  so it's importable under `node --test` without stubbing the full
  `vscode` runtime module. `kernelManager.ts` now calls the pure helper
  with the live vscode state, and the pure helper is what the tests
  exercise.

### Coverage + CI

- New `coverage` workflow ([.github/workflows/coverage.yml](.github/workflows/coverage.yml))
  runs on every push to main and every PR. Linux-only by design —
  coverage doesn't need to come from every platform, and running it
  under the six-target build matrix would triple CI cost without
  telling us anything new.
- Rust coverage via `cargo-llvm-cov` (LCOV output).
- TypeScript coverage via `c8` wrapping `node --test`. The custom TS
  loader ([scripts/ts-loader.mjs](scripts/ts-loader.mjs)) now emits
  inline sourcemaps so V8 coverage maps back to the original `.ts`
  files instead of the transpiled JS.
- Both LCOV files are uploaded to Codecov under separate flags (`rust`,
  `ts`) so per-component coverage is tracked independently; codecov.yml
  pins the routing and sets the status checks to `informational: true`
  for now (no hard merge gate until the baseline is trustworthy).
- Raw LCOV files are also uploaded as workflow artifacts so they can
  be downloaded and inspected if the Codecov upload is ever degraded.
- Coverage + build + CodeQL badges added to the README.
- Baseline numbers from the first local run: `notebookResolver.ts`
  100%, `messages.ts` 100%, `operations.ts` 95.17%. The IO boundaries
  (kernelManager, webviewProvider, dataRouter, pythonBackend) and the
  React webview are at 0% — fixing those is a follow-up that gets
  filled in as we touch each module, not a v0.1.5 blocker.

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

[0.1.8]: https://github.com/Aswikinz/Kensa/releases/tag/v0.1.8
[0.1.7]: https://github.com/Aswikinz/Kensa/releases/tag/v0.1.7
[0.1.6]: https://github.com/Aswikinz/Kensa/releases/tag/v0.1.6
[0.1.5]: https://github.com/Aswikinz/Kensa/releases/tag/v0.1.5
[0.1.4]: https://github.com/Aswikinz/Kensa/releases/tag/v0.1.4
[0.1.3]: https://github.com/Aswikinz/Kensa/releases/tag/v0.1.3
[0.1.1]: https://github.com/Aswikinz/Kensa/releases/tag/v0.1.1
[0.1.0]: https://github.com/Aswikinz/Kensa/releases/tag/v0.1.0
