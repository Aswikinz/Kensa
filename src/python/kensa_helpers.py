"""Python-side command loop for the Kensa extension.

Reads one JSON command per line from stdin, writes one JSON response per line
to stdout. The protocol is intentionally tiny — the goal is a fast subprocess
that can execute Pandas operations for the extension's Editing mode and fall
back gracefully if the Jupyter extension isn't present.

Each request is a JSON object with:
    { "id": <int>, "cmd": <str>, ...args }

Each response is:
    { "id": <int>, "result": <value> }       on success
    { "id": <int>, "error": "<msg>" }        on failure
    { "event": "ready" }                      emitted once at startup

Sandboxing: we keep the original DataFrame (`_orig_df`) untouched and replay
all steps from it on undo. A separate `_working_df` holds the current state
and a `_preview_df` is used for non-committing previews.
"""

from __future__ import annotations

import json
import math
import sys
import traceback
from typing import Any, Dict, List, Optional, Tuple

_HAS_PANDAS = False
try:
    import numpy as np  # noqa: F401
    import pandas as pd

    _HAS_PANDAS = True
except Exception:  # pragma: no cover
    pd = None  # type: ignore
    np = None  # type: ignore


class KensaState:
    """Holds the original DF plus the current working copy + applied steps.

    `view_filters` and `view_sort` are transient, webview-driven view controls
    that get re-applied as a mask on top of `working_df` every time the grid
    asks for a slice. They are NOT part of the step history — clearing them
    returns the view to the committed working_df. That's how clearing a
    quick filter instantly restores hidden rows in Editing mode."""

    def __init__(self) -> None:
        self.orig_df: Optional["pd.DataFrame"] = None
        self.working_df: Optional["pd.DataFrame"] = None
        self.preview_df: Optional["pd.DataFrame"] = None
        self.file_path: Optional[str] = None
        self.steps: List[Dict[str, Any]] = []
        self.view_filters: List[Dict[str, Any]] = []
        self.view_sort: Optional[Dict[str, Any]] = None

    def replay(self) -> None:
        """Re-apply all stored steps to the original DF."""
        if self.orig_df is None:
            return
        df = self.orig_df.copy()
        for step in self.steps:
            df = exec_step(df, step["code"])
        self.working_df = df

    def viewed_df(self) -> Optional["pd.DataFrame"]:
        """The working_df after the transient view filters + sort are applied.
        Used by every slice/stats query so the view stays in sync with the
        webview's `activeFilters` without mutating the step history."""
        if self.working_df is None:
            return None
        df = self.working_df
        if self.view_filters:
            df = _apply_view_filters(df, self.view_filters)
        if self.view_sort:
            col = self.view_sort.get("column")
            asc = bool(self.view_sort.get("ascending", True))
            if col is not None and col in df.columns:
                df = df.sort_values(by=col, ascending=asc, na_position="last")
        return df


def _apply_view_filters(df: "pd.DataFrame", filters: List[Dict[str, Any]]) -> "pd.DataFrame":
    """Evaluate the view filter list into a boolean mask and return the
    filtered dataframe. Unknown ops / unknown columns are ignored (the mask
    stays True)."""
    if pd is None or df is None or not filters:
        return df
    mask = pd.Series(True, index=df.index)
    for f in filters:
        col = f.get("column")
        op = f.get("op")
        val = f.get("value")
        if col is None or col not in df.columns:
            continue
        series = df[col]
        try:
            if op == "is_missing":
                m = series.isna()
            elif op == "is_not_missing":
                m = series.notna()
            elif op == "is_duplicated":
                m = series.duplicated(keep=False) & series.notna()
            elif op == "is_unique":
                m = ~series.duplicated(keep=False) & series.notna()
            elif op == "eq":
                m = series.astype(str) == str(val)
            elif op == "ne":
                m = series.astype(str) != str(val)
            elif op == "gt":
                m = pd.to_numeric(series, errors="coerce") > float(val)
            elif op == "gte":
                m = pd.to_numeric(series, errors="coerce") >= float(val)
            elif op == "lt":
                m = pd.to_numeric(series, errors="coerce") < float(val)
            elif op == "lte":
                m = pd.to_numeric(series, errors="coerce") <= float(val)
            elif op == "contains":
                m = series.astype(str).str.contains(str(val), na=False, regex=False)
            elif op == "starts_with":
                m = series.astype(str).str.startswith(str(val), na=False)
            elif op == "ends_with":
                m = series.astype(str).str.endswith(str(val), na=False)
            elif op == "regex":
                m = series.astype(str).str.contains(str(val), na=False, regex=True)
            else:
                continue
            mask = mask & m.fillna(False)
        except Exception:  # noqa: BLE001
            # Any evaluation error (dtype mismatch, bad regex, etc.) just
            # skips that filter rather than blowing up the whole slice.
            continue
    return df[mask]


