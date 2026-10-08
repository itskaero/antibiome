// ═══════════════════════════════════════════════════════════
//  PICU analytics engine — pure functions over a de-identified Dataset.
//  One definition per metric; the dashboard, monthly report and change
//  detection all read from monthSummary() so numbers never disagree.
// ═══════════════════════════════════════════════════════════
import type { Admission, Dataset, Episode } from './types';
import { RESP_LEVELS, awareGroup, dxLabel, type AwareGroup, type RespLevel } from './reference';
import { isMDR } from './mdr';
import { calendarDaysTouched, daysInMonth, DAY_MS, fmtMonth, monthBounds, ms, overlapDays, shiftMonth } from './time';
import { fisherExact, medianIqr, poissonRateTest } from './stats';
import { smr } from './pim3';

export const endMs = (a: Admission, now: number) => (a.dischargeAt ? ms(a.dischargeAt) : now);
export const losDays = (a: Admission, now: number) => Math.max(0, (endMs(a, now) - ms(a.admitAt)) / DAY_MS);
const episodeEnd = (e: Episode, ds: Dataset, now: number) => {
  if (e.endAt) return ms(e.endAt);
  const adm = ds.admissions.find(a => a.id === e.admissionId);
  return adm?.dischargeAt ? ms(adm.dischargeAt) : now;
};

export function peakSupport(a: Admission, eps: Episode[]): RespLevel {
  let best = RESP_LEVELS.indexOf(a.arrivalSupport);
  eps.forEach(e => { if (e.kind === 'resp' && e.admissionId === a.id) best = Math.max(best, RESP_LEVELS.indexOf(e.detail as RespLevel)); });
  return RESP_LEVELS[Math.max(0, best)];
}

export interface DxRow { code: string; label: string; n: number; deaths: number; medianLos: number | null; mvPatients: number }
export interface MonthSummary {
  month: string;
  /** Days of the month covered by data (partial for the current month). */
  elapsedDays: number;
  admissions: number;
  emergency: number;
  discharges: number;
  deaths: number;
  mortalityPct: number | null;
  los: ReturnType<typeof medianIqr>;
  patientDays: number;
  occupancyPct: number | null;
  /** Admissions present at any point in the month (denominator for support rates). */
  patientsManaged: number;
  support: Record<'O2' | 'HFNC' | 'NIV' | 'MV', { patients: number; days: number }>;
  vaso: { patients: number; days: number };
  topDx: DxRow[];
  dot: { total: number; per1000: number | null; byDrug: Record<string, number>; byAware: Record<AwareGroup, number>; exposedPatients: number };
  micro: { cultures: number; positives: number; mdr: number; organisms: Record<string, number>; mdrByOrganism: Record<string, number> };
  completeness: { pct: number; missing: { field: string; n: number }[] };
  /** Risk-adjusted mortality among discharges with a PIM3 assessment. */
  smr: { observed: number; expected: number; n: number; coverage: number; smr: number; lo: number; hi: number } | null;
}

