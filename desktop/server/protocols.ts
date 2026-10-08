// Protocol storage and evaluation inputs.
import type { DB } from './db';
import { loadDataset } from './api';
import { buildExplorer } from './explorer';
import { loadModules, loadValues } from './modules';
import { BUILT_IN_PROTOCOLS, TIME_POINTS, type Protocol, type ProtocolCase } from '../shared/protocols';
import { dxLabel } from '../shared/reference';
import { ms, nowLocal } from '../shared/time';

export function ensureBuiltInProtocols(db: DB) {
  const has = db.prepare('SELECT 1 FROM protocols WHERE id = ?');
  const t = nowLocal();
  BUILT_IN_PROTOCOLS.forEach(p => {
    if (has.get(p.id)) return;
    db.prepare('INSERT INTO protocols(id, name, description, eligibility, rules, active, built_in, created_at, updated_at) VALUES (?,?,?,?,?,1,1,?,?)')
      .run(p.id, p.name, p.description, JSON.stringify(p.eligibility), JSON.stringify(p.rules), t, t);
  });
}

export function loadProtocols(db: DB, includeInactive = false): Protocol[] {
  return (db.prepare(`SELECT * FROM protocols ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY built_in DESC, rowid`).all() as any[]).map(r => ({
    id: r.id, name: r.name, description: r.description, eligibility: JSON.parse(r.eligibility), rules: JSON.parse(r.rules), active: !!r.active, builtIn: !!r.built_in,
  }));
}

/** Time points: fixed clinical events plus every date/datetime module field (e.g. sepsis time-zero). */
export function timePoints(db: DB): Record<string, string> {
  const out: Record<string, string> = { ...TIME_POINTS };
  loadModules(db, { includeInactive: true }).forEach(m => m.params.filter(p => p.type === 'datetime' || p.type === 'date').forEach(p => { out[`${m.id}.${p.key}`] = `${m.label}: ${p.label}`; }));
  return out;
}

export function buildProtocolCases(db: DB, now: number): { cases: ProtocolCase[]; fields: ReturnType<typeof buildExplorer>['fields'] } {
  const { fields, rows } = buildExplorer(db, now);
  const ds = loadDataset(db);
  const values = loadValues(db);
  const pseudo = (pid: string) => `P-${pid.replace(/-/g, '').slice(0, 5).toUpperCase()}`;
  const byId = new Map(ds.admissions.map(a => [a.id, a]));
  const cases = rows.map(row => {
    const a = byId.get(row._id as string)!;
    const eps = ds.episodes.filter(e => e.admissionId === a.id);
    const first = (list: { startAt?: string; at?: string }[]) => { const t = list.map(x => ms((x.startAt ?? x.at)!)).sort((p, q) => p - q)[0]; return t ?? null; };
    const times: Record<string, number | null> = {
      admission: ms(a.admitAt),
      first_abx: first(eps.filter(e => e.kind === 'abx')),
      first_vaso: first(eps.filter(e => e.kind === 'vaso')),
      first_mv: first(eps.filter(e => e.kind === 'resp' && e.detail === 'MV')),
      first_culture_sent: first(ds.events.filter(e => e.admissionId === a.id && e.type === 'culture_sent')),
    };
    (values[a.id] ?? []).forEach(v => { if (typeof v.value === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(v.value)) times[v.paramId] = ms(v.value); });
    return { id: a.id, label: `${a.bed ? `Bed ${a.bed} · ` : ''}${pseudo(a.patientId)} · ${dxLabel(a.primaryDx)}`, admitAt: a.admitAt, row, times };
  });
  return { cases, fields };
}
