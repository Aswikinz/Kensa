// Compact visualization inside each column header. Two layouts:
//   - numeric/datetime → tiny histogram bars
//   - categorical/boolean → top-N horizontal frequency bars
//
// Stats row now reads as `14% missing · 78% unique` instead of raw counts.
// Percentages answer the question "is this column healthy?" at a glance
// in a way that raw integers can't (a 234 missing out of 10M rows is
// fine; 234 out of 300 is broken). The missing figure flips to the pink
// accent when it crosses 10% so attention-worthy columns visually stand
// apart without a legend.

import type { QuickInsight } from '../../shared/types';
import { formatPercent } from '../formatters';
import { useKensaStore } from '../state/store';

interface Props {
  readonly insight: QuickInsight;
}

export function QuickInsightViz({ insight }: Props) {
  // Use total rows from the slice so our denominator is the full column
  // length, not just the number of non-missing values.
  const totalRows = useKensaStore((s) => s.slice?.totalRows ?? 0);

  // Insights are computed on the unfiltered data, so after a heavy
  // filter `insight.missing` can exceed the (now smaller) `totalRows`
  // and the raw division would render "147% missing". Clamp both
  // counts to `[0, totalRows]` so the display stays sane until the
  // backend gets re-asked for fresh insights post-filter.
  const clampedMissing = Math.min(Math.max(0, insight.missing), totalRows);
  const clampedDistinct = Math.min(Math.max(0, insight.distinct), totalRows);
  const missingPct = totalRows > 0 ? (clampedMissing / totalRows) * 100 : 0;
  const missingLabel = totalRows > 0 ? formatPercent(clampedMissing, totalRows) : '—';
  const uniqueLabel = totalRows > 0 ? formatPercent(clampedDistinct, totalRows) : '—';
  const missingClass = missingPct >= 10 ? 'kensa-insight-stat-missing-warn' : 'kensa-insight-stat-missing-ok';

  const stats = (
    <div className="kensa-insight-stats">
      <span className={missingClass} title={`${insight.missing} missing values`}>
        {missingLabel} missing
      </span>
      <span className="kensa-insight-stat-sep">·</span>
      <span className="kensa-insight-stat-unique" title={`${insight.distinct} distinct values`}>
        {uniqueLabel} unique
      </span>
    </div>
  );

  // 100%-missing column → don't try to render an empty histogram /
  // frequency chart, just a single all-missing banner. The backend
  // sometimes still emits a trivial histogram for these, which would
  // render as one tall bar at the leftmost bin and was being
  // mistaken for "lots of values clustered at the start".
  const allMissing = totalRows > 0 && clampedMissing >= totalRows;
  if (allMissing) {
    return (
      <>
        <div className="kensa-col-insight-viz">
          <div className="kensa-insight-allmissing" title="Every value in this column is missing">
            all missing
          </div>
        </div>
        {stats}
      </>
    );
  }

  if (insight.histogram && insight.histogram.length > 0) {
    const maxCount = Math.max(...insight.histogram.map((b) => b.count));
    return (
      <>
        <div className="kensa-col-insight-viz">
          <div className="kensa-hist">
            {insight.histogram.map((bin, i) => {
              const h = maxCount === 0 ? 0 : (bin.count / maxCount) * 100;
              return (
                <div
                  key={i}
                  className="kensa-hist-bar"
                  style={{ height: `${h}%` }}
                  title={`${bin.lower.toFixed(2)} – ${bin.upper.toFixed(2)}: ${bin.count}`}
                />
              );
            })}
          </div>
        </div>
        {stats}
      </>
    );
  }

  if (insight.frequency && insight.frequency.length > 0) {
    const max = Math.max(...insight.frequency.map((f) => f.count));
    return (
      <>
        <div className="kensa-col-insight-viz">
          <div className="kensa-freq">
            {insight.frequency.slice(0, 3).map((f, i) => (
              <div key={i} className="kensa-freq-row" title={`${f.value}: ${f.count}`}>
                <div className="kensa-freq-label">{f.value}</div>
                <div className="kensa-freq-bar-wrap">
                  <div
                    className="kensa-freq-bar"
                    style={{ width: max === 0 ? '0%' : `${(f.count / max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
        {stats}
      </>
    );
  }

  return (
    <>
      <div className="kensa-insight-placeholder" />
      {stats}
    </>
  );
}
