'use client';
import { useState } from 'react';
import type { Sample, NetworkEvent } from '../lib/simulation';
export const elapsed = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export default function TrendMetric({ label, value, unit, icon, foot, series, events, field, color, precision = 0 }: {
  label: string; value: number | null; unit: string; icon: React.ReactNode; foot: string;
  series: Sample[]; events: NetworkEvent[]; field: keyof Omit<Sample, 'time'>; color: string; precision?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const start = series[0]?.time || 0, end = Math.max(start + 60, series.at(-1)?.time || 0);
  const validSamples = series.filter(s => s[field] !== null);
  const format = (v: number | null) => v === null ? "—" : v.toFixed(precision);
  const maximum = Math.max(4, ...validSamples.map(s => Number(s[field])));
  const ceiling = Math.ceil(maximum / (maximum > 20 ? 10 : 2)) * (maximum > 20 ? 10 : 2);
  const x = (t: number) => 26 + (t - start) / (end - start) * 228;
  const y = (v: number) => 78 - v / ceiling * 65;
  const points = validSamples.map(s => `${x(s.time)},${y(Number(s[field]))}`).join(' ');
  const selected = hover === null || !series.length ? null : series.reduce((best, s) => Math.abs(s.time - hover) < Math.abs(best.time - hover) ? s : best);
  const marks = events.filter(e => e.time >= start && e.time <= end);
  return <div className="metric trend-metric"><div className="metric-label">{label}{icon}</div><div className="metric-value">{format(value)}<span>{unit}</span></div>
    <div className="trend-plot" onPointerLeave={() => setHover(null)}>
      <svg viewBox="0 0 264 102" role="img" aria-label={`${label} over simulated time`} onPointerMove={e => { const pointer = e.currentTarget.createSVGPoint(); pointer.x = e.clientX; pointer.y = e.clientY; const matrix = e.currentTarget.getScreenCTM(); if (!matrix) return; const localX = pointer.matrixTransform(matrix.inverse()).x; setHover(start + Math.max(0, Math.min(1, (localX - 26) / 228)) * (end - start)); }}>
        <title>{`${label} over time`}</title><desc>{series.length} samples. Latest value {format(value)} {unit}. Dashed orange lines mark network changes.</desc>
        {[0, ceiling / 2, ceiling].map(v => <g key={v}><line x1="26" x2="254" y1={y(v)} y2={y(v)} stroke="#e6e9df" strokeDasharray="2 4"/><text x="20" y={y(v) + 3} textAnchor="end">{v}</text></g>)}
        {marks.map(e => <g key={e.id}><title>{`${elapsed(e.time)} · ${e.label}`}</title><line x1={x(e.time)} x2={x(e.time)} y1="10" y2="78" stroke="#ba8059" opacity=".55" strokeDasharray="3 3"/><circle cx={x(e.time)} cy="81" r="2.5" fill="#ba8059"/></g>)}
        {validSamples.length > 1 && <polygon points={`${x(validSamples[0].time)},78 ${points} ${x(validSamples.at(-1)!.time)},78`} fill={color} opacity=".07"/>}
        <polyline data-testid={`trend-${field}`} points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round"/>
        {validSamples.at(-1) && <circle cx={x(validSamples.at(-1)!.time)} cy={y(Number(validSamples.at(-1)![field]))} r="2.5" fill={color}/>}
        {!validSamples.length && <text x="140" y="48" textAnchor="middle">No active vehicles</text>}
        <text x="26" y="98">{elapsed(start)}</text><text x="140" y="98" textAnchor="middle">{elapsed((start+end)/2)}</text><text x="254" y="98" textAnchor="end">{elapsed(end)}</text>
        {selected && selected[field] !== null && <g pointerEvents="none"><line x1={x(selected.time)} x2={x(selected.time)} y1="10" y2="78" stroke={color} opacity=".6"/><circle cx={x(selected.time)} cy={y(Number(selected[field]))} r="3.5" stroke="white" fill={color}/></g>}
      </svg>
      {selected && <div className="trend-tooltip">{elapsed(selected.time)} · <b>{selected[field] === null ? "No active vehicles" : `${format(selected[field])} ${unit}`}</b>{marks.filter(e => Math.abs(e.time - selected.time) < 1).map(e => <span key={e.id}>{e.label}</span>)}</div>}
    </div><small>{foot}</small></div>;
}
