// Fluid balance: intake/output entries and the derived 24 h balance and urine output.
// Pure functions, shared by the PC and phones.
import { ms } from './time';

export const FLUID_IN = ['IV fluids', 'Blood products', 'Feeds', 'Oral', 'Drugs & flushes'] as const;
export const FLUID_OUT = ['Urine', 'Drain', 'NG aspirate', 'Vomit', 'Stool', 'Other'] as const;
export type FluidDir = 'in' | 'out';
export interface FluidEntry { id: string; admissionId: string; at: string; dir: FluidDir; category: string; ml: number; note: string | null }

export interface FluidSummary {
  /** Window actually covered (hours since admission, capped at the requested window). */
  hours: number;
  in: number; out: number; balance: number;
  urineMl: number;
  /** mL/kg/h over the window; null without a weight or any urine entry. */
  urineRate: number | null;
  oliguria: boolean;
  byCategory: { dir: FluidDir; category: string; ml: number }[];
  /** Totals per 6 h block, oldest first (for the bar chart). */
  blocks: { start: string; in: number; out: number }[];
}

export function summarizeFluids(entries: FluidEntry[], opts: { now: number; admitAt: string; weightKg: number | null; windowHours?: number }): FluidSummary {
  const windowHours = opts.windowHours ?? 24;
  const end = opts.now, start = Math.max(end - windowHours * 3_600_000, ms(opts.admitAt));
  const hours = Math.max(1, (end - start) / 3_600_000);
  const inWin = entries.filter(e => ms(e.at) >= start && ms(e.at) <= end);
  const sum = (d: FluidDir) => inWin.filter(e => e.dir === d).reduce((n, e) => n + e.ml, 0);
  const urineMl = inWin.filter(e => e.dir === 'out' && e.category === 'Urine').reduce((n, e) => n + e.ml, 0);
  const hasUrine = inWin.some(e => e.dir === 'out' && e.category === 'Urine');
  const urineRate = opts.weightKg && hasUrine ? Math.round((urineMl / opts.weightKg / hours) * 10) / 10 : null;
  const cats = new Map<string, { dir: FluidDir; category: string; ml: number }>();
  inWin.forEach(e => { const k = `${e.dir}:${e.category}`; const c = cats.get(k) ?? { dir: e.dir, category: e.category, ml: 0 }; c.ml += e.ml; cats.set(k, c); });
  const blocks: FluidSummary['blocks'] = [];
  for (let t = end - windowHours * 3_600_000; t < end; t += 6 * 3_600_000) {
    const b = inWin.filter(e => ms(e.at) >= t && ms(e.at) < t + 6 * 3_600_000);
    blocks.push({ start: new Date(t).toISOString(), in: b.filter(e => e.dir === 'in').reduce((n, e) => n + e.ml, 0), out: b.filter(e => e.dir === 'out').reduce((n, e) => n + e.ml, 0) });
  }
  const i = sum('in'), o = sum('out');
  return { hours: Math.round(hours * 10) / 10, in: i, out: o, balance: i - o, urineMl, urineRate, oliguria: urineRate != null && urineRate < 0.5 && hours >= 6,
    byCategory: [...cats.values()].sort((a, b) => b.ml - a.ml), blocks };
}
