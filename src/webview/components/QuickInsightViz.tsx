// Compact visualization shown inside each column header. Two layouts:
//   - numeric/datetime → tiny histogram bars
//   - categorical/boolean → top-N horizontal frequency bars
// Both render as plain DOM elements — no external chart lib — so they stay
// cheap for 100+ column datasets.
//
// Layout: a vertical stack containing the visualization (fills remaining
// space) and a single-line stats row underneath. The parent .kensa-col-insight
// reserves a fixed minimum height so the grid rows below never collide.

import type { QuickInsight } from '../../shared/types';

interface Props {
  readonly insight: QuickInsight;
}

export function QuickInsightViz({ insight }: Props) {
  const stats = (
    <div className="kensa-insight-stats">
      missing {insight.missing} · distinct {insight.distinct}
    </div>
  );

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