export function monthSummary(ds: Dataset, month: string, now: number): MonthSummary {
  const [p, qFull] = monthBounds(month);
  const q = Math.min(qFull, Math.max(p, now));
  const elapsedDays = Math.max(0, Math.min(daysInMonth(month), Math.ceil((q - p) / DAY_MS)));
  const adm = ds.admissions;

  const admitted = adm.filter(a => { const t = ms(a.admitAt); return t >= p && t < q; });
  const discharged = adm.filter(a => a.dischargeAt && ms(a.dischargeAt) >= p && ms(a.dischargeAt) < q);
  const present = adm.filter(a => ms(a.admitAt) < q && endMs(a, now) > p);
  const deaths = discharged.filter(a => a.disposition === 'Died').length;
  const patientDays = present.reduce((s, a) => s + overlapDays(ms(a.admitAt), endMs(a, now), p, q), 0);

  const presentIds = new Set(present.map(a => a.id));
  const eps = ds.episodes.filter(e => presentIds.has(e.admissionId) && ms(e.startAt) < q && episodeEnd(e, ds, now) > p);

  const support = { O2: { patients: 0, days: 0 }, HFNC: { patients: 0, days: 0 }, NIV: { patients: 0, days: 0 }, MV: { patients: 0, days: 0 } };
  (['O2', 'HFNC', 'NIV', 'MV'] as const).forEach(level => {
    const lvl = eps.filter(e => e.kind === 'resp' && e.detail === level);
    support[level].patients = new Set(lvl.map(e => e.admissionId)).size;
    support[level].days = lvl.reduce((s, e) => s + overlapDays(ms(e.startAt), episodeEnd(e, ds, now), p, q), 0);
  });
  const vasoEps = eps.filter(e => e.kind === 'vaso');
  const vaso = {
    patients: new Set(vasoEps.map(e => e.admissionId)).size,
    days: unionDays(vasoEps, ds, now, p, q),
  };

  // Days of therapy: each calendar day an agent is given counts 1 per agent.
  const byDrug: Record<string, number> = {};
  const byAware: Record<AwareGroup, number> = { Access: 0, Watch: 0, Reserve: 0, Unclassified: 0 };
  eps.filter(e => e.kind === 'abx').forEach(e => {
    const d = calendarDaysTouched(ms(e.startAt), episodeEnd(e, ds, now), p, q);
    byDrug[e.detail] = (byDrug[e.detail] ?? 0) + d;
    byAware[awareGroup(e.detail)] += d;
  });
  const dotTotal = Object.values(byDrug).reduce((s, v) => s + v, 0);

  const losAll = discharged.map(a => losDays(a, now));
  const dxMap: Record<string, Admission[]> = {};
  admitted.forEach(a => { (dxMap[a.primaryDx] ??= []).push(a); });
  const topDx: DxRow[] = Object.entries(dxMap).map(([code, list]) => ({
    code, label: dxLabel(code), n: list.length,
    deaths: list.filter(a => a.disposition === 'Died').length,
    medianLos: medianIqr(list.filter(a => a.dischargeAt).map(a => losDays(a, now)))?.median ?? null,
    mvPatients: list.filter(a => peakSupport(a, ds.episodes) === 'MV').length,
  })).sort((a, b) => b.n - a.n);

  const cultures = ds.cultures.filter(c => { const t = ms(c.collectedAt); return t >= p && t < q; });
  const positives = cultures.filter(c => c.organism);
  const organisms: Record<string, number> = {};
  const mdrByOrganism: Record<string, number> = {};
  positives.forEach(c => {
    organisms[c.organism!] = (organisms[c.organism!] ?? 0) + 1;
    if (isMDR(c)) mdrByOrganism[c.organism!] = (mdrByOrganism[c.organism!] ?? 0) + 1;
  });

  const missing = [
    { field: 'Weight', n: admitted.filter(a => a.weightKg == null).length },
    { field: 'Bed', n: admitted.filter(a => !a.bed).length },
    { field: 'Outcome (open > 30 days)', n: present.filter(a => !a.dischargeAt && (now - ms(a.admitAt)) / DAY_MS > 30).length },
  ];
  // Admission vitals: counted only from the first recorded set onwards (go-live), so months
  // before vitals were introduced are not penalised.
  const vitalsSince = ds.vitals?.length ? Math.min(...ds.vitals.map(v => ms(v.at))) - 3_600_000 : null;
  if (vitalsSince != null) {
    const due = admitted.filter(a => ms(a.admitAt) >= vitalsSince && now - ms(a.admitAt) > 3_600_000);
    const withAdm = new Set(ds.vitals!.filter(v => { const a = due.find(x => x.id === v.admissionId); return a && Math.abs(ms(v.at) - ms(a.admitAt)) <= 3_600_000; }).map(v => v.admissionId));
    missing.push({ field: 'Admission vitals', n: due.filter(a => !withAdm.has(a.id)).length });
  }
  const checks = admitted.length * (vitalsSince != null ? 3 : 2) + present.length;
  const missingTotal = missing.reduce((s, m) => s + m.n, 0);

  return {
    month, elapsedDays,
    admissions: admitted.length,
    emergency: admitted.filter(a => a.admissionType === 'emergency').length,
    discharges: discharged.length,
    deaths,
    mortalityPct: discharged.length ? (deaths / discharged.length) * 100 : null,
    los: medianIqr(losAll),
    patientDays,
    occupancyPct: ds.beds && elapsedDays ? (patientDays / (ds.beds * elapsedDays)) * 100 : null,
    patientsManaged: present.length,
    support, vaso, topDx,
    dot: {
      total: dotTotal, per1000: patientDays ? (dotTotal / patientDays) * 1000 : null, byDrug, byAware,
      exposedPatients: new Set(eps.filter(e => e.kind === 'abx').map(e => e.admissionId)).size,
    },
    micro: { cultures: cultures.length, positives: positives.length, mdr: positives.filter(isMDR).length, organisms, mdrByOrganism },
    completeness: { pct: checks ? Math.round((1 - missingTotal / checks) * 100) : 100, missing },
    smr: smrFor(discharged),
  };
}

