// Right-side summary panel.
//
// Two modes:
//   1. No column selected → dataset dashboard: row/col/complete% stat cards
//      plus file + mode + engine metadata.
//   2. Column selected → column detail: a hero stat at the top (unique%
//      for categorical, mean for numeric), secondary stats in a grid
//      underneath, formatted with the shared helpers in `formatters.ts`
//      so percentages and numbers look consistent across the whole app.

import { useEffect } from 'react';
import { useKensaStore } from '../state/store';
import { postMessage } from '../vscodeApi';
import { formatCount, formatNumber, formatPercent } from '../formatters';

export function SummaryPanel() {
  const { slice, selectedColumn, statsByColumn, insights, fileName, mode, engine } = useKensaStore();

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

  // -- Dataset dashboard --------------------------------------------------
  if (selectedColumn === null) {
    const rowCount = slice.totalRows;
    const colCount = slice.columns.length;
    const totalCells = rowCount * colCount;
    // Clamped missing count — insights aren't recomputed post-filter, so
    // totalMissing can exceed totalCells on a heavily-filtered view and
    // produce a negative completeness percentage. Same clamp pattern as
    // in Toolbar.tsx; a stale-but-bounded number beats an impossible one.
    const rawTotalMissing = insights.reduce((sum, ins) => sum + ins.missing, 0);
    const totalMissing = Math.min(rawTotalMissing, Math.max(0, totalCells));
    const completeLabel = totalCells > 0 ? formatPercent(totalCells - totalMissing, totalCells) : '—';
    const missingLabel = totalCells > 0 ? formatPercent(totalMissing, totalCells) : '—';

    return (
      <div className="kensa-summary">
        <div className="kensa-summary-title">Dataset</div>
        <div className="kensa-summary-sub">{fileName || 'Unnamed'}</div>

        <div className="kensa-stat-grid">
          <div className="kensa-stat-card kensa-stat-card-primary">
            <div className="kensa-stat-card-label">Rows</div>
            <div className="kensa-stat-card-value">{formatCount(rowCount)}</div>
          </div>
          <div className="kensa-stat-card">
            <div className="kensa-stat-card-label">Columns</div>
            <div className="kensa-stat-card-value">{colCount}</div>
          </div>
          <div className="kensa-stat-card kensa-stat-card-success">
            <div className="kensa-stat-card-label">Complete</div>
            <div className="kensa-stat-card-value">{completeLabel}</div>
            <div className="kensa-stat-card-sub">
              {formatCount(totalCells - totalMissing)} / {formatCount(totalCells)} cells
            </div>
          </div>
          <div className="kensa-stat-card kensa-stat-card-accent">
            <div className="kensa-stat-card-label">Missing</div>
            <div className="kensa-stat-card-value">{missingLabel}</div>
            <div className="kensa-stat-card-sub">{formatCount(totalMissing)} cells</div>
          </div>
        </div>

        <dl className="kensa-summary-dl">
          <dt>Mode</dt>
          <dd>{mode}</dd>
          <dt>Engine</dt>
          <dd>{engine === 'rust' ? 'Rust' : 'Python'}</dd>
        </dl>

        <div className="kensa-summary-hint">
          Click any column header to see its detailed stats here. Left-click
          a cell to copy its value.
        </div>
      </div>
    );
  }

  // -- Column detail ------------------------------------------------------
  const col = slice.columns[selectedColumn];
  const stats = statsByColumn[selectedColumn];
  const insight = insights.find((i) => i.columnIndex === selectedColumn) ?? null;

  if (!col) {
    return (
      <div className="kensa-summary">
        <div className="kensa-placeholder">Column not found.</div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="kensa-summary">
        <div className="kensa-summary-title">{col.name}</div>
        <div className="kensa-summary-sub">{col.dtype}</div>
        <div className="kensa-placeholder">Loading stats…</div>
      </div>
    );
  }

  // Clamp the counts before computing percentages — `stats` can be
  // stale relative to the post-filter `slice`, so the raw `missing`
  // field could exceed the visible `total`. This used to surface as
  // "147% missing" in the hero. The clamp keeps every percentage in
  // the panel inside [0, 100] regardless of when stats were last
  // refreshed.
  const rawTotal = stats.count + stats.missing;
  const total = rawTotal;
  const clampedMissing = Math.min(Math.max(0, stats.missing), Math.max(0, total));
  const clampedDistinct = Math.min(Math.max(0, stats.distinct), Math.max(0, total));
  const missingPct = total > 0 ? formatPercent(clampedMissing, total) : '—';
  const uniquePct = total > 0 ? formatPercent(clampedDistinct, total) : '—';
  const isNumeric = stats.mean !== null;

  // 100% missing → bypass every other hero pick (numeric mean,
  // categorical unique, etc.) because none of them carry meaningful
  // information when there's no data to summarize. The viz panels
  // also short-circuit downstream so we don't render an empty
  // histogram/frequency chart.
  const allMissing = total > 0 && clampedMissing >= total;
  if (allMissing) {
    return (
      <div className="kensa-summary">
        <div className="kensa-summary-title" title={col.name}>{col.name}</div>
        <div className="kensa-summary-sub">{col.dtype}</div>
        <div className="kensa-hero kensa-hero-accent">
          <div className="kensa-hero-label">Missing</div>
          <div className="kensa-hero-value">100%</div>
          <div className="kensa-hero-sub">
            {formatCount(total)} of {formatCount(total)} rows — no values to summarize
          </div>
        </div>
        <div className="kensa-stat-grid">
          <div className="kensa-stat-card kensa-stat-card-accent">
            <div className="kensa-stat-card-label">Missing</div>
            <div className="kensa-stat-card-value">{formatCount(total)}</div>
          </div>
          <div className="kensa-stat-card">
            <div className="kensa-stat-card-label">Count</div>
            <div className="kensa-stat-card-value">0</div>
          </div>
        </div>
        <div className="kensa-summary-hint">
          Drop or fill this column from the Operations panel to make it usable.
        </div>
      </div>
    );
  }

  // Hero stat picks a meaningful headline per column kind:
  //   - Numeric → mean (with std as sub)
  //   - Everything else → unique% (with top value as sub)
  // If missing% is >20% we override with a pink "X% missing" hero to flag
  // data-quality issues before anything else.
  const missingNum = total > 0 ? (clampedMissing / total) * 100 : 0;
  const heroIsMissing = missingNum >= 20;

  let heroLabel: string;
  let heroValue: string;
  let heroSub: string;
  let heroClass = '';
  if (heroIsMissing) {
    heroLabel = 'Missing';
    heroValue = missingPct;
    heroSub = `${formatCount(clampedMissing)} of ${formatCount(total)} rows — high, consider filling or dropping`;
    heroClass = 'kensa-hero-accent';
  } else if (isNumeric) {
    heroLabel = 'Mean';
    heroValue = formatNumber(stats.mean);
    heroSub = stats.std !== null ? `σ ${formatNumber(stats.std)}` : '';
  } else {
    heroLabel = 'Unique';
    heroValue = uniquePct;
    heroSub = stats.topValue !== null
      ? `top: ${String(stats.topValue)} (${formatCount(stats.topCount)}×)`
      : `${formatCount(clampedDistinct)} distinct`;
  }

  return (
    <div className="kensa-summary">
      <div className="kensa-summary-title" title={col.name}>{col.name}</div>
      <div className="kensa-summary-sub">{col.dtype}</div>

      <div className={`kensa-hero ${heroClass}`}>
        <div className="kensa-hero-label">{heroLabel}</div>
        <div className="kensa-hero-value">{heroValue}</div>
        {heroSub && <div className="kensa-hero-sub">{heroSub}</div>}
      </div>

      <div className="kensa-stat-grid">
        <div className="kensa-stat-card">
          <div className="kensa-stat-card-label">Count</div>
          <div className="kensa-stat-card-value">{formatCount(stats.count)}</div>
        </div>
        <div
          className={`kensa-stat-card ${missingNum >= 10 ? 'kensa-stat-card-accent' : ''}`}
        >
          <div className="kensa-stat-card-label">Missing</div>
          <div className="kensa-stat-card-value">{missingPct}</div>
          <div className="kensa-stat-card-sub">{formatCount(clampedMissing)}</div>
        </div>
        <div className="kensa-stat-card kensa-stat-card-primary">
          <div className="kensa-stat-card-label">Unique</div>
          <div className="kensa-stat-card-value">{uniquePct}</div>
          <div className="kensa-stat-card-sub">{formatCount(clampedDistinct)} distinct</div>
        </div>
        {isNumeric && (
          <div className="kensa-stat-card">
            <div className="kensa-stat-card-label">Range</div>
            <div className="kensa-stat-card-value" style={{ fontSize: 13 }}>
              {stats.min ?? '—'} → {stats.max ?? '—'}
            </div>
          </div>
        )}
        {!isNumeric && stats.topValue !== null && (
          <div className="kensa-stat-card">
            <div className="kensa-stat-card-label">Top</div>
            <div
              className="kensa-stat-card-value"
              style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}
              title={String(stats.topValue)}
            >
              {String(stats.topValue)}
            </div>
            <div className="kensa-stat-card-sub">{formatCount(stats.topCount)} rows</div>
          </div>
        )}
      </div>

      {isNumeric && (
        <dl className="kensa-summary-dl">
          <dt>Min</dt><dd>{stats.min ?? '—'}</dd>
          <dt>25%</dt><dd>{formatNumber(stats.p25)}</dd>
          <dt>Median</dt><dd>{formatNumber(stats.p50)}</dd>
          <dt>75%</dt><dd>{formatNumber(stats.p75)}</dd>
          <dt>Max</dt><dd>{stats.max ?? '—'}</dd>
          <dt>Std</dt><dd>{formatNumber(stats.std)}</dd>
          <dt>Sum</dt><dd>{formatNumber(stats.sum)}</dd>
        </dl>
      )}

      {insight && insight.frequency && insight.frequency.length > 1 && !isNumeric && (
        <dl className="kensa-summary-dl">
          {insight.frequency.slice(0, 5).map((f, i) => (
            <div key={i} style={{ display: 'contents' }}>
              <dt title={f.value}>{f.value.length > 20 ? f.value.slice(0, 19) + '…' : f.value}</dt>
              <dd>{formatPercent(f.count, total)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
