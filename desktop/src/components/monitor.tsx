// Visual building blocks for the live monitor: a sweeping waveform canvas, the body map with
// sensor positions, gradient vital tiles and range-bar trends.
import { useEffect, useRef, type ReactNode } from 'react';
import { cx } from '@/lib/format';
import { waveQueue, waveRate, type TrendPoint, type WaveKind } from '@/lib/monitor';

/** Classic monitor colours, the same in both themes. */
export const WAVE_COLOR: Record<WaveKind, string> = { ecg: '#34d399', pleth: '#22d3ee', resp: '#facc15' };

/**
 * Sweep-style waveform, like a bedside monitor: a cursor writes left to right and erases just
 * ahead of itself. Samples come from the live queue; the display runs ~0.5 s behind so the
 * once-a-second frames from the monitor play back smoothly.
 */
export function Waveform({ bed, kind, height = 72, speed = 110, className, label }: { bed: number; kind: WaveKind; height?: number; speed?: number; className?: string; label?: ReactNode }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!; const ctx = canvas.getContext('2d')!;
    let raf = 0, last = performance.now(), cursor = 0, carry = 0, width = 0, buf = new Float32Array(0), lo = 0, hi = 255;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth;
      canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (w !== width) { width = w; buf = new Float32Array(Math.max(1, Math.round(w))).fill(NaN); cursor = 0; }
    };
    const ro = new ResizeObserver(resize); ro.observe(canvas); resize();
    const q = waveQueue(bed, kind), rate = waveRate(kind);
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      // Keep about half a second buffered; drop the backlog if we fell behind.
      if (q.length > rate * 2) q.splice(0, q.length - Math.round(rate * 0.5));
      const playing = q.length > 0;
      carry += playing ? speed * dt : 0;
      const perPx = rate / speed;
      while (carry >= 1 && q.length) {
        carry -= 1;
        const n = Math.max(1, Math.round(perPx)), chunk = q.splice(0, n);
        // Keep peaks visible when several samples fall on one pixel (QRS spikes).
        let v = chunk[0], dev = 0; const mid = (lo + hi) / 2;
        for (const s of chunk) if (Math.abs(s - mid) > dev) { dev = Math.abs(s - mid); v = s; }
        buf[cursor] = v; cursor = (cursor + 1) % buf.length;
      }
      if (!q.length) carry = 0;
      // Auto-scale to what is on screen, smoothly.
      let mn = Infinity, mx = -Infinity;
      for (const v of buf) if (v === v) { if (v < mn) mn = v; if (v > mx) mx = v; }
      if (mn !== Infinity) { const pad = Math.max(6, (mx - mn) * 0.15); lo += (mn - pad - lo) * 0.08; hi += (mx + pad - hi) * 0.08; }
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = WAVE_COLOR[kind]; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
      ctx.shadowColor = WAVE_COLOR[kind]; ctx.shadowBlur = 6;
      ctx.beginPath();
      let pen = false;
      const gap = 14, span = hi - lo || 1;
      for (let x = 0; x < buf.length; x++) {
        const ahead = (x - cursor + buf.length) % buf.length;
        const v = buf[x];
        if (ahead < gap || v !== v) { pen = false; continue; }
        const y = height - 4 - ((v - lo) / span) * (height - 8);
        if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true; }
      }
      ctx.stroke();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [bed, kind, height, speed]);
  return (
    <div className={cx('relative', className)}>
      {label && <span className="pointer-events-none absolute top-1 left-2 text-[10.5px] font-semibold tracking-wide" style={{ color: WAVE_COLOR[kind] }}>{label}</span>}
      <canvas ref={ref} style={{ width: '100%', height, display: 'block' }} />
    </div>
  );
}

// ── Vital tiles ──────────────────────────────────────────────

