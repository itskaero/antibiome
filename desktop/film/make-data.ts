// Pulls the film's material from the real app: seeds the synthetic demo database, then calls the
// same API the UI calls (census, antibiogram, cultures, dashboard, stewardship, one patient's
// stay with vitals and Phoenix) and writes film/data.json. Patients appear by pseudonymous ID.
import { writeFileSync } from 'node:fs';
import { openDatabase } from '../server/db';
import { createApi } from '../server/api';
import { seedDemo } from '../server/demo';
import { awareGroup, dxLabel } from '../shared/reference';

const NOW = new Date('2026-10-08T21:30').getTime();
const db = openDatabase(':memory:');
const api = createApi(db, () => NOW);
await api.call('auth.setup', { username: 'film', displayName: 'Film', password: 'film-password', unitName: 'PICU', beds: 14 });
seedDemo(db, { now: NOW });
const call = (m: string, p: unknown = {}) => api.call(m, p) as Promise<any>;

const census = await call('census.list');
const micro = await call('micro.summary', { firstIsolateOnly: true });
const cultures = await call('culture.list');
const dash = await call('dashboard.get');
const steward = await call('stewardship.get');

// The hero patient: the in-unit admission with the richest stay (antibiotics + vasoactive + vitals).
const scored = await Promise.all(census.rows.map(async (r: any) => {
  const d = await call('admission.get', { id: r.admission.id });
  const abx = new Set(d.episodes.filter((e: any) => e.kind === 'abx').map((e: any) => e.detail)).size;
  const vaso = d.episodes.some((e: any) => e.kind === 'vaso') ? 2 : 0;
  return { d, score: abx + vaso + Math.min(4, d.vitals.length / 2) + (d.cultures.length ? 1 : 0) };
}));
const hero = scored.sort((a, b) => b.score - a.score)[0].d;
const heroVitals = await call('vitals.forAdmission', { admissionId: hero.admission.id });

const ab = micro.antibiogram;
const topOrgs = [...ab.rows].sort((a: any, b: any) => b.isolates - a.isolates).slice(0, 9);
const drugs = ab.drugs.filter((d: string) => topOrgs.filter((r: any) => r.cells[d]?.n).length >= 4).slice(0, 11);

// A real chain for the "data organises itself" scene: an admission with a positive culture that has
// susceptibility results and an antimicrobial the isolate was susceptible to.
const search = await call('patients.search', { status: 'discharged', limit: 200 });
let chain: any = null;
for (const r of search.rows) {
  const d = await call('admission.get', { id: r.admission.id });
  const c = d.cultures.find((x: any) => x.organism && x.antibiotics?.length >= 4 && x.antibiotics.some((a: any) => a.result === 'R'));
  const given = c && d.episodes.filter((e: any) => e.kind === 'abx').find((e: any) => c.antibiotics.some((a: any) => a.name === e.detail && a.result === 'S'));
  if (c && given) {
    // Three resistant results and the susceptible drug that was then given.
    const ast = [...c.antibiotics.filter((a: any) => a.result === 'R').slice(0, 3), c.antibiotics.find((a: any) => a.name === given.detail)];
    chain = {
      patient: { id: d.label, dx: dxLabel(d.admission.primaryDx), age: d.admission.ageMonths },
      culture: { date: c.collectedAt.slice(0, 10), specimen: c.specimen },
      organism: c.organism, mdr: !!c.mdr,
      ast: ast.map((a: any) => [a.name, a.result]),
      antibiotic: { drug: given.detail, group: awareGroup(given.detail), intent: given.intent },
    };
    break;
  }
}

const out = {
  chain,
  unit: { beds: census.beds, inUnit: census.rows.length },
  census: census.rows.map((r: any) => ({ bed: r.admission.bed, id: r.label, dx: dxLabel(r.admission.primaryDx), age: r.admission.ageMonths, sex: r.admission.sex, resp: r.resp.level, vaso: r.vaso.map((v: any) => v.agent), abx: r.abx.map((a: any) => a.drug), los: Math.round(r.losDays * 10) / 10 })),
  cultures: cultures.filter((c: any) => c.organism).slice(0, 80).map((c: any) => ({
    date: c.collectedAt.slice(0, 10), specimen: c.specimen, organism: c.organism, mdr: !!c.mdr,
    ast: (c.antibiotics ?? []).slice(0, 6).map((a: any) => [a.name, a.result]),
  })),
  antibiogram: {
    drugs, isolates: ab.isolatesUsed,
    rows: topOrgs.map((r: any) => ({ organism: r.organism, n: r.isolates, cells: drugs.map((d: string) => (r.cells[d]?.n ? Math.round(r.cells[d].pctS) : null)), small: drugs.map((d: string) => (r.cells[d]?.n ?? 0) < 30) })),
  },
  dashboard: {
    month: dash.month, admissions: dash.current.admissions, mortality: dash.current.mortalityPct, los: dash.current.los?.median ?? null,
    smr: dash.smr12 ? { smr: dash.smr12.smr, lo: dash.smr12.lo, hi: dash.smr12.hi } : null,
    ventilated: dash.census.ventilatedNow, vaso: dash.census.vasoNow, abx: dash.census.abxNow,
    censusSeries: dash.censusSeries.current, censusPrev: dash.censusSeries.previous,
    topDx: dash.current.topDx.slice(0, 6).map((x: any) => ({ dx: x.label, n: x.n })),
    notices: (dash.changes?.notices ?? []).slice(0, 4).map((n: any) => ({ title: n.title, detail: n.detail, direction: n.direction })),
  },
  stewardship: {
    months: steward.months.map((m: any) => ({ month: m.month, per1000: m.per1000 != null ? Math.round(m.per1000) : null, aware: m.byAware })),
    topDrugs: Object.entries(steward.months.slice(-3).reduce((acc: Record<string, number>, m: any) => { Object.entries(m.byDrug).forEach(([d, v]) => { acc[d] = (acc[d] ?? 0) + (v as number); }); return acc; }, {}))
      .sort((a: any, b: any) => b[1] - a[1]).slice(0, 6).map(([d, v]) => ({ drug: d, dot: v, group: awareGroup(d) })),
    courses: steward.courses,
  },
  patient: {
    id: hero.label, dx: dxLabel(hero.admission.primaryDx), age: hero.admission.ageMonths, sex: hero.admission.sex, bed: hero.admission.bed,
    admitAt: hero.admission.admitAt, losDays: hero.losDays,
    episodes: hero.episodes.map((e: any) => ({ kind: e.kind, detail: e.detail, start: e.startAt, end: e.endAt, group: e.kind === 'abx' ? awareGroup(e.detail) : null })),
    cultures: hero.cultures.map((c: any) => ({ date: c.collectedAt, specimen: c.specimen, organism: c.organism, mdr: c.mdr })),
    vitals: heroVitals.sets.slice().reverse().map((s: any) => ({ at: s.at, ...s.values })),
    phoenix: heroVitals.phoenix24, pim3: hero.pim3?.risk ?? null,
  },
};
writeFileSync(new URL('./data.json', import.meta.url), JSON.stringify(out, null, 1));
// The film page loads this as a script (fetch is blocked on file:// pages).
writeFileSync(new URL('./data.js', import.meta.url), `window.DATA = ${JSON.stringify(out)};
`);
console.log(`film data: ${out.census.length} beds, ${out.cultures.length} cultures, ${out.antibiogram.rows.length}×${drugs.length} antibiogram, patient ${out.patient.id} (${out.patient.dx})`);