def exec_step(df: "pd.DataFrame", code: str) -> "pd.DataFrame":
    """Execute a code snippet with `df` in scope and return the mutated df."""
    namespace: Dict[str, Any] = {"df": df, "pd": pd, "np": np}
    exec(code, namespace)  # noqa: S102 — user-authored code, intended execution
    return namespace.get("df", df)


STATE = KensaState()


# -- readers -----------------------------------------------------------------

def load_file(path: str, kind: str, options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    if pd is None:
        raise RuntimeError("pandas is not installed")
    options = options or {}
    if kind in ("csv", "tsv"):
        delim = options.get("delimiter") or ("\t" if kind == "tsv" else ",")
        df = pd.read_csv(path, delimiter=delim)
    elif kind == "parquet":
        df = pd.read_parquet(path)
    elif kind == "excel":
        sheet = options.get("sheet")
        df = pd.read_excel(path, sheet_name=sheet) if sheet else pd.read_excel(path)
    elif kind == "jsonl":
        df = pd.read_json(path, lines=True)
    else:
        raise ValueError(f"unsupported file kind: {kind}")

    STATE.orig_df = df
    STATE.working_df = df.copy()
    STATE.preview_df = None
    STATE.file_path = path
    STATE.steps = []
    STATE.view_filters = []
    STATE.view_sort = None
    return dataset_info(df)


def load_pickle(path: str) -> Dict[str, Any]:
    """Load a pickled DataFrame. Used when the Jupyter extension hands off a
    live kernel variable via temp-file — we avoid any shared-memory tricks."""
    if pd is None:
        raise RuntimeError("pandas is not installed")
    df = pd.read_pickle(path)
    if not hasattr(df, "columns"):
        raise RuntimeError(f"object at {path} is not a DataFrame")
    STATE.orig_df = df
    STATE.working_df = df.copy()
    STATE.preview_df = None
    STATE.file_path = path
    STATE.steps = []
    STATE.view_filters = []
    STATE.view_sort = None
    return dataset_info(df)


def dataset_info(df: "pd.DataFrame") -> Dict[str, Any]:
    dtypes = [str(d) for d in df.dtypes]
    return {
        "columnNames": [str(c) for c in df.columns],
        "columnDtypes": dtypes,
        "inferredDtypes": [friendly_dtype(d) for d in dtypes],
        "rowCount": int(len(df)),
        "columnCount": int(len(df.columns)),
    }


def friendly_dtype(dtype_str: str) -> str:
    if "int" in dtype_str:
        return "integer"
    if "float" in dtype_str:
        return "float"
    if "bool" in dtype_str:
        return "boolean"
    if "datetime" in dtype_str:
        return "datetime"
    return "string"


# -- slicing / stats ---------------------------------------------------------

def current_df() -> "pd.DataFrame":
    """The committed working_df. Used by writes (apply_code, preview)."""
    if STATE.working_df is None:
        raise RuntimeError("no dataset loaded")
    return STATE.working_df


def current_view() -> "pd.DataFrame":
    """The working_df with transient view filters + sort applied. Used by
    every read (slice, stats, insights) so the webview sees a consistently
    filtered/sorted view without mutating the step history."""
    df = STATE.viewed_df()
    if df is None:
        raise RuntimeError("no dataset loaded")
    return df


def get_slice(start: int, end: int) -> Dict[str, Any]:
    df = current_view()
    total = len(df)
    start = max(0, min(start, total))
    end = max(start, min(end, total))
    window = df.iloc[start:end]
    rows: List[List[Optional[str]]] = []
    for _, row in window.iterrows():
        rows.append([_cell_to_json(v) for v in row.tolist()])
    columns = [
        {
            "index": i,
            "name": str(c),
            "dtype": str(df.dtypes[c]),
            "inferred": friendly_dtype(str(df.dtypes[c])),
        }
        for i, c in enumerate(df.columns)
    ]
    return {
        "rows": rows,
        "startRow": int(start),
        "endRow": int(end),
        "totalRows": int(total),
        "columns": columns,
        "engine": "python",
    }


def set_view_filters(filters: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Replace the transient view filter list. The filters are NOT stored as
    Pandas steps — they live only in STATE.view_filters and are re-applied
    on every read. Returns a fresh first-page slice of the resulting view."""
    STATE.view_filters = list(filters or [])
    return get_slice(0, 500)


def set_view_sort(sort: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Replace the transient view sort. Pass `None` (or {}) to clear."""
    STATE.view_sort = sort if sort else None
    return get_slice(0, 500)


def _cell_to_json(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    try:
        if pd is not None and pd.isna(value):
            return None
    except Exception:
        pass
    return str(value)


def get_column_stats(column_index: int) -> Dict[str, Any]:
    df = current_view()
    col_name = df.columns[column_index]
    # Positional access — `df[col_name]` returns a *DataFrame* when
    # `col_name` collides with another column (pandas duplicates the
    # selection rather than picking one), which silently broke every
    # downstream `series.count() / .isna() / .describe()` call. Using
    # `iloc[:, column_index]` always yields a Series for the exact
    # column the user clicked, regardless of name collisions.
    series = df.iloc[:, column_index]
    stats: Dict[str, Any] = {
        "name": str(col_name),
        "dtype": str(series.dtype),
        "count": int(series.count()),
        "missing": int(series.isna().sum()),
        "distinct": int(series.nunique(dropna=True)),
        "min": None,
        "max": None,
        "mean": None,
        "std": None,
        "sum": None,
        "p25": None,
        "p50": None,
        "p75": None,
        "topValue": None,
        "topCount": None,
    }
    if pd is not None and pd.api.types.is_numeric_dtype(series):
        desc = series.describe()
        stats["min"] = _json_number(desc.get("min"))
        stats["max"] = _json_number(desc.get("max"))
        stats["mean"] = _to_float(desc.get("mean"))
        stats["std"] = _to_float(desc.get("std"))
        stats["sum"] = _to_float(series.sum())
        stats["p25"] = _to_float(desc.get("25%"))
        stats["p50"] = _to_float(desc.get("50%"))
        stats["p75"] = _to_float(desc.get("75%"))
    else:
        vc = series.value_counts(dropna=True)
        if len(vc) > 0:
            stats["topValue"] = str(vc.index[0])
            stats["topCount"] = int(vc.iloc[0])
    return stats


def _to_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
        if math.isnan(f):
            return None
        return f
    except Exception:
        return None


def _json_number(v: Any) -> Optional[str]:
    f = _to_float(v)
    return None if f is None else str(f)


def get_all_insights() -> List[Dict[str, Any]]:
    df = current_view()
    insights: List[Dict[str, Any]] = []
    for i, col_name in enumerate(df.columns):
        # Positional access — same fix as in get_column_stats: name-based
        # `df[col_name]` selects multiple columns when the dataset has
        # duplicate names, breaking `.isna()` / `.nunique()` / dtype
        # detection for every column with a clashing name.
        series = df.iloc[:, i]
        missing = int(series.isna().sum())
        distinct = int(series.nunique(dropna=True))
        dtype_str = str(series.dtype)
        if pd is not None and pd.api.types.is_numeric_dtype(series):
            hist = _histogram(series.dropna().astype(float).tolist(), 12)
            insights.append(
                {
                    "columnIndex": i,
                    "name": str(col_name),
                    "dtype": dtype_str,
                    "kind": "numeric",
                    "missing": missing,
                    "distinct": distinct,
                    "histogram": hist,
                    "frequency": None,
                }
            )
        else:
            vc = series.value_counts(dropna=True).head(5)
            freq = [{"value": str(idx), "count": int(count)} for idx, count in vc.items()]
            insights.append(
                {
                    "columnIndex": i,
                    "name": str(col_name),
                    "dtype": dtype_str,
                    "kind": "categorical",
                    "missing": missing,
                    "distinct": distinct,
                    "histogram": None,
                    "frequency": freq,
                }
            )
    return insights


def _histogram(values: List[float], bins: int) -> List[Dict[str, float]]:
    if not values:
        return []
    lo = min(values)
    hi = max(values)
    if lo == hi:
        return [{"lower": lo, "upper": hi, "count": len(values)}]
    width = (hi - lo) / bins
    counts = [0] * bins
    for v in values:
        idx = int((v - lo) / width)
        if idx >= bins:
            idx = bins - 1
        counts[idx] += 1
    return [
        {"lower": lo + i * width, "upper": lo + (i + 1) * width, "count": counts[i]}
        for i in range(bins)
    ]


# -- operations --------------------------------------------------------------

def apply_code(code: str, step_id: str) -> Dict[str, Any]:
    df = exec_step(current_df(), code)
    STATE.working_df = df
    STATE.steps.append({"id": step_id, "code": code})
    STATE.preview_df = None
    return get_slice(0, 500)


def preview_code(code: str) -> Dict[str, Any]:
    """Execute the operation against a copy of working_df and stash the
    result as `STATE.preview_df`. Returns the first page plus a full-diff
    summary (computed once over the entire preview df) plus a per-cell
    boolean mask for the first page so the grid can highlight only the
    cells that actually changed, not every cell in a shifted row.

    The full diff count is the authoritative "N cells modified" number
    shown in the toolbar banner — it reflects the ENTIRE dataset, not
    just the visible window. The per-window mask is only used to paint
    individual highlights on the rows currently being rendered.

    Subsequent preview pages are served by `get_preview_slice` below,
    which reuses the same stored preview_df so we don't re-run the
    operation for every scroll."""
    base_df = current_df()
    df = exec_step(base_df.copy(), code)
    STATE.preview_df = df
    first_page = _preview_page(base_df, df, 0, min(500, len(df)))
    full_diff = _compute_full_preview_diff(base_df, df)
    return {
        **first_page,
        "diff": full_diff,
    }


def get_preview_slice(start: int, end: int) -> Dict[str, Any]:
    """Serve a page of the stored preview_df. Called when the user scrolls
    past the first page in preview mode. Returns the same shape as
    `preview_code` minus the full diff (which doesn't change between pages)."""
    if STATE.preview_df is None:
        raise RuntimeError("no preview is active")
    return _preview_page(current_df(), STATE.preview_df, int(start), int(end))


def _preview_page(
    base_df: "pd.DataFrame",
    prev_df: "pd.DataFrame",
    start: int,
    end: int,
) -> Dict[str, Any]:
    """Build one preview-page response — rows + per-cell changed mask + the
    standard slice envelope. The per-window mask is a rectangular list of
    booleans matching the rendered rows/columns so the grid can flip the
    `.diff-modified` class on exactly the cells that changed, not on
    positionally-shifted rows that merely coincide with the render window."""
    total = len(prev_df)
    start = max(0, min(start, total))
    end = max(start, min(end, total))
    window = prev_df.iloc[start:end]

    rows: List[List[Optional[str]]] = [
        [_cell_to_json(v) for v in row.tolist()] for _, row in window.iterrows()
    ]
    mask = _compute_window_mask(base_df, prev_df, start, end)
    columns = [
        {
            "index": i,
            "name": str(c),
            "dtype": str(prev_df.dtypes[c]),
            "inferred": friendly_dtype(str(prev_df.dtypes[c])),
        }
        for i, c in enumerate(prev_df.columns)
    ]
    return {
        "rows": rows,
        "changedMask": mask,
        "startRow": int(start),
        "endRow": int(end),
        "totalRows": int(total),
        "columns": columns,
        "engine": "python",
    }


def _compute_window_mask(
    base_df: "pd.DataFrame",
    prev_df: "pd.DataFrame",
    start: int,
    end: int,
) -> List[List[bool]]:
    """Per-cell changed flag for the [start, end) window of prev_df against
    base_df. Only meaningful when both dataframes have the same length AND
    the same row order — otherwise we return an empty mask and the webview
    falls back to rendering without cell highlights (the banner already
    reports the structural change). The NaN sentinel trick avoids
    `NaN != NaN` tripping every row on numeric columns."""
    if pd is None or np is None or base_df is None or prev_df is None:
        return []
    if len(base_df) != len(prev_df):
        return []
    try:
        if not base_df.index.equals(prev_df.index):
            return []
    except Exception:  # noqa: BLE001
        return []
    n = end - start
    if n <= 0:
        return []
    base_window = base_df.iloc[start:end]
    prev_window = prev_df.iloc[start:end]
    cols = list(prev_df.columns)
    mask_arr = np.zeros((n, len(cols)), dtype=bool)
    for c_idx, col in enumerate(cols):
        if col in base_df.columns:
            try:
                a = base_window[col].astype(object).where(
                    base_window[col].notna(), "__KENSA_NA__"
                )
                b = prev_window[col].astype(object).where(
                    prev_window[col].notna(), "__KENSA_NA__"
                )
                mask_arr[:, c_idx] = a.values != b.values
            except Exception:  # noqa: BLE001
                mask_arr[:, c_idx] = False
        else:
            # Columns that didn't exist in the base are always "added" —
            # highlighted wholesale by the grid via `columnsAdded`, not per
            # cell, so we leave the mask False here.
            mask_arr[:, c_idx] = False
    return mask_arr.tolist()


def _compute_full_preview_diff(
    base_df: "pd.DataFrame",
    prev_df: "pd.DataFrame",
) -> Dict[str, Any]:
    """One-shot diff summary between the whole working_df and the whole
    preview_df. Vectorized over columns; for a 200k × N frame this is a
    handful of `Series != Series` calls that pandas runs in tens of ms.

    The `modifiedCells` list is intentionally NOT populated here — on a
    200k-row frame that list would be a million entries in the worst case
    and we don't need it: the webview paints individual highlights from
    the per-window mask returned alongside each preview page, and this
    summary is only used for the `Previewing changes · N cells modified`
    banner."""
    if pd is None or base_df is None or prev_df is None:
        return {
            "rowsAdded": 0,
            "rowsRemoved": 0,
            "rowsChanged": 0,
            "columnsAdded": [],
            "columnsRemoved": [],
            "modifiedCells": [],
        }

    base_cols = list(base_df.columns)
    prev_cols = list(prev_df.columns)
    columns_added = [str(c) for c in prev_cols if c not in base_cols]
    columns_removed = [str(c) for c in base_cols if c not in prev_cols]
    rows_added = max(0, len(prev_df) - len(base_df))
    rows_removed = max(0, len(base_df) - len(prev_df))

    rows_changed = 0
    if (
        len(base_df) == len(prev_df)
        and len(base_df) > 0
        and base_df.index.equals(prev_df.index)
    ):
        for col in prev_cols:
            if col not in base_cols:
                continue
            try:
                a = base_df[col].astype(object).where(base_df[col].notna(), "__KENSA_NA__")
                b = prev_df[col].astype(object).where(prev_df[col].notna(), "__KENSA_NA__")
                rows_changed += int((a.values != b.values).sum())
            except Exception:  # noqa: BLE001
                continue

    return {
        "rowsAdded": int(rows_added),
        "rowsRemoved": int(rows_removed),
        "rowsChanged": int(rows_changed),
        "columnsAdded": columns_added,
        "columnsRemoved": columns_removed,
        "modifiedCells": [],
    }


def undo_step(step_id: str) -> Dict[str, Any]:
    STATE.steps = [s for s in STATE.steps if s["id"] != step_id]
    STATE.replay()
    return get_slice(0, 500)


def export_csv(path: str) -> Dict[str, Any]:
    current_df().to_csv(path, index=False)
    return {"path": path}


def export_parquet(path: str) -> Dict[str, Any]:
    current_df().to_parquet(path, index=False)
    return {"path": path}


# -- dispatcher --------------------------------------------------------------

def diff_against(prev_slice: List[List[Optional[str]]], new_slice: List[List[Optional[str]]]) -> Dict[str, Any]:
    """Cell-level diff between two rectangular slices. Used by the webview to
    highlight cells changed by the most recent operation."""
    modified: List[Dict[str, Any]] = []
    rows_added = max(0, len(new_slice) - len(prev_slice))
    rows_removed = max(0, len(prev_slice) - len(new_slice))
    common = min(len(prev_slice), len(new_slice))
    for r in range(common):
        prow = prev_slice[r]
        nrow = new_slice[r]
        width = min(len(prow), len(nrow))
        for c in range(width):
            if prow[c] != nrow[c]:
                modified.append({"row": r, "column": c})
    return {
        "rowsAdded": rows_added,
        "rowsRemoved": rows_removed,
        "rowsChanged": len(modified),
        "columnsAdded": [],
        "columnsRemoved": [],
        "modifiedCells": modified,
    }


DISPATCH: Dict[str, Any] = {
    "load_file": lambda msg: load_file(msg["path"], msg["kind"], msg.get("options")),
    "load_pickle": lambda msg: load_pickle(msg["path"]),
    "get_slice": lambda msg: get_slice(int(msg["start"]), int(msg["end"])),
    "get_stats": lambda msg: get_column_stats(int(msg["columnIndex"])),
    "get_all_insights": lambda msg: get_all_insights(),
    "apply_code": lambda msg: apply_code(msg["code"], msg["step_id"]),
    "preview_code": lambda msg: preview_code(msg["code"]),
    "get_preview_slice": lambda msg: get_preview_slice(int(msg["start"]), int(msg["end"])),
    "undo": lambda msg: undo_step(msg["step_id"]),
    "export_csv": lambda msg: export_csv(msg["path"]),
    "export_parquet": lambda msg: export_parquet(msg["path"]),
    "diff": lambda msg: diff_against(msg["prev"], msg["new"]),
    "set_view_filters": lambda msg: set_view_filters(msg.get("filters") or []),
    "set_view_sort": lambda msg: set_view_sort(msg.get("sort")),
}


def main() -> None:
    sys.stdout.write(json.dumps({"event": "ready", "pandas": _HAS_PANDAS}) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as err:
            sys.stdout.write(json.dumps({"id": -1, "error": f"bad json: {err}"}) + "\n")
            sys.stdout.flush()
            continue

        request_id = msg.get("id")
        cmd = msg.get("cmd")
        handler = DISPATCH.get(cmd)
        if not handler:
            sys.stdout.write(
                json.dumps({"id": request_id, "error": f"unknown cmd: {cmd}"}) + "\n"
            )
            sys.stdout.flush()
            continue
        try:
            result = handler(msg)
            sys.stdout.write(json.dumps({"id": request_id, "result": result}) + "\n")
        except Exception as err:  # noqa: BLE001
            tb = traceback.format_exc()
            sys.stdout.write(
                json.dumps({"id": request_id, "error": str(err), "traceback": tb}) + "\n"
            )
        sys.stdout.flush()


if __name__ == "__main__":
    main()