export type TileTone = 'teal' | 'sky' | 'plain' | 'alert';
const TILE_BG: Record<TileTone, string> = {
  teal: 'linear-gradient(140deg, #2dd4bf 0%, #14b8a6 45%, #0891b2 100%)',
  sky: 'linear-gradient(140deg, #38bdf8 0%, #0ea5e9 50%, #2563eb 100%)',
  alert: 'linear-gradient(140deg, #fb7185 0%, #e11d48 100%)',
  plain: '',
};
export function VitalTile({ tone = 'plain', title, value, unit, sub, badge, children, className }: {
  tone?: TileTone; title: ReactNode; value: ReactNode; unit?: ReactNode; sub?: ReactNode; badge?: ReactNode; children?: ReactNode; className?: string;
}) {
  const filled = tone !== 'plain';
  return (
    <div className={cx('relative overflow-hidden rounded-[20px] p-4', filled ? 'text-white shadow-[0_18px_36px_-20px_rgba(8,145,178,0.9)]' : 'card', className)} style={filled ? { background: TILE_BG[tone] } : undefined}>
      {filled && <div className="pointer-events-none absolute -top-10 -right-10 h-36 w-36 rounded-full" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.28), transparent 70%)' }} />}
      <div className="relative flex items-start justify-between gap-2">
        <span className={cx('text-[13px] font-semibold', filled ? 'text-white' : 'text-ink')}>{title}</span>
        {badge}
      </div>
      {sub && <div className={cx('relative mt-0.5 text-[11.5px]', filled ? 'text-white/80' : 'text-ink-3')}>{sub}</div>}
      {children && <div className="relative">{children}</div>}
      <div className="relative mt-2 flex items-baseline gap-1">
        <span className="tnum text-[38px] leading-none font-semibold tracking-tight">{value}</span>
        {unit && <span className={cx('text-[14px] font-medium', filled ? 'text-white/85' : 'text-ink-3')}>{unit}</span>}
      </div>
    </div>
  );
}

/** Radial tick gauge (the temperature dial in the reference design). */
export function TickGauge({ value, min, max, size = 86 }: { value: number | null; min: number; max: number; size?: number }) {
  const n = 22, frac = value == null ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min)));
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="absolute -top-1 right-0 opacity-90" aria-hidden>
      {Array.from({ length: n }, (_, i) => {
        const a = (-200 + (i / (n - 1)) * 220) * Math.PI / 180, on = i / (n - 1) <= frac;
        return <line key={i} x1={50 + Math.cos(a) * 32} y1={50 + Math.sin(a) * 32} x2={50 + Math.cos(a) * 44} y2={50 + Math.sin(a) * 44}
          stroke="white" strokeOpacity={on ? 0.95 : 0.3} strokeWidth={on ? 3 : 2} strokeLinecap="round" />;
      })}
    </svg>
  );
}

// ── Trend: min–max range bars per time bin ───────────────────