export function smrFor(discharged: Admission[]): MonthSummary['smr'] {
  const scored = discharged.filter(a => a.pim3Risk != null);
  if (!scored.length) return null;
  const observed = scored.filter(a => a.disposition === 'Died').length;
  const expected = scored.reduce((s, a) => s + (a.pim3Risk as number), 0);
  const r = smr(observed, expected);
  return r ? { observed, expected, n: scored.length, coverage: (scored.length / discharged.length) * 100, ...r } : null;
}

/** Days with ≥1 overlapping episode (so two vasoactives at once count once). */
function unionDays(eps: Episode[], ds: Dataset, now: number, p: number, q: number): number {
  const byAdm: Record<string, [number, number][]> = {};
  eps.forEach(e => (byAdm[e.admissionId] ??= []).push([Math.max(p, ms(e.startAt)), Math.min(q, episodeEnd(e, ds, now))]));
  let total = 0;
  Object.values(byAdm).forEach(iv => {
    iv.sort((a, b) => a[0] - b[0]);
    let [cs, ce] = iv[0];
    for (const [s, e] of iv.slice(1)) { if (s <= ce) ce = Math.max(ce, e); else { total += Math.max(0, ce - cs); [cs, ce] = [s, e]; } }
    total += Math.max(0, ce - cs);
  });
  return total / DAY_MS;
}

// ── Census ───────────────────────────────────────────────────

export const presentAt = (ds: Dataset, t: number) => ds.admissions.filter(a => ms(a.admitAt) <= t && (!a.dischargeAt || ms(a.dischargeAt) > t));

/** Census at 08:00 each day of the month (the conventional morning census). Future days are null. */
export function dailyCensus(ds: Dataset, month: string, now: number): (number | null)[] {
  const [p] = monthBounds(month);
  return Array.from({ length: daysInMonth(month) }, (_, i) => {
    const t = p + i * DAY_MS + 8 * 3_600_000;
    return t > now ? null : presentAt(ds, t).length;
  });
}

export interface SeriesPoint { month: string; label: string; admissions: number; deaths: number; mvPatients: number; mdrPct: number | null; positives: number; dotPer1000: number | null }
export function monthlySeries(ds: Dataset, endMonth: string, count: number, now: number): SeriesPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const m = shiftMonth(endMonth, i - count + 1);
    const s = monthSummary(ds, m, now);
    return {
      month: m, label: fmtMonth(m), admissions: s.admissions, deaths: s.deaths, mvPatients: s.support.MV.patients,
      positives: s.micro.positives, mdrPct: s.micro.positives ? (s.micro.mdr / s.micro.positives) * 100 : null, dotPer1000: s.dot.per1000,
    };
  });
}

/** Linear projection of a month-to-date count; only meaningful for the current month. */
export function projectMonth(s: MonthSummary): number | null {
  const full = daysInMonth(s.month);
  if (s.elapsedDays >= full || s.elapsedDays < 7) return null;
  return Math.round((s.admissions / s.elapsedDays) * full);
}

