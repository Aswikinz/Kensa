// Right-side summary panel. Shows dataset-level info when no column is
// selected, or detailed column stats when one is.

import { useEffect } from 'react';
import { useKensaStore } from '../state/store';
import { postMessage } from '../vscodeApi';

export function SummaryPanel() {
  const { slice, selectedColumn, statsByColumn, fileName, mode, engine } = useKensaStore();

  // Lazily fetch detailed stats on selection change.
  useEffect(() => {
    if (selectedColumn === null) return;
    if (statsByColumn[selectedColumn]) return;
    postMessage({ type: 'requestColumnStats', columnIndex: selectedColumn });
  }, [selectedColumn, statsByColumn]);

  if (!slice) {
    return (
      <div className="kensa-summary">
        <div className="kensa-summary-title">Summary</div>
        <div className="kensa-placeholder">No dataset loaded.</div>
      </div>
    );
  }

  if (selectedColumn === null) {
    return (
      <div className="kensa-summary">
        <div className="kensa-summary-title">Dataset</div>
        <dl className="kensa-summary-dl">
          <dt>File</dt>
          <dd>{fileName || '—'}</dd>
          <dt>Rows</dt>
          <dd>{slice.totalRows.toLocaleString()}</dd>
          <dt>Columns</dt>
          <dd>{slice.columns.length}</dd>
          <dt>Mode</dt>
          <dd>{mode}</dd>
          <dt>Engine</dt>
          <dd>{engine === 'rust' ? '⚡ Rust' : '🐍 Python'}</dd>
        </dl>
        <div className="kensa-summary-hint">Click a column header to see detailed stats.</div>
      </div>
    );
  }

  const col = slice.columns[selectedColumn];
  const stats = statsByColumn[selectedColumn];
  return (
    <div className="kensa-summary">
      <div className="kensa-summary-title">{col?.name ?? ''}</div>
      <div className="kensa-summary-sub">{col?.dtype ?? ''}</div>
      {!stats && <div className="kensa-placeholder">Loading stats…</div>}
      {stats && (
        <dl className="kensa-summary-dl">
          <dt>Count</dt>
          <dd>{stats.count.toLocaleString()}</dd>
          <dt>Missing</dt>
          <dd>{stats.missing.toLocaleString()}</dd>
          <dt>Distinct</dt>
          <dd>{stats.distinct.toLocaleString()}</dd>
          {stats.mean !== null && (
            <>
              <dt>Mean</dt>
              <dd>{formatNumber(stats.mean)}</dd>
              <dt>Std</dt>
              <dd>{formatNumber(stats.std)}</dd>
              <dt>Min</dt>
              <dd>{stats.min ?? '—'}</dd>
              <dt>25%</dt>
              <dd>{formatNumber(stats.p25)}</dd>
              <dt>50%</dt>
              <dd>{formatNumber(stats.p50)}</dd>
              <dt>75%</dt>
              <dd>{formatNumber(stats.p75)}</dd>
              <dt>Max</dt>
              <dd>{stats.max ?? '—'}</dd>
              <dt>Sum</dt>
              <dd>{formatNumber(stats.sum)}</dd>
            </>
          )}
          {stats.topValue !== null && (
            <>
              <dt>Top value</dt>
              <dd>{stats.topValue}</dd>
              <dt>Top count</dt>
              <dd>{stats.topCount ?? '—'}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

function formatNumber(n: number | null): string {
  if (n === null || Number.isNaN(n)) return '—';
  if (Math.abs(n) >= 1e6 || (Math.abs(n) < 1e-3 && n !== 0)) return n.toExponential(3);
  return n.toFixed(4).replace(/\.?0+$/, '');
}