export function RangeBars({ points, height = 170, binMinutes = 5, color = 'var(--series-3)', unit = '', domain }: {
  points: TrendPoint[]; height?: number; binMinutes?: number; color?: string; unit?: string; domain?: [number, number];
}) {
  const bins: { t: number; min: number; max: number; mean: number }[] = [];
  const size = binMinutes * 60_000;
  for (const p of points) {
    const t = Math.floor(p.t / size) * size, b = bins[bins.length - 1];
    if (b && b.t === t) { b.min = Math.min(b.min, p.min); b.max = Math.max(b.max, p.max); b.mean = (b.mean + p.mean) / 2; }
    else bins.push({ t, min: p.min, max: p.max, mean: p.mean });
  }
  const shown = bins.slice(-36);
  if (!shown.length) return <div className="grid place-items-center text-[12.5px] text-ink-3" style={{ height }}>Trend builds up while the monitor is connected (one point a minute).</div>;
  const lo = domain?.[0] ?? Math.floor(Math.min(...shown.map(b => b.min)) / 10) * 10 - 10;
  const hi = domain?.[1] ?? Math.ceil(Math.max(...shown.map(b => b.max)) / 10) * 10 + 10;
  const W = 640, H = height, L = 34, B = 22, colW = (W - L) / Math.max(shown.length, 12);
  const y = (v: number) => (H - B) - ((v - lo) / (hi - lo)) * (H - B - 8);
  const ticks = [lo, lo + (hi - lo) / 3, lo + (2 * (hi - lo)) / 3, hi].map(v => Math.round(v));
  const avg = Math.round(shown.reduce((s, b) => s + b.mean, 0) / shown.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`Trend, average ${avg}${unit}`}>
      {ticks.map(t => <g key={t}><line x1={L} x2={W} y1={y(t)} y2={y(t)} stroke="var(--grid)" /><text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="10.5" fill="var(--text-3)">{t}</text></g>)}
      {shown.map((b, i) => {
        const x = L + i * colW + colW / 2, last = i === shown.length - 1;
        return (
          <g key={b.t}>
            <line x1={x} x2={x} y1={y(b.max)} y2={y(b.min) + (b.max === b.min ? 0.01 : 0)} stroke={color} strokeOpacity={last ? 1 : 0.55} strokeWidth={Math.min(9, colW * 0.55)} strokeLinecap="round" />
            {(i % Math.ceil(shown.length / 6) === 0 || last) && <text x={x} y={H - 6} textAnchor="middle" fontSize="10.5" fill={last ? 'var(--text)' : 'var(--text-3)'}>{new Date(b.t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</text>}
          </g>
        );
      })}
    </svg>
  );
}

// ── Body map ─────────────────────────────────────────────────

export interface Sensor { id: string; label: string; x: number; y: number; on: boolean }
/** Stylised figure with the monitor's sensors placed where they sit on the child; live ones glow. */
export function BodyMap({ sensors, children }: { sensors: Sensor[]; children?: ReactNode }) {
  return (
    <div className="relative h-full min-h-[440px] overflow-hidden rounded-[22px]" style={{ background: 'radial-gradient(120% 80% at 50% 10%, rgba(45,212,191,0.16), transparent 60%), var(--panel-2)' }}>
      <svg viewBox="0 0 300 520" preserveAspectRatio="xMidYMid meet" className="absolute inset-x-0 top-10 bottom-12 m-auto h-[calc(100%-88px)] w-full" aria-hidden>
        <defs>
          <linearGradient id="skin" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--panel)" /><stop offset="1" stopColor="var(--panel-3)" /></linearGradient>
          <radialGradient id="glow"><stop offset="0" stopColor="#2dd4bf" stopOpacity="0.55" /><stop offset="1" stopColor="#2dd4bf" stopOpacity="0" /></radialGradient>
        </defs>
        <ellipse cx="150" cy="492" rx="112" ry="16" fill="none" stroke="#2dd4bf" strokeOpacity="0.55" strokeWidth="2" />
        <ellipse cx="150" cy="492" rx="86" ry="10" fill="none" stroke="#2dd4bf" strokeOpacity="0.3" strokeWidth="6" />
        <g fill="url(#skin)" stroke="var(--line-2)" strokeWidth="1.5">
          <ellipse cx="150" cy="62" rx="34" ry="40" />
          <rect x="136" y="96" width="28" height="22" rx="8" />
          <path d="M96 128 Q150 108 204 128 Q222 136 222 160 L214 262 Q212 290 196 300 L190 318 Q150 330 110 318 L104 300 Q88 290 86 262 L78 160 Q78 136 96 128 Z" />
          <path d="M98 134 Q70 146 66 182 L54 286 Q52 300 62 302 Q72 304 74 290 L92 196" />
          <path d="M202 134 Q230 146 234 182 L246 286 Q248 300 238 302 Q228 304 226 290 L208 196" />
          <path d="M112 318 L106 470 Q106 484 120 484 Q132 484 134 470 L146 330 Z" />
          <path d="M188 318 L194 470 Q194 484 180 484 Q168 484 166 470 L154 330 Z" />
        </g>
        {sensors.map(s => (
          <g key={s.id} transform={`translate(${s.x} ${s.y})`}>
            {s.on && <circle r="26" fill="url(#glow)"><animate attributeName="r" values="18;30;18" dur="2.4s" repeatCount="indefinite" /></circle>}
            <circle r="7.5" fill={s.on ? '#14b8a6' : 'var(--panel-3)'} stroke={s.on ? '#ccfbf1' : 'var(--line-2)'} strokeWidth="2.5" />
          </g>
        ))}
      </svg>
      {children}
    </div>
  );
}
/** Where each sensor sits on the body map (SVG coordinates). */
export const SENSOR_SPOTS = { ecg: { x: 132, y: 168 }, spo2: { x: 240, y: 296 }, nibp: { x: 78, y: 176 }, temp: { x: 104, y: 150 } };
