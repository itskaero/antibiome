// ═══════════════════════════════════════════════════════════
//  PEWS early warning (Brighton PEWS, the items are in scores.ts).
//
//  - pewsSuggest: the *least* cardiovascular / respiratory sub-score the numbers alone support, from
//    APLS age-normal heart and breathing rates. Colour, recession and behaviour need eyes on the child,
//    so the nurse always confirms; behaviour is never guessed.
//  - pewsStatus: the latest charted score, its trend, the escalation level and whether one is overdue.
// ═══════════════════════════════════════════════════════════
import { PEWS_ITEMS } from './scores';
import type { VitalValues } from './vitals';

/** APLS normal ranges (awake, at rest). */
const NORMAL: { maxMonths: number; label: string; hr: [number, number]; rr: [number, number] }[] = [
  { maxMonths: 12, label: '< 1 year', hr: [110, 160], rr: [30, 40] },
  { maxMonths: 24, label: '1–2 years', hr: [100, 150], rr: [25, 35] },
  { maxMonths: 60, label: '2–5 years', hr: [95, 140], rr: [25, 30] },
  { maxMonths: 144, label: '5–12 years', hr: [80, 120], rr: [20, 25] },
  { maxMonths: Infinity, label: '> 12 years', hr: [60, 100], rr: [15, 20] },
];
export const normalRanges = (ageMonths: number) => NORMAL.find(b => ageMonths < b.maxMonths)!;

export interface PewsSuggestion { cardiovascular: number; respiratory: number; reasons: string[] }

/** Minimum sub-scores supported by the numbers (heart rate, CRT, breathing rate, FiO₂). */
export function pewsSuggest(v: Pick<VitalValues, 'hr' | 'rr' | 'fio2' | 'crt'>, ageMonths: number): PewsSuggestion {
  const n = normalRanges(ageMonths);
  const reasons: string[] = [];
  let cv = 0, resp = 0;
  const up = (cur: number, to: number, why: string, set: (x: number) => void) => { if (to > cur) set(to); if (to > 0) reasons.push(why); };
  if (v.hr != null) {
    if (v.hr >= n.hr[1] + 30) up(cv, 3, `HR ${v.hr}: 30+ above normal (${n.hr[0]}–${n.hr[1]})`, x => { cv = x; });
    else if (v.hr >= n.hr[1] + 20) up(cv, 2, `HR ${v.hr}: 20+ above normal (${n.hr[0]}–${n.hr[1]})`, x => { cv = x; });
    else if (v.hr < n.hr[0] - 10) up(cv, 3, `HR ${v.hr}: bradycardia for age (normal ${n.hr[0]}–${n.hr[1]})`, x => { cv = x; });
  }
  if (v.crt != null) {
    if (v.crt >= 5) up(cv, 3, `CRT ${v.crt} s`, x => { cv = x; });
    else if (v.crt >= 4) up(cv, 2, `CRT ${v.crt} s`, x => { cv = x; });
    else if (v.crt >= 3) up(cv, 1, `CRT ${v.crt} s`, x => { cv = x; });
  }
  if (v.rr != null) {
    if (v.rr > n.rr[1] + 20) up(resp, 2, `RR ${v.rr}: 20+ above normal (${n.rr[0]}–${n.rr[1]})`, x => { resp = x; });
    else if (v.rr > n.rr[1] + 10) up(resp, 1, `RR ${v.rr}: 10+ above normal (${n.rr[0]}–${n.rr[1]})`, x => { resp = x; });
    else if (v.rr <= n.rr[0] - 5) reasons.push(`RR ${v.rr}: 5+ below normal — scores 3 if there is recession, tug or grunting`);
  }
  if (v.fio2 != null) {
    if (v.fio2 >= 50) up(resp, 3, `FiO₂ ${v.fio2}%`, x => { resp = x; });
    else if (v.fio2 >= 40) up(resp, 2, `FiO₂ ${v.fio2}%`, x => { resp = x; });
    else if (v.fio2 >= 30) up(resp, 1, `FiO₂ ${v.fio2}%`, x => { resp = x; });
  }
  return { cardiovascular: cv, respiratory: resp, reasons };
}

export type PewsLevel = 'routine' | 'senior' | 'doctor' | 'urgent';
export interface PewsThresholds { senior: number; doctor: number; urgent: number; overdueHours: number }
export const DEFAULT_PEWS_THRESHOLDS: PewsThresholds = { senior: 3, doctor: 4, urgent: 5, overdueHours: 4 };

export const PEWS_ACTION: Record<PewsLevel, { label: string; action: string }> = {
  routine: { label: 'Routine', action: 'Continue routine observations.' },
  senior: { label: 'Senior nurse review', action: 'Inform the nurse in charge; observations every hour.' },
  doctor: { label: 'Doctor review', action: 'Ask a doctor to review within 30 minutes; observations every 30 minutes.' },
  urgent: { label: 'Urgent review', action: 'Call the doctor now for immediate review; consider the emergency team.' },
};

/** Escalation level for a total (any single item scoring 3 is urgent whatever the total). */
export function pewsLevel(score: number, t: PewsThresholds = DEFAULT_PEWS_THRESHOLDS, maxItem = 0): PewsLevel {
  if (score >= t.urgent || maxItem >= 3) return 'urgent';
  if (score >= t.doctor) return 'doctor';
  if (score >= t.senior) return 'senior';
  return 'routine';
}

export interface PewsStatus { score: number | null; at: string | null; prev: number | null; trend: 'up' | 'down' | 'same' | null; level: PewsLevel | null; overdue: boolean; hoursSince: number | null }
const ms = (s: string) => new Date(s).getTime();

/** From charted sets (any order): latest PEWS, trend against the one before, level, overdue. */
export function pewsStatus(sets: { at: string; values: VitalValues }[], now: number, t: PewsThresholds = DEFAULT_PEWS_THRESHOLDS): PewsStatus {
  const scored = sets.filter(s => s.values.pews != null).sort((a, b) => b.at.localeCompare(a.at));
  if (!scored.length) return { score: null, at: null, prev: null, trend: null, level: null, overdue: true, hoursSince: null };
  const [last, before] = scored;
  const score = last.values.pews!, prev = before?.values.pews ?? null;
  const hoursSince = Math.max(0, (now - ms(last.at)) / 3_600_000);
  return {
    score, at: last.at, prev,
    trend: prev == null ? null : score > prev ? 'up' : score < prev ? 'down' : 'same',
    level: pewsLevel(score, t), overdue: hoursSince > t.overdueHours, hoursSince: Math.round(hoursSince * 10) / 10,
  };
}

/** Thresholds stored as a unit setting (JSON); anything invalid falls back to the defaults. */
export function parseThresholds(raw: string | null | undefined): PewsThresholds {
  try {
    const p = JSON.parse(raw ?? '');
    const ok = (x: unknown, lo: number, hi: number) => typeof x === 'number' && x >= lo && x <= hi;
    if (ok(p.senior, 1, 13) && ok(p.doctor, p.senior, 13) && ok(p.urgent, p.doctor, 13) && ok(p.overdueHours, 1, 24)) return p;
  } catch { /* defaults */ }
  return DEFAULT_PEWS_THRESHOLDS;
}

export const PEWS_ITEM_KEYS = PEWS_ITEMS.map(i => i.key);
