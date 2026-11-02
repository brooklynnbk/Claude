// Weight over time: daily weigh-ins (dots), 7-day average (line), goal (reference line).
// Rendered at the container's real pixel width so text stays legible on phones.

import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { ISODate, WeightEntry } from '../../shared/types.ts';
import { addDays, formatShort, fromISODate } from '../lib/dates.ts';

interface Point {
  date: ISODate;
  t: number;
  weight: number;
  avg: number;
}

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

export function WeightChart({ weights, goal, units, from }: { weights: WeightEntry[]; goal?: number; units: string; from?: ISODate }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const points = useMemo<Point[]>(() => {
    const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date));
    return sorted
      .map((w) => {
        const windowStart = addDays(w.date, -6);
        const win = sorted.filter((x) => x.date >= windowStart && x.date <= w.date);
        return { date: w.date, t: fromISODate(w.date).getTime(), weight: w.weight, avg: win.reduce((s, x) => s + x.weight, 0) / win.length };
      })
      .filter((p) => !from || p.date >= from);
  }, [weights, from]);

  if (points.length < 2) {
    return <div className="empty">Log at least two weigh-ins to see your trend.</div>;
  }

  const height = 220;
  const pad = { top: 14, right: goal !== undefined ? 64 : 14, bottom: 26, left: 40 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const values = points.map((p) => p.weight).concat(goal !== undefined ? [goal] : []);
  const yMin = Math.floor(Math.min(...values) - 1);
  const yMax = Math.ceil(Math.max(...values) + 1);
  const t0 = points[0].t;
  const t1 = points.at(-1)!.t;
  const x = (t: number) => pad.left + ((t - t0) / (t1 - t0 || 1)) * innerW;
  const y = (v: number) => pad.top + (1 - (v - yMin) / (yMax - yMin)) * innerH;

  const ticks = niceTicks(yMin, yMax);
  const xTickCount = Math.max(2, Math.min(5, Math.floor(innerW / 90)));
  const xTicks = Array.from({ length: xTickCount }, (_, i) => t0 + ((t1 - t0) * i) / (xTickCount - 1));
  const avgPath = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.avg).toFixed(1)}`).join('');

  function onMove(e: PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left + pad.left;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(x(p.t) - px) < Math.abs(x(points[best].t) - px)) best = i;
    });
    setHover(best);
  }

  const h = hover !== null ? points[hover] : null;

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="legend" aria-hidden>
        <span>
          <i className="swatch-dot" style={{ background: 'var(--muted)' }} /> Daily weigh-in
        </span>
        <span>
          <i className="swatch-line" style={{ background: 'var(--series-1)' }} /> 7-day average
        </span>
        {goal !== undefined && (
          <span>
            <i className="swatch-line" style={{ background: 'var(--text-2)', height: 1 }} /> Goal
          </span>
        )}
      </div>
      <div className="chart" ref={wrap}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Weight chart, ${points.length} weigh-ins from ${formatShort(points[0].date)} to ${formatShort(points.at(-1)!.date)}`}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} stroke="var(--chart-grid)" strokeWidth={1} />
              <text x={pad.left - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)">
                {v}
              </text>
            </g>
          ))}
          {xTicks.map((t, i) => (
            <text key={i} x={x(t)} y={height - 6} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'} fontSize={11} fill="var(--muted)">
              {new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </text>
          ))}

          {goal !== undefined && (
            <g>
              <line x1={pad.left} x2={width - pad.right} y1={y(goal)} y2={y(goal)} stroke="var(--text-2)" strokeWidth={1} />
              <text x={width - pad.right + 6} y={y(goal)} dy="0.32em" fontSize={11} fontWeight={600} fill="var(--text-2)">
                Goal {goal}
              </text>
            </g>
          )}

          {points.map((p) => (
            <circle key={p.date} cx={x(p.t)} cy={y(p.weight)} r={4} fill="var(--muted)" stroke="var(--surface)" strokeWidth={2} opacity={0.7} />
          ))}
          <path d={avgPath} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(points.at(-1)!.t)} cy={y(points.at(-1)!.avg)} r={4.5} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />

          {h && (
            <g pointerEvents="none">
              <line x1={x(h.t)} x2={x(h.t)} y1={pad.top} y2={height - pad.bottom} stroke="var(--text-2)" strokeWidth={1} opacity={0.4} />
              <circle cx={x(h.t)} cy={y(h.weight)} r={5} fill="var(--text)" stroke="var(--surface)" strokeWidth={2} />
              <circle cx={x(h.t)} cy={y(h.avg)} r={5} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
            </g>
          )}
          <rect
            x={pad.left}
            y={pad.top}
            width={innerW}
            height={innerH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
            style={{ touchAction: 'pan-y' }}
          />
        </svg>
        {h && (
          <div className="tip" style={{ left: Math.min(Math.max(x(h.t), 70), width - 70), top: y(Math.max(h.weight, h.avg)) }}>
            <div style={{ fontWeight: 700 }}>{formatShort(h.date)}</div>
            <div>
              {h.weight} {units} <span className="muted">· avg {Math.round(h.avg * 10) / 10}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
