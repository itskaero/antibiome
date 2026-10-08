// Chart wrappers following the dataviz mark specs: 2px lines, ~10% area wash, hairline solid grid,
// 4px rounded data-ends, bars ≤ 24px, no dual axes, tooltips on every chart, text in ink tokens.
import type { ReactNode } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

const axis = { stroke: 'var(--text-3)', fontSize: 11, tickLine: false, axisLine: false } as const;

function TooltipBox({ active, payload, label, fmt, labelFmt }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line-2 bg-panel px-3 py-2 text-[12px] shadow-xl">
      <div className="mb-1 font-medium text-ink">{labelFmt ? labelFmt(label, payload) : label}</div>
      {payload.filter((p: any) => p.value != null).map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-ink-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.fill }} />
          <span>{p.name}</span>
          <span className="tnum ml-auto pl-3 font-medium text-ink">{fmt ? fmt(p.value, p) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-[12px] text-ink-2">
      {items.map(i => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.dashed
            ? <span className="w-4 border-t-2 border-dashed" style={{ borderColor: i.color }} />
            : <span className="h-[3px] w-4 rounded-full" style={{ background: i.color }} />}
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** "This period vs last period" area + dashed comparison line (after the Orbit spending chart). */
export function CompareArea({ data, height = 230, currentLabel, previousLabel, fmt }: {
  data: { x: string; current: number | null; previous: number | null }[]; height?: number; currentLabel: string; previousLabel: string; fmt?: (v: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
        <defs>
          <linearGradient id="cmpFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="x" {...axis} interval="preserveStartEnd" minTickGap={18} />
        <YAxis {...axis} allowDecimals={false} width={40} />
        <Tooltip cursor={{ stroke: 'var(--line-2)' }} content={<TooltipBox fmt={fmt} />} />
        <Line type="monotone" dataKey="previous" name={previousLabel} stroke="var(--text-3)" strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls isAnimationActive={false} />
        <Area type="monotone" dataKey="current" name={currentLabel} stroke="var(--accent)" strokeWidth={2} fill="url(#cmpFill)" dot={false}
          activeDot={{ r: 5, stroke: 'var(--panel)', strokeWidth: 2, fill: 'var(--accent)' }} connectNulls={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Single-series columns with the latest period highlighted in the accent. */
export function Columns({ data, height = 180, name, fmt, highlightLast = true }: {
  data: { x: string; y: number | null }[]; height?: number; name: string; fmt?: (v: number) => string; highlightLast?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: -4, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="x" {...axis} interval={0} tick={{ fontSize: 10.5 }} />
        <YAxis {...axis} allowDecimals={false} width={40} />
        <Tooltip cursor={{ fill: 'var(--panel-2)' }} content={<TooltipBox fmt={fmt} />} />
        <Bar dataKey="y" name={name} radius={[4, 4, 0, 0]} maxBarSize={24}>
          {data.map((_, i) => <Cell key={i} fill={highlightLast && i === data.length - 1 ? 'var(--accent)' : 'var(--series-1)'} fillOpacity={highlightLast && i === data.length - 1 ? 1 : 0.75} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Single-series line (e.g. MDR %). */
export function TrendLine({ data, height = 180, name, fmt, domain }: {
  data: { x: string; y: number | null }[]; height?: number; name: string; fmt?: (v: number) => string; domain?: [number, number];
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="x" {...axis} interval="preserveStartEnd" minTickGap={14} />
        <YAxis {...axis} width={40} domain={domain} tickFormatter={fmt} />
        <Tooltip cursor={{ stroke: 'var(--line-2)' }} content={<TooltipBox fmt={fmt} />} />
        <Line type="monotone" dataKey="y" name={name} stroke="var(--series-1)" strokeWidth={2} connectNulls
          dot={{ r: 3, fill: 'var(--series-1)', stroke: 'var(--panel)', strokeWidth: 2 }} activeDot={{ r: 5, stroke: 'var(--panel)', strokeWidth: 2 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bars with the value at the tip (HTML, so labels never clip). */
export function HBars({ rows, fmt = v => String(v), color = 'var(--series-1)', max, right }: {
  rows: { label: ReactNode; value: number; key: string; hint?: string; color?: string }[]; fmt?: (v: number) => string; color?: string; max?: number; right?: (key: string) => ReactNode;
}) {
  const m = max ?? Math.max(1, ...rows.map(r => r.value));
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map(r => (
        <div key={r.key} className="group grid grid-cols-[minmax(0,180px)_1fr_auto] items-center gap-3" title={r.hint}>
          <span className="truncate text-[12.5px] text-ink-2">{r.label}</span>
          <div className="h-2.5 rounded-full bg-panel-2">
            <div className="h-full rounded-r-[4px] rounded-l-full transition-all duration-700" style={{ width: `${Math.max(2, (r.value / m) * 100)}%`, background: r.color ?? color }} />
          </div>
          <span className="tnum min-w-[44px] text-right text-[12.5px] font-medium">{right ? right(r.key) : fmt(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Tiny sparkline for stat tiles (de-emphasis line, current point in accent). */
export function Sparkline({ values, height = 38, width = 120 }: { values: (number | null)[]; height?: number; width?: number }) {
  const v = values.map(x => x ?? NaN);
  const finite = v.filter(Number.isFinite);
  if (finite.length < 2) return null;
  const min = Math.min(...finite), max = Math.max(...finite), span = max - min || 1;
  const pts = v.map((y, i) => (Number.isFinite(y) ? [(i / (v.length - 1)) * (width - 6) + 3, height - 4 - ((y - min) / span) * (height - 8)] : null)).filter(Boolean) as number[][];
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden>
      <path d={`${d} L${last[0]},${height} L${pts[0][0]},${height} Z`} fill="var(--accent)" opacity={0.1} />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={3.5} fill="var(--accent)" stroke="var(--panel)" strokeWidth={2} />
    </svg>
  );
}

/** 100% stacked bar (e.g. AWaRe split) with a 2px surface gap between segments and a legend. */
export function StackBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full">
        {parts.filter(p => p.value > 0).map(p => (
          <div key={p.label} title={`${p.label}: ${Math.round((p.value / total) * 100)}%`} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
        {parts.map(p => (
          <span key={p.label} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            {p.label} <span className="tnum font-medium text-ink">{Math.round((p.value / total) * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}