// ── Change detection ─────────────────────────────────────────
// A change is surfaced only when (a) there is enough data, (b) it is large
// (≥ 20% relative) and (c) an exact test supports it (p < 0.05). Large changes
// that fail the test go to "possibly noise" so they are visible but not headlined.
// Wording is strictly descriptive — no causal language.

export interface Notice {
  id: string;
  domain: 'activity' | 'diagnosis' | 'respiratory' | 'outcome' | 'stewardship' | 'microbiology';
  direction: 'up' | 'down';
  /** watch = worth a look (e.g. rising resistance), info = neutral change, good = favourable */
  tone: 'watch' | 'info' | 'good';
  title: string;
  detail: string;
  relChange: number;
  p: number | null;
  test: string;
  significant: boolean;
}

const MIN_RELATIVE = 0.2;
const ALPHA = 0.05;
const pctChange = (cur: number, prev: number) => (prev === 0 ? (cur > 0 ? Infinity : 0) : (cur - prev) / prev);
const fmtPct = (r: number) => (Number.isFinite(r) ? `${Math.round(Math.abs(r) * 100)}%` : 'new');
const fmt1 = (v: number) => (Math.round(v * 10) / 10).toString();

export function detectChanges(ds: Dataset, month: string, now: number): { notices: Notice[]; noise: Notice[]; prevMonth: string } {
  const prevMonth = shiftMonth(month, -1);
  const cur = monthSummary(ds, month, now);
  const prev = monthSummary(ds, prevMonth, now);
  const out: Notice[] = [];

  // Counts per calendar day (handles a partial current month fairly).
  const countRule = (id: string, domain: Notice['domain'], what: string, k1: number, k2: number, upTone: Notice['tone'] = 'info', minTotal = 10) => {
    if (k1 + k2 < minTotal || !cur.elapsedDays || !prev.elapsedDays) return;
    const r1 = k1 / cur.elapsedDays, r2 = k2 / prev.elapsedDays;
    const rel = pctChange(r1, r2);
    if (Math.abs(rel) < MIN_RELATIVE) return;
    const p = poissonRateTest(k1, cur.elapsedDays, k2, prev.elapsedDays);
    const direction = rel > 0 ? 'up' : 'down';
    out.push({
      id, domain, direction, tone: direction === 'up' ? upTone : upTone === 'watch' ? 'good' : 'info', relChange: rel, p,
      test: 'Exact Poisson rate test (per day)', significant: p < ALPHA,
      title: `${what} ${direction} ${fmtPct(rel)}`,
      detail: `${k1} in ${fmtMonth(month)}${cur.elapsedDays < daysInMonth(month) ? ` (first ${cur.elapsedDays} days)` : ''} vs ${k2} in ${fmtMonth(prevMonth)}`,
    });
  };
  // Proportions.
  const propRule = (id: string, domain: Notice['domain'], what: string, k1: number, n1: number, k2: number, n2: number, upTone: Notice['tone']) => {
    if (n1 < 10 || n2 < 10) return;
    const p1 = k1 / n1, p2 = k2 / n2, rel = pctChange(p1, p2);
    if (Math.abs(rel) < MIN_RELATIVE) return;
    const p = fisherExact(k1, n1 - k1, k2, n2 - k2);
    const direction = rel > 0 ? 'up' : 'down';
    out.push({
      id, domain, direction, tone: direction === 'up' ? upTone : upTone === 'watch' ? 'good' : 'info', relChange: rel, p,
      test: "Fisher's exact test", significant: p < ALPHA,
      title: `${what} ${direction} ${fmtPct(rel)}`,
      detail: `${Math.round(p1 * 100)}% (${k1}/${n1}) vs ${Math.round(p2 * 100)}% (${k2}/${n2}) in ${fmtMonth(prevMonth)}`,
    });
  };
  // Rates per patient-day (DOT).
  const rateRule = (id: string, domain: Notice['domain'], what: string, k1: number, e1: number, k2: number, e2: number, upTone: Notice['tone']) => {
    if (k1 + k2 < 10 || e1 < 20 || e2 < 20) return;
    const r1 = (k1 / e1) * 1000, r2 = (k2 / e2) * 1000, rel = pctChange(r1, r2);
    if (Math.abs(rel) < MIN_RELATIVE) return;
    const p = poissonRateTest(k1, e1, k2, e2);
    const direction = rel > 0 ? 'up' : 'down';
    out.push({
      id, domain, direction, tone: direction === 'up' ? upTone : upTone === 'watch' ? 'good' : 'info', relChange: rel, p,
      test: 'Exact Poisson rate test (per patient-day)', significant: p < ALPHA,
      title: `${what} ${direction} ${fmtPct(rel)}`,
      detail: `${Math.round(r1)} vs ${Math.round(r2)} days of therapy per 1,000 patient-days`,
    });
  };

  countRule('admissions', 'activity', 'Admissions', cur.admissions, prev.admissions);
  const dxCodes = new Set([...cur.topDx.slice(0, 8), ...prev.topDx.slice(0, 8)].map(d => d.code));
  dxCodes.forEach(code => {
    const k1 = cur.topDx.find(d => d.code === code)?.n ?? 0, k2 = prev.topDx.find(d => d.code === code)?.n ?? 0;
    countRule(`dx:${code}`, 'diagnosis', `${dxLabel(code)} admissions`, k1, k2, 'info', 8);
  });
  propRule('mv', 'respiratory', 'Ventilated patients', cur.support.MV.patients, cur.patientsManaged, prev.support.MV.patients, prev.patientsManaged, 'watch');
  propRule('mortality', 'outcome', 'Mortality', cur.deaths, cur.discharges, prev.deaths, prev.discharges, 'watch');
  const drugs = new Set([...Object.keys(cur.dot.byDrug), ...Object.keys(prev.dot.byDrug)]);
  drugs.forEach(d => rateRule(`dot:${d}`, 'stewardship', `${d} use`, cur.dot.byDrug[d] ?? 0, cur.patientDays, prev.dot.byDrug[d] ?? 0, prev.patientDays, 'watch'));
  rateRule('dot:reserve', 'stewardship', 'Reserve-group antibiotic use', cur.dot.byAware.Reserve, cur.patientDays, prev.dot.byAware.Reserve, prev.patientDays, 'watch');
  propRule('mdr', 'microbiology', 'MDR share of positive isolates', cur.micro.mdr, cur.micro.positives, prev.micro.mdr, prev.micro.positives, 'watch');
  const orgs = new Set([...Object.keys(cur.micro.organisms), ...Object.keys(prev.micro.organisms)]);
  orgs.forEach(o => countRule(`org:${o}`, 'microbiology', `${o} isolates`, cur.micro.organisms[o] ?? 0, prev.micro.organisms[o] ?? 0, 'watch', 8));

  // LOS is skewed and per-patient; reported descriptively only (no test).
  if (cur.los && prev.los && cur.los.n >= 10 && prev.los.n >= 10) {
    const rel = pctChange(cur.los.median, prev.los.median);
    if (Math.abs(rel) >= MIN_RELATIVE) out.push({
      id: 'los', domain: 'outcome', direction: rel > 0 ? 'up' : 'down', tone: 'info', relChange: rel, p: null,
      test: 'Descriptive only (medians)', significant: false,
      title: `Median length of stay ${rel > 0 ? 'up' : 'down'} ${fmtPct(rel)}`,
      detail: `${fmt1(cur.los.median)} d (IQR ${fmt1(cur.los.q1)}–${fmt1(cur.los.q3)}) vs ${fmt1(prev.los.median)} d in ${fmtMonth(prevMonth)}`,
    });
  }

  const byMagnitude = (a: Notice, b: Notice) => (a.p ?? 1) - (b.p ?? 1) || Math.abs(b.relChange) - Math.abs(a.relChange);
  return {
    // Descriptive-only items (p === null) are shown with their label; they never claim significance.
    notices: out.filter(n => n.significant || n.p === null).sort(byMagnitude),
    noise: out.filter(n => !n.significant && n.p !== null).sort(byMagnitude),
    prevMonth,
  };
}
