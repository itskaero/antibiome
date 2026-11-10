// SBAR shift handover for one bed, assembled from what is already charted. Plain text so it can be
// shared (WhatsApp, SMS) — the shared text never contains a name or MRN, only the bed and age.
import { PEWS_ACTION, type PewsStatus } from './pews';
import type { DoseDue } from './doses';
import { RESP_LABEL, dxLabel, type RespLevel } from './reference';
import { fmtAge } from './time';
import { VITALS, type VitalCode } from './vitals';

export interface HandoverInput {
  admission: { id: string; bed: string | null; ageMonths: number; sex: string; weightKg: number | null; primaryDx: string; source: string; chronicCondition: boolean };
  losDays: number;
  resp: { level: RespLevel; since: string | null };
  vaso: { agent: string; since: string }[];
  abx: { drug: string; since: string; intent: string | null; dose?: string | null; intervalHours?: number | null; due?: DoseDue }[];
  pews?: PewsStatus;
  vitals: { code: string; min: number; max: number; last: number }[];
  labs: { code: string; value: number; flag: string | null }[];
  fluids: { in: number; out: number; balance: number; urineRate: number | null; oliguria: boolean } | null;
  shiftFluids?: { in: number; out: number } | null;
  events: { at: string; label: string; type: string; note?: string | null }[];
  culturesSent: number; culturesResulted: number;
  monitor?: { desats: number; lowestSpo2: number | null; disconnects: number; outside: number } | null;
}
export interface Handover { admissionId: string; bed: string | null; s: string[]; b: string[]; a: string[]; r: string[]; todo: string | null; text: string }

const DAY = 86_400_000;
const hhmm = (at: string) => at.slice(11, 16);
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n))}`;

export function buildHandover(x: HandoverInput, now: number): Handover {
  const a = x.admission;
  const who = `Bed ${a.bed ?? '—'} · ${fmtAge(a.ageMonths)} ${a.sex}${a.weightKg ? ` · ${a.weightKg} kg` : ''}`;
  const s: string[] = [
    `${who} · day ${Math.floor(x.losDays) + 1}`,
    `${dxLabel(a.primaryDx)}`,
    `${RESP_LABEL[x.resp.level]}${x.vaso.length ? ` · on ${x.vaso.map(v => v.agent).join(', ')}` : ''}`,
  ];
  const b: string[] = [`Admitted from ${a.source}${a.chronicCondition ? '; chronic condition' : ''}`];
  const notable = x.events.filter(e => e.type === 'procedure' || e.type === 'complication' || e.type === 'deterioration');
  if (notable.length) b.push(`Last 24 h: ${notable.map(e => `${e.label} (${hhmm(e.at)})`).join('; ')}`);

  const as: string[] = [];
  if (x.pews?.score != null) as.push(`PEWS ${x.pews.score}${x.pews.trend === 'up' ? ' ↑' : x.pews.trend === 'down' ? ' ↓' : ''} at ${hhmm(x.pews.at!)} — ${PEWS_ACTION[x.pews.level!].label.toLowerCase()}`);
  const vit = x.vitals.map(v => { const d = VITALS[v.code as VitalCode]; return `${d?.short ?? v.code} ${v.min === v.max ? v.last : `${v.min}–${v.max}`}`; });
  if (vit.length) as.push(`24 h: ${vit.join(', ')}`);
  const flagged = x.labs.filter(l => l.flag);
  if (flagged.length) as.push(`Labs: ${flagged.map(l => `${VITALS[l.code as VitalCode]?.short ?? l.code} ${l.value} ${l.flag}`).join(', ')}`);
  if (x.shiftFluids && (x.shiftFluids.in || x.shiftFluids.out)) as.push(`This shift: in ${Math.round(x.shiftFluids.in)} / out ${Math.round(x.shiftFluids.out)} mL (${signed(x.shiftFluids.in - x.shiftFluids.out)})`);
  if (x.fluids) as.push(`24 h balance ${signed(x.fluids.balance)} mL${x.fluids.urineRate != null ? ` · urine ${x.fluids.urineRate} mL/kg/h${x.fluids.oliguria ? ' (low)' : ''}` : ''}`);
  if (x.monitor && (x.monitor.desats || x.monitor.disconnects || x.monitor.outside)) {
    const m = [x.monitor.desats && `${x.monitor.desats} desaturation${x.monitor.desats > 1 ? 's' : ''}${x.monitor.lowestSpo2 != null ? ` (lowest ${x.monitor.lowestSpo2}%)` : ''}`,
      x.monitor.outside && `${x.monitor.outside} other alarm${x.monitor.outside > 1 ? 's' : ''}`, x.monitor.disconnects && `${x.monitor.disconnects} disconnection${x.monitor.disconnects > 1 ? 's' : ''}`].filter(Boolean);
    as.push(`Monitor 12 h: ${m.join(', ')}`);
  }
  if (x.abx.length) as.push(`Antimicrobials: ${x.abx.map(d => `${d.drug}${d.dose ? ` ${d.dose}` : ''} day ${Math.floor((now - new Date(d.since).getTime()) / DAY) + 1}${d.due?.nextDue ? `, next ${hhmm(d.due.nextDue)}` : ''}`).join('; ')}`);

  const r: string[] = [];
  for (const d of x.abx) if (d.due?.overdueMin) r.push(`${d.drug} dose overdue by ${d.due.overdueMin} min`);
  if (x.pews?.overdue) r.push(x.pews.score == null ? 'No PEWS charted — score now' : `PEWS due (last ${x.pews.hoursSince} h ago)`);
  if (x.pews?.level === 'doctor' || x.pews?.level === 'urgent') r.push(PEWS_ACTION[x.pews.level].action);
  if (x.culturesSent > x.culturesResulted) r.push(`${x.culturesSent - x.culturesResulted} culture result${x.culturesSent - x.culturesResulted > 1 ? 's' : ''} awaited`);
  if (!a.weightKg) r.push('Record a weight');
  if (x.fluids?.oliguria) r.push('Urine output low — review fluids');
  const todoEv = [...x.events].reverse().find(e => e.type === 'note' && e.label.startsWith('Handover'));
  const todo = todoEv ? (todoEv.note ?? todoEv.label.replace(/^Handover:?\s*/, '')) : null;
  if (todo) r.push(`To do: ${todo}`);

  const text = [`*${who}*`, `S: ${s.slice(1).join('; ')}`, `B: ${b.join('; ')}`, `A: ${as.join('; ') || '—'}`, `R: ${r.join('; ') || 'Continue current plan'}`].join('\n');
  return { admissionId: a.id, bed: a.bed, s, b, a: as, r, todo, text };
}
