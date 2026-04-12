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
    """Holds the original DF plus the current working copy + applied steps."""

    def __init__(self) -> None:
        self.orig_df: Optional["pd.DataFrame"] = None
        self.working_df: Optional["pd.DataFrame"] = None
        self.preview_df: Optional["pd.DataFrame"] = None
        self.file_path: Optional[str] = None
        self.steps: List[Dict[str, Any]] = []

    def replay(self) -> None:
        """Re-apply all stored steps to the original DF."""
        if self.orig_df is None:
            return
        df = self.orig_df.copy()
        for step in self.steps:
            df = exec_step(df, step["code"])
        self.working_df = df


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
    if STATE.working_df is None:
        raise RuntimeError("no dataset loaded")
    return STATE.working_df


def get_slice(start: int, end: int) -> Dict[str, Any]:
    df = current_df()
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
    df = current_df()
    col_name = df.columns[column_index]
    series = df[col_name]
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
    df = current_df()
    insights: List[Dict[str, Any]] = []
    for i, col_name in enumerate(df.columns):
        series = df[col_name]
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
    df = exec_step(current_df().copy(), code)
    STATE.preview_df = df
    return {
        "rows": [[_cell_to_json(v) for v in row.tolist()] for _, row in df.head(500).iterrows()],
        "startRow": 0,
        "endRow": min(500, len(df)),
        "totalRows": int(len(df)),
        "columns": [
            {
                "index": i,
                "name": str(c),
                "dtype": str(df.dtypes[c]),
                "inferred": friendly_dtype(str(df.dtypes[c])),
            }
            for i, c in enumerate(df.columns)
        ],
        "engine": "python",
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
    "undo": lambda msg: undo_step(msg["step_id"]),
    "export_csv": lambda msg: export_csv(msg["path"]),
    "export_parquet": lambda msg: export_parquet(msg["path"]),
    "diff": lambda msg: diff_against(msg["prev"], msg["new"]),
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
