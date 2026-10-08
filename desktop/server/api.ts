// ═══════════════════════════════════════════════════════════
//  Application API — runs in the Electron main process only.
//  Every call is authorised by role, and every mutation writes an
//  audit_log row in the same transaction. The renderer never touches SQL.
// ═══════════════════════════════════════════════════════════
import { randomUUID } from 'node:crypto';
import { type DB, getSetting, setSetting, tx } from './db';
import { hashPassword, PASSWORD_MIN, verifyPassword } from './auth';
import type { Admission, ClinicalEvent, Culture, Dataset, Episode, Role, User } from '../shared/types';
import {
  ABX_INTENTS, ADMISSION_SOURCES, DISPOSITIONS, DX_BY_CODE, RESP_LEVELS, SPECIMEN_TYPES, VASOACTIVES, dxLabel,
  type RespLevel,
} from '../shared/reference';
import { detectChanges, losDays, monthSummary, monthlySeries, dailyCensus, presentAt, projectMonth, peakSupport } from '../shared/analytics';
import { runQualityChecks, QUALITY_RULES } from '../shared/quality';
import { buildAntibiogram } from '../shared/antibiogram';
import { isMDR, relevantResistantClasses, MDR_DEFINITION_VERSION } from '../shared/mdr';
import { DAY_MS, ms, nowLocal, shiftMonth, toLocal } from '../shared/time';

export class ApiError extends Error {}
const fail = (msg: string): never => { throw new ApiError(msg); };

export interface Session { user: User | null; lastActivity: number }
export const IDLE_LOCK_MS = 15 * 60_000;

type Handler = (p: any, ctx: { db: DB; session: Session; now: () => number }) => unknown;
interface Route { roles: Role[] | 'public'; fn: Handler }

const ALL: Role[] = ['admin', 'clinician', 'viewer', 'researcher'];
const CLINICAL: Role[] = ['admin', 'clinician'];
const NON_RESEARCH: Role[] = ['admin', 'clinician', 'viewer'];
const canSeeIdentifiers = (s: Session) => !!s.user && CLINICAL.includes(s.user.role);

// ── Helpers ──────────────────────────────────────────────────

function audit(db: DB, s: Session, action: string, entity: string, entityId: string | null, summary: string) {
  db.prepare('INSERT INTO audit_log(at, user_id, username, action, entity, entity_id, summary) VALUES (?,?,?,?,?,?,?)')
    .run(nowLocal(), s.user?.id ?? null, s.user?.displayName ?? 'system', action, entity, entityId, summary);
}

const isLocalDT = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(v);
const reqDT = (v: unknown, name: string) => (isLocalDT(v) ? (v as string) : fail(`${name} must be a date/time`));
const pseudo = (patientId: string) => `P-${patientId.replace(/-/g, '').slice(0, 5).toUpperCase()}`;

function rowToAdmission(r: any, dx: { code: string; role: string }[]): Admission {
  return {
    id: r.id, patientId: r.patient_id, bed: r.bed, admitAt: r.admit_at, ageMonths: r.age_months, sex: r.sex,
    weightKg: r.weight_kg, source: r.source, admissionType: r.admission_type,
    primaryDx: dx.find(d => d.role === 'primary')?.code ?? 'OTHER',
    secondaryDx: dx.filter(d => d.role === 'secondary').map(d => d.code),
    chronicCondition: !!r.chronic_condition, malnutrition: !!r.malnutrition, arrivalSupport: r.arrival_support,
    shockOnArrival: !!r.shock_on_arrival, comaOnArrival: !!r.coma_on_arrival,
    dischargeAt: r.discharge_at, disposition: r.disposition, notes: r.notes,
  };
}
const rowToEpisode = (r: any): Episode => ({
  id: r.id, admissionId: r.admission_id, kind: r.kind, detail: r.detail, intent: r.intent,
  startAt: r.start_at, endAt: r.end_at, endReason: r.end_reason,
});
const rowToEvent = (r: any): ClinicalEvent => ({ id: r.id, admissionId: r.admission_id, type: r.type, label: r.label, at: r.at, note: r.note });

function loadCultures(db: DB, where = '1=1', args: any[] = []): (Culture & { legacyLabel?: string | null; createdAt: string })[] {
  const rows = db.prepare(`SELECT * FROM cultures WHERE deleted_at IS NULL AND ${where} ORDER BY collected_at DESC`).all(...args) as any[];
  const res = db.prepare('SELECT culture_id, drug, result FROM susceptibility_results').all() as any[];
  const byCulture: Record<string, { name: string; result: 'S' | 'I' | 'R' }[]> = {};
  res.forEach(r => (byCulture[r.culture_id] ??= []).push({ name: r.drug, result: r.result }));
  return rows.map(r => ({
    id: r.id, admissionId: r.admission_id, patientId: r.patient_id, unit: r.unit, collectedAt: r.collected_at,
    specimen: r.specimen, organism: r.organism, ageGroup: r.age_group, antibiotics: byCulture[r.id] ?? [],
    source: r.source, legacyLabel: r.legacy_label, createdAt: r.created_at,
  }));
}

/** The de-identified dataset every analytic is computed from. */
export function loadDataset(db: DB): Dataset {
  const dxRows = db.prepare('SELECT admission_id, code, role FROM diagnoses').all() as any[];
  const dxBy: Record<string, { code: string; role: string }[]> = {};
  dxRows.forEach(d => (dxBy[d.admission_id] ??= []).push(d));
  const admissions = (db.prepare(`SELECT a.*, p.sex FROM admissions a JOIN patients p ON p.id = a.patient_id WHERE a.deleted_at IS NULL`).all() as any[])
    .map(r => rowToAdmission(r, dxBy[r.id] ?? []));
  const episodes = (db.prepare('SELECT * FROM episodes WHERE deleted_at IS NULL').all() as any[]).map(rowToEpisode);
  const events = (db.prepare('SELECT * FROM clinical_events WHERE deleted_at IS NULL').all() as any[]).map(rowToEvent);
  return { admissions, episodes, events, cultures: loadCultures(db), beds: Number(getSetting(db, 'beds', '12')) };
}

function getAdmissionRow(db: DB, id: string) {
  return (db.prepare('SELECT a.*, p.sex FROM admissions a JOIN patients p ON p.id = a.patient_id WHERE a.id = ? AND a.deleted_at IS NULL').get(id) as any) ?? fail('Admission not found');
}
function admissionLabel(db: DB, id: string) {
  const r = getAdmissionRow(db, id);
  const dx = (db.prepare("SELECT code FROM diagnoses WHERE admission_id = ? AND role = 'primary'").get(id) as any)?.code;
  return `${r.bed ? `Bed ${r.bed} · ` : ''}${pseudo(r.patient_id)} · ${dxLabel(dx)}`;
}
function openEpisodes(db: DB, admissionId: string, kind?: string): Episode[] {
  const rows = db.prepare(`SELECT * FROM episodes WHERE admission_id = ? AND end_at IS NULL AND deleted_at IS NULL ${kind ? 'AND kind = ?' : ''} ORDER BY start_at`)
    .all(...(kind ? [admissionId, kind] : [admissionId])) as any[];
  return rows.map(rowToEpisode);
}
function closeEpisode(db: DB, id: string, at: string, reason: string | null) {
  const ep = db.prepare('SELECT * FROM episodes WHERE id = ?').get(id) as any ?? fail('Episode not found');
  if (ms(at) < ms(ep.start_at)) fail('Stop time is before the start time');
  db.prepare('UPDATE episodes SET end_at = ?, end_reason = ? WHERE id = ?').run(at, reason, id);
}
function insertEpisode(db: DB, s: Session, e: Omit<Episode, 'id' | 'endAt' | 'endReason'>) {
  const id = randomUUID();
  db.prepare('INSERT INTO episodes(id, admission_id, kind, detail, intent, start_at, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, e.admissionId, e.kind, e.detail, e.intent, e.startAt, s.user?.id ?? null, nowLocal());
  return id;
}

/** Set respiratory support level: closes the open resp episode and opens the new one (none for room air). */
function setResp(db: DB, s: Session, admissionId: string, level: RespLevel, at: string) {
  if (!RESP_LEVELS.includes(level)) fail('Unknown support level');
  const open = openEpisodes(db, admissionId, 'resp');
  if (open.length === 1 && open[0].detail === level) return false;
  if (!open.length && level === 'RA') return false;
  const prev = open.map(e => e.detail).join('/') || 'RA';
  open.forEach(e => closeEpisode(db, e.id, at, prev === 'MV' && level !== 'MV' ? 'extubated' : 'changed'));
  if (level !== 'RA') insertEpisode(db, s, { admissionId, kind: 'resp', detail: level, intent: null, startAt: at });
  audit(db, s, 'update', 'respiratory', admissionId, `${admissionLabel(db, admissionId)}: ${prev} → ${level}`);
  return true;
}

function toggleDrug(db: DB, s: Session, admissionId: string, kind: 'vaso' | 'abx', drug: string, on: boolean, at: string, intent: string | null = null) {
  const open = openEpisodes(db, admissionId, kind).filter(e => e.detail === drug);
  if (on && !open.length) {
    insertEpisode(db, s, { admissionId, kind, detail: drug, intent: kind === 'abx' ? ((intent as any) ?? 'empiric') : null, startAt: at });
    audit(db, s, 'start', kind === 'abx' ? 'antimicrobial' : 'vasoactive', admissionId, `${admissionLabel(db, admissionId)}: started ${drug}${intent ? ` (${intent})` : ''}`);
    return true;
  }
  if (!on && open.length) {
    open.forEach(e => closeEpisode(db, e.id, at, 'stopped'));
    audit(db, s, 'stop', kind === 'abx' ? 'antimicrobial' : 'vasoactive', admissionId, `${admissionLabel(db, admissionId)}: stopped ${drug}`);
    return true;
  }
  return false;
}

function censusRows(db: DB, s: Session, now: number) {
  const ds = loadDataset(db);
  const issues = runQualityChecks(ds, now);
  const ids = canSeeIdentifiers(s)
    ? Object.fromEntries((db.prepare('SELECT * FROM patient_identifiers').all() as any[]).map(r => [r.patient_id, r]))
    : {};
  return presentAt(ds, now).sort((a, b) => (a.bed ?? 'zz').localeCompare(b.bed ?? 'zz', undefined, { numeric: true })).map(a => {
    const eps = ds.episodes.filter(e => e.admissionId === a.id && !e.endAt);
    const resp = eps.find(e => e.kind === 'resp');
    const sentEvents = ds.events.filter(e => e.admissionId === a.id && e.type === 'culture_sent');
    return {
      admission: a,
      label: pseudo(a.patientId),
      name: ids[a.patientId]?.name ?? null,
      mrn: ids[a.patientId]?.mrn ?? null,
      losDays: losDays(a, now),
      resp: resp ? { level: resp.detail as RespLevel, since: resp.startAt, id: resp.id } : { level: 'RA' as RespLevel, since: null, id: null },
      vaso: eps.filter(e => e.kind === 'vaso').map(e => ({ id: e.id, agent: e.detail, since: e.startAt })),
      abx: eps.filter(e => e.kind === 'abx').map(e => ({ id: e.id, drug: e.detail, intent: e.intent, since: e.startAt })),
      issues: issues.filter(i => i.admissionId === a.id).length,
      culturesSent: sentEvents.length,
      culturesResulted: ds.cultures.filter(c => c.admissionId === a.id).length,
    };
  });
}

function validateAdmissionInput(p: any) {
  if (!p || typeof p !== 'object') fail('Missing admission data');
  if (!p.mrn || String(p.mrn).trim().length < 2) fail('MRN is required');
  if (!['M', 'F'].includes(p.sex)) fail('Sex is required');
  reqDT(p.admitAt, 'Admission time');
  if (ms(p.admitAt) > Date.now() + 10 * 60_000) fail('Admission time is in the future');
  const age = Number(p.ageMonths);
  if (!Number.isFinite(age) || age < 0 || age > 216) fail('Age must be between 0 and 18 years');
  if (p.weightKg != null && p.weightKg !== '' && (!Number.isFinite(Number(p.weightKg)) || Number(p.weightKg) <= 0 || Number(p.weightKg) > 200)) fail('Weight looks impossible');
  if (!ADMISSION_SOURCES.includes(p.source)) fail('Admission source is required');
  if (!p.primaryDx || !DX_BY_CODE[p.primaryDx]) fail('Primary diagnosis is required');
  if (!RESP_LEVELS.includes(p.arrivalSupport ?? 'RA')) fail('Unknown support level');
}

// ── Routes ───────────────────────────────────────────────────

export const routes: Record<string, Route> = {
  // Auth & setup
  'auth.status': { roles: 'public', fn: (_p, { db, session }) => ({
    needsSetup: (db.prepare('SELECT COUNT(*) n FROM users').get() as any).n === 0,
    user: session.user,
    unitName: getSetting(db, 'unitName', 'PICU'),
  }) },
  'auth.setup': { roles: 'public', fn: (p, { db, session }) => {
    if ((db.prepare('SELECT COUNT(*) n FROM users').get() as any).n > 0) fail('Already set up');
    if (!p.username || !p.displayName) fail('Name and username are required');
    if (!p.password || p.password.length < PASSWORD_MIN) fail(`Password must be at least ${PASSWORD_MIN} characters`);
    const { hash, salt } = hashPassword(p.password);
    tx(db, () => {
      const r = db.prepare('INSERT INTO users(username, display_name, role, pw_hash, pw_salt, created_at) VALUES (?,?,?,?,?,?)')
        .run(p.username.trim(), p.displayName.trim(), 'admin', hash, salt, nowLocal());
      setSetting(db, 'unitName', (p.unitName || 'PICU').trim());
      setSetting(db, 'beds', String(Math.max(1, Math.min(200, Number(p.beds) || 12))));
      session.user = { id: Number(r.lastInsertRowid), username: p.username.trim(), displayName: p.displayName.trim(), role: 'admin', active: true };
      audit(db, session, 'setup', 'system', null, `Unit "${p.unitName || 'PICU'}" created with ${p.beds || 12} beds`);
    });
    return session.user;
  } },
  'auth.login': { roles: 'public', fn: (p, { db, session }) => {
    const r = db.prepare('SELECT * FROM users WHERE username = ?').get(String(p.username ?? '').trim()) as any;
    if (!r || !r.active || !verifyPassword(String(p.password ?? ''), r.pw_hash, r.pw_salt)) {
      audit(db, { user: null, lastActivity: 0 }, 'login-failed', 'user', null, `Failed sign-in for "${String(p.username ?? '').slice(0, 40)}"`);
      fail('Incorrect username or password');
    }
    session.user = { id: r.id, username: r.username, displayName: r.display_name, role: r.role, active: !!r.active };
    audit(db, session, 'login', 'user', String(r.id), `${r.display_name} signed in`);
    return session.user;
  } },
  'auth.logout': { roles: ALL, fn: (_p, { db, session }) => { audit(db, session, 'logout', 'user', String(session.user!.id), `${session.user!.displayName} signed out`); session.user = null; return true; } },
  'auth.changePassword': { roles: ALL, fn: (p, { db, session }) => {
    const r = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user!.id) as any;
    if (!verifyPassword(String(p.current ?? ''), r.pw_hash, r.pw_salt)) fail('Current password is incorrect');
    if (!p.next || p.next.length < PASSWORD_MIN) fail(`Password must be at least ${PASSWORD_MIN} characters`);
    const { hash, salt } = hashPassword(p.next);
    db.prepare('UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?').run(hash, salt, r.id);
    audit(db, session, 'update', 'user', String(r.id), `${r.display_name} changed their password`);
    return true;
  } },

  // Census & admissions
  'census.list': { roles: NON_RESEARCH, fn: (_p, { db, session, now }) => ({
    rows: censusRows(db, session, now()), beds: Number(getSetting(db, 'beds', '12')), showIdentifiers: canSeeIdentifiers(session),
  }) },
  'patient.lookup': { roles: CLINICAL, fn: (p, { db }) => {
    const r = db.prepare('SELECT i.*, p.sex FROM patient_identifiers i JOIN patients p ON p.id = i.patient_id WHERE i.mrn = ?').get(String(p.mrn ?? '').trim()) as any;
    if (!r) return null;
    const last = db.prepare('SELECT admit_at, discharge_at, age_months, weight_kg FROM admissions WHERE patient_id = ? AND deleted_at IS NULL ORDER BY admit_at DESC LIMIT 1').get(r.patient_id) as any;
    const open = db.prepare('SELECT id FROM admissions WHERE patient_id = ? AND discharge_at IS NULL AND deleted_at IS NULL').get(r.patient_id) as any;
    return { patientId: r.patient_id, name: r.name, dob: r.dob, sex: r.sex, lastAdmission: last ?? null, openAdmissionId: open?.id ?? null };
  } },
  'admission.create': { roles: CLINICAL, fn: (p, { db, session }) => {
    validateAdmissionInput(p);
    return tx(db, () => {
      const mrn = String(p.mrn).trim();
      let patient = db.prepare('SELECT patient_id FROM patient_identifiers WHERE mrn = ?').get(mrn) as any;
      let patientId: string;
      if (patient) {
        patientId = patient.patient_id;
        if (db.prepare('SELECT 1 FROM admissions WHERE patient_id = ? AND discharge_at IS NULL AND deleted_at IS NULL').get(patientId)) fail('This patient already has an open admission');
        if (p.name) db.prepare('UPDATE patient_identifiers SET name = ? WHERE patient_id = ?').run(String(p.name).trim(), patientId);
      } else {
        patientId = randomUUID();
        db.prepare('INSERT INTO patients(id, sex, created_at) VALUES (?,?,?)').run(patientId, p.sex, nowLocal());
        db.prepare('INSERT INTO patient_identifiers(patient_id, mrn, name, dob) VALUES (?,?,?,?)').run(patientId, mrn, p.name ? String(p.name).trim() : null, p.dob || null);
      }
      const id = randomUUID();
      const t = nowLocal();
      const arrival = (p.arrivalSupport ?? 'RA') as RespLevel;
      db.prepare(`INSERT INTO admissions(id, patient_id, bed, admit_at, age_months, weight_kg, source, admission_type, chronic_condition,
        malnutrition, arrival_support, shock_on_arrival, coma_on_arrival, notes, created_by, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, patientId, p.bed ? String(p.bed).trim() : null, p.admitAt, Number(p.ageMonths), p.weightKg ? Number(p.weightKg) : null, p.source,
        p.elective ? 'elective' : 'emergency',
        p.chronicCondition ? 1 : 0, p.malnutrition ? 1 : 0, arrival, p.shockOnArrival ? 1 : 0, p.comaOnArrival ? 1 : 0,
        p.notes ? String(p.notes).slice(0, 2000) : null, session.user!.id, t, t);
      db.prepare("INSERT INTO diagnoses(admission_id, code, role) VALUES (?,?,'primary')").run(id, p.primaryDx);
      [...new Set<string>(p.secondaryDx ?? [])].filter(c => DX_BY_CODE[c] && c !== p.primaryDx).slice(0, 5)
        .forEach(c => db.prepare("INSERT INTO diagnoses(admission_id, code, role) VALUES (?,?,'secondary')").run(id, c));
      if (arrival !== 'RA') insertEpisode(db, session, { admissionId: id, kind: 'resp', detail: arrival, intent: null, startAt: p.admitAt });
      (p.vasoactives ?? []).filter((v: string) => VASOACTIVES.includes(v))
        .forEach((v: string) => insertEpisode(db, session, { admissionId: id, kind: 'vaso', detail: v, intent: null, startAt: p.admitAt }));
      (p.antimicrobials ?? []).forEach((d: string) => insertEpisode(db, session, { admissionId: id, kind: 'abx', detail: d, intent: 'empiric', startAt: p.admitAt }));
      audit(db, session, 'admit', 'admission', id, `Admitted ${admissionLabel(db, id)} from ${p.source}`);
      return { id };
    });
  } },
  'admission.get': { roles: NON_RESEARCH, fn: (p, { db, session, now }) => {
    const r = getAdmissionRow(db, p.id);
    const dx = db.prepare('SELECT code, role FROM diagnoses WHERE admission_id = ?').all(p.id) as any[];
    const admission = rowToAdmission(r, dx);
    const ident = canSeeIdentifiers(session) ? db.prepare('SELECT mrn, name, dob FROM patient_identifiers WHERE patient_id = ?').get(r.patient_id) as any : null;
    if (ident) audit(db, session, 'view', 'patient', r.patient_id, `Opened record ${admissionLabel(db, p.id)}`);
    const episodes = (db.prepare('SELECT * FROM episodes WHERE admission_id = ? AND deleted_at IS NULL ORDER BY start_at').all(p.id) as any[]).map(rowToEpisode);
    const events = (db.prepare('SELECT * FROM clinical_events WHERE admission_id = ? AND deleted_at IS NULL ORDER BY at').all(p.id) as any[]).map(rowToEvent);
    const cultures = loadCultures(db, 'admission_id = ?', [p.id]).map(c => ({ ...c, mdr: isMDR(c) }));
    const ds = loadDataset(db);
    const previous = (db.prepare('SELECT admit_at, discharge_at FROM admissions WHERE patient_id = ? AND id != ? AND deleted_at IS NULL ORDER BY admit_at DESC').all(r.patient_id, p.id) as any[]);
    return {
      admission, label: pseudo(r.patient_id), identifiers: ident ?? null, episodes, events, cultures,
      losDays: losDays(admission, now()), peakSupport: peakSupport(admission, episodes),
      issues: runQualityChecks(ds, now()).filter(i => i.admissionId === p.id),
      previousAdmissions: previous,
    };
  } },
  'admission.update': { roles: CLINICAL, fn: (p, { db, session }) => {
    const r = getAdmissionRow(db, p.id);
    const fields: Record<string, unknown> = {};
    if ('bed' in p) fields.bed = p.bed ? String(p.bed).trim() : null;
    if ('weightKg' in p) fields.weight_kg = p.weightKg ? Number(p.weightKg) : null;
    if ('notes' in p) fields.notes = p.notes ? String(p.notes).slice(0, 2000) : null;
    if ('admitAt' in p) { reqDT(p.admitAt, 'Admission time'); fields.admit_at = p.admitAt; }
    if ('ageMonths' in p) fields.age_months = Number(p.ageMonths);
    return tx(db, () => {
      const keys = Object.keys(fields);
      if (keys.length) db.prepare(`UPDATE admissions SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...(Object.values(fields) as any[]), nowLocal(), p.id);
      if (p.primaryDx) {
        if (!DX_BY_CODE[p.primaryDx]) fail('Unknown diagnosis');
        db.prepare("UPDATE diagnoses SET code = ? WHERE admission_id = ? AND role = 'primary'").run(p.primaryDx, p.id);
      }
      if (Array.isArray(p.secondaryDx)) {
        db.prepare("DELETE FROM diagnoses WHERE admission_id = ? AND role = 'secondary'").run(p.id);
        [...new Set<string>(p.secondaryDx)].filter(c => DX_BY_CODE[c]).slice(0, 5)
          .forEach(c => db.prepare("INSERT INTO diagnoses(admission_id, code, role) VALUES (?,?,'secondary')").run(p.id, c));
      }
      audit(db, session, 'update', 'admission', p.id, `Edited ${admissionLabel(db, p.id)} (${[...keys, p.primaryDx ? 'diagnosis' : '', p.secondaryDx ? 'secondary dx' : ''].filter(Boolean).join(', ')})`);
      return { id: r.id };
    });
  } },
  'admission.discharge': { roles: CLINICAL, fn: (p, { db, session }) => {
    const r = getAdmissionRow(db, p.id);
    if (r.discharge_at) fail('Already discharged');
    const at = reqDT(p.at, 'Discharge time');
    if (ms(at) < ms(r.admit_at)) fail('Discharge is before admission');
    if (!DISPOSITIONS.includes(p.disposition)) fail('Choose an outcome');
    return tx(db, () => {
      if (p.finalPrimaryDx && DX_BY_CODE[p.finalPrimaryDx]) db.prepare("UPDATE diagnoses SET code = ? WHERE admission_id = ? AND role = 'primary'").run(p.finalPrimaryDx, p.id);
      // Close every open episode at the discharge time (death closes with reason 'death').
      openEpisodes(db, p.id).forEach(e => closeEpisode(db, e.id, ms(at) < ms(e.startAt) ? e.startAt : at, p.disposition === 'Died' ? 'death' : 'discharge'));
      db.prepare('UPDATE admissions SET discharge_at = ?, disposition = ?, updated_at = ? WHERE id = ?').run(at, p.disposition, nowLocal(), p.id);
      audit(db, session, 'discharge', 'admission', p.id, `${admissionLabel(db, p.id)} → ${p.disposition}`);
      return true;
    });
  } },
  'admission.reopen': { roles: ['admin'], fn: (p, { db, session }) => {
    getAdmissionRow(db, p.id);
    db.prepare('UPDATE admissions SET discharge_at = NULL, disposition = NULL, updated_at = ? WHERE id = ?').run(nowLocal(), p.id);
    audit(db, session, 'reopen', 'admission', p.id, `Re-opened ${admissionLabel(db, p.id)}`);
    return true;
  } },
  'admission.delete': { roles: ['admin'], fn: (p, { db, session }) => {
    if (!p.reason || String(p.reason).trim().length < 4) fail('A reason is required');
    const label = admissionLabel(db, p.id);
    db.prepare('UPDATE admissions SET deleted_at = ? WHERE id = ?').run(nowLocal(), p.id);
    audit(db, session, 'delete', 'admission', p.id, `Deleted ${label}: ${String(p.reason).slice(0, 200)}`);
    return true;
  } },

  // Episodes & events
  'resp.set': { roles: CLINICAL, fn: (p, { db, session }) => tx(db, () => setResp(db, session, p.admissionId, p.level, reqDT(p.at ?? nowLocal(), 'Time'))) },
  'drug.toggle': { roles: CLINICAL, fn: (p, { db, session }) => {
    if (!['vaso', 'abx'].includes(p.kind)) fail('Unknown therapy type');
    if (p.kind === 'vaso' && !VASOACTIVES.includes(p.drug)) fail('Unknown vasoactive');
    if (p.intent && !ABX_INTENTS.includes(p.intent)) fail('Unknown intent');
    getAdmissionRow(db, p.admissionId);
    return tx(db, () => toggleDrug(db, session, p.admissionId, p.kind, String(p.drug), !!p.on, reqDT(p.at ?? nowLocal(), 'Time'), p.intent ?? null));
  } },
  'episode.update': { roles: CLINICAL, fn: (p, { db, session }) => {
    const ep = db.prepare('SELECT * FROM episodes WHERE id = ? AND deleted_at IS NULL').get(p.id) as any ?? fail('Episode not found');
    const start = p.startAt ? reqDT(p.startAt, 'Start') : ep.start_at;
    const end = p.endAt === null ? null : p.endAt ? reqDT(p.endAt, 'End') : ep.end_at;
    if (end && ms(end) < ms(start)) fail('End is before start');
    const intent = p.intent && ABX_INTENTS.includes(p.intent) ? p.intent : ep.intent;
    db.prepare('UPDATE episodes SET start_at = ?, end_at = ?, intent = ? WHERE id = ?').run(start, end, intent, p.id);
    audit(db, session, 'update', 'episode', p.id, `${admissionLabel(db, ep.admission_id)}: corrected ${ep.detail} times`);
    return true;
  } },
  'episode.delete': { roles: CLINICAL, fn: (p, { db, session }) => {
    const ep = db.prepare('SELECT * FROM episodes WHERE id = ?').get(p.id) as any ?? fail('Episode not found');
    db.prepare('UPDATE episodes SET deleted_at = ? WHERE id = ?').run(nowLocal(), p.id);
    audit(db, session, 'delete', 'episode', p.id, `${admissionLabel(db, ep.admission_id)}: removed ${ep.detail} entry`);
    return true;
  } },
  'event.add': { roles: CLINICAL, fn: (p, { db, session }) => {
    getAdmissionRow(db, p.admissionId);
    if (!['procedure', 'complication', 'culture_sent', 'note', 'deterioration'].includes(p.type)) fail('Unknown event type');
    if (!p.label) fail('Event label is required');
    const id = randomUUID();
    db.prepare('INSERT INTO clinical_events(id, admission_id, type, label, at, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, p.admissionId, p.type, String(p.label).slice(0, 120), reqDT(p.at ?? nowLocal(), 'Time'), p.note ? String(p.note).slice(0, 1000) : null, session.user!.id, nowLocal());
    audit(db, session, 'add', p.type, p.admissionId, `${admissionLabel(db, p.admissionId)}: ${p.label}`);
    return { id };
  } },
  'event.delete': { roles: CLINICAL, fn: (p, { db, session }) => {
    const ev = db.prepare('SELECT * FROM clinical_events WHERE id = ?').get(p.id) as any ?? fail('Event not found');
    db.prepare('UPDATE clinical_events SET deleted_at = ? WHERE id = ?').run(nowLocal(), p.id);
    audit(db, session, 'delete', ev.type, ev.admission_id, `${admissionLabel(db, ev.admission_id)}: removed "${ev.label}"`);
    return true;
  } },

  /** Daily reconcile: one call applies the whole unit grid. Each row: { admissionId, resp, vaso[], abx[] }. */
  'reconcile.apply': { roles: CLINICAL, fn: (p, { db, session }) => {
    const at = reqDT(p.at ?? nowLocal(), 'Time');
    return tx(db, () => {
      let changes = 0;
      for (const row of p.rows ?? []) {
        if (row.resp && setResp(db, session, row.admissionId, row.resp, at)) changes++;
        for (const kind of ['vaso', 'abx'] as const) {
          if (!Array.isArray(row[kind])) continue;
          const want = new Set<string>(row[kind]);
          const have = new Set(openEpisodes(db, row.admissionId, kind).map(e => e.detail));
          for (const d of want) if (!have.has(d) && toggleDrug(db, session, row.admissionId, kind, d, true, at)) changes++;
          for (const d of have) if (!want.has(d) && toggleDrug(db, session, row.admissionId, kind, d, false, at)) changes++;
        }
      }
      audit(db, session, 'reconcile', 'unit', null, `Daily reconcile: ${changes} change${changes === 1 ? '' : 's'}`);
      return { changes };
    });
  } },

  // Microbiology
  'culture.list': { roles: ALL, fn: (p, { db, session }) => {
    const rows = loadCultures(db);
    const ids = canSeeIdentifiers(session) ? Object.fromEntries((db.prepare('SELECT * FROM patient_identifiers').all() as any[]).map(r => [r.patient_id, r])) : {};
    return rows.filter(c => (!p?.unit || c.unit === p.unit)).map(c => ({
      ...c,
      patientLabel: c.patientId ? (ids[c.patientId]?.name ?? pseudo(c.patientId)) : canSeeIdentifiers(session) ? (c.legacyLabel || '—') : '—',
      legacyLabel: undefined,
      mdr: isMDR(c), resistantClasses: relevantResistantClasses(c),
    }));
  } },
  'culture.save': { roles: CLINICAL, fn: (p, { db, session }) => {
    if (!SPECIMEN_TYPES.includes(p.specimen)) fail('Specimen type is required');
    const collectedAt = reqDT(p.collectedAt, 'Collection date');
    const results = (p.antibiotics ?? []).filter((r: any) => r?.name && ['S', 'I', 'R'].includes(r.result));
    let patientId: string | null = null;
    if (p.admissionId) patientId = getAdmissionRow(db, p.admissionId).patient_id;
    return tx(db, () => {
      const id = p.id ?? randomUUID();
      if (p.id) {
        db.prepare('UPDATE cultures SET collected_at = ?, specimen = ?, organism = ?, admission_id = ?, patient_id = ?, unit = ? WHERE id = ?')
          .run(collectedAt, p.specimen, p.organism || null, p.admissionId ?? null, patientId, p.unit || 'PICU', id);
        db.prepare('DELETE FROM susceptibility_results WHERE culture_id = ?').run(id);
      } else {
        db.prepare('INSERT INTO cultures(id, admission_id, patient_id, unit, collected_at, specimen, organism, source, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .run(id, p.admissionId ?? null, patientId, p.unit || 'PICU', collectedAt, p.specimen, p.organism || null, 'picu', session.user!.id, nowLocal());
      }
      const seen = new Set<string>();
      results.forEach((r: any) => { if (!seen.has(r.name)) { seen.add(r.name); db.prepare('INSERT INTO susceptibility_results(culture_id, drug, result) VALUES (?,?,?)').run(id, r.name, r.result); } });
      audit(db, session, p.id ? 'update' : 'add', 'culture', id,
        `${p.admissionId ? `${admissionLabel(db, p.admissionId)}: ` : ''}${p.specimen} culture — ${p.organism || 'no growth'}${results.length ? ` (${results.length} AST results)` : ''}`);
      return { id };
    });
  } },
  'culture.delete': { roles: CLINICAL, fn: (p, { db, session }) => {
    const c = db.prepare('SELECT * FROM cultures WHERE id = ?').get(p.id) as any ?? fail('Culture not found');
    db.prepare('UPDATE cultures SET deleted_at = ? WHERE id = ?').run(nowLocal(), p.id);
    audit(db, session, 'delete', 'culture', p.id, `Removed ${c.specimen} culture (${c.organism || 'no growth'}, ${c.collected_at})`);
    return true;
  } },
  'micro.summary': { roles: ALL, fn: (p, { db }) => {
    let cultures = loadCultures(db);
    if (p?.unit) cultures = cultures.filter(c => c.unit === p.unit);
    if (p?.specimen) cultures = cultures.filter(c => c.specimen === p.specimen);
    if (p?.from) cultures = cultures.filter(c => c.collectedAt >= p.from);
    if (p?.to) cultures = cultures.filter(c => c.collectedAt.slice(0, 10) <= p.to);
    const units = [...new Set((db.prepare('SELECT DISTINCT unit FROM cultures WHERE deleted_at IS NULL').all() as any[]).map(r => r.unit))].sort();
    return { antibiogram: buildAntibiogram(cultures, { firstIsolateOnly: !!p?.firstIsolateOnly }), units, total: cultures.length, mdrVersion: MDR_DEFINITION_VERSION };
  } },

  // Intelligence
  'dashboard.get': { roles: ALL, fn: (p, { db, now }) => {
    const t = now();
    const month = p?.month ?? toLocal(new Date(t)).slice(0, 7);
    const ds = loadDataset(db);
    const cur = monthSummary(ds, month, t);
    const prev = monthSummary(ds, shiftMonth(month, -1), t);
    const census = presentAt(ds, t);
    const ventilatedNow = census.filter(a => ds.episodes.some(e => e.admissionId === a.id && e.kind === 'resp' && e.detail === 'MV' && !e.endAt)).length;
    const vasoNow = census.filter(a => ds.episodes.some(e => e.admissionId === a.id && e.kind === 'vaso' && !e.endAt)).length;
    const abxNow = census.filter(a => ds.episodes.some(e => e.admissionId === a.id && e.kind === 'abx' && !e.endAt)).length;
    return {
      month, current: cur, previous: prev, projection: projectMonth(cur),
      census: { now: census.length, beds: ds.beds, ventilatedNow, vasoNow, abxNow },
      censusSeries: { current: dailyCensus(ds, month, t), previous: dailyCensus(ds, shiftMonth(month, -1), t) },
      series: monthlySeries(ds, month, 12, t),
      changes: detectChanges(ds, month, t),
      quality: { issues: runQualityChecks(ds, t).length },
      unitName: getSetting(db, 'unitName', 'PICU'),
      hasData: ds.admissions.length > 0 || ds.cultures.length > 0,
    };
  } },
  'stewardship.get': { roles: ALL, fn: (p, { db, now }) => {
    const t = now();
    const end = p?.month ?? toLocal(new Date(t)).slice(0, 7);
    const ds = loadDataset(db);
    const months = Array.from({ length: 12 }, (_, i) => shiftMonth(end, i - 11)).map(m => {
      const s = monthSummary(ds, m, t);
      return { month: m, patientDays: s.patientDays, per1000: s.dot.per1000, byDrug: s.dot.byDrug, byAware: s.dot.byAware,
        exposedPct: s.patientsManaged ? (s.dot.exposedPatients / s.patientsManaged) * 100 : null, patients: s.patientsManaged };
    });
    // Culture-directed therapy: antimicrobials started as 'targeted' (after a result) vs empiric, last 3 months.
    const since = ms(`${shiftMonth(end, -2)}-01`);
    const recent = ds.episodes.filter(e => e.kind === 'abx' && ms(e.startAt) >= since);
    const durations = recent.filter(e => e.endAt).map(e => (ms(e.endAt!) - ms(e.startAt)) / DAY_MS);
    return {
      months,
      intents: { empiric: recent.filter(e => e.intent === 'empiric').length, targeted: recent.filter(e => e.intent === 'targeted').length, prophylaxis: recent.filter(e => e.intent === 'prophylaxis').length },
      medianCourseDays: durations.length ? durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)] : null,
      courses: recent.length,
    };
  } },
  'quality.list': { roles: NON_RESEARCH, fn: (_p, { db, now }) => {
    const ds = loadDataset(db);
    const issues = runQualityChecks(ds, now());
    const labels = Object.fromEntries(ds.admissions.map(a => [a.id, `${a.bed ? `Bed ${a.bed} · ` : ''}${pseudo(a.patientId)} · ${dxLabel(a.primaryDx)}`]));
    return { issues: issues.map(i => ({ ...i, label: i.admissionId ? labels[i.admissionId] : 'Unlinked culture' })), rules: QUALITY_RULES };
  } },
  'activity.list': { roles: NON_RESEARCH, fn: (p, { db }) => {
    const limit = Math.min(500, Number(p?.limit) || 200);
    const rows = p?.before
      ? db.prepare('SELECT * FROM audit_log WHERE id < ? ORDER BY id DESC LIMIT ?').all(p.before, limit)
      : db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);
    return rows;
  } },
  'recent.list': { roles: NON_RESEARCH, fn: (_p, { db }) => {
    // Recently discharged admissions for the sidebar.
    const rows = db.prepare(`SELECT a.id, a.bed, a.patient_id, a.discharge_at, a.disposition, d.code FROM admissions a
      LEFT JOIN diagnoses d ON d.admission_id = a.id AND d.role = 'primary'
      WHERE a.deleted_at IS NULL AND a.discharge_at IS NOT NULL ORDER BY a.discharge_at DESC LIMIT 6`).all() as any[];
    return rows.map(r => ({ id: r.id, label: pseudo(r.patient_id), dx: dxLabel(r.code), dischargeAt: r.discharge_at, disposition: r.disposition }));
  } },

  // Research export (de-identified): day offsets instead of dates, no identifiers, no free text.
  'export.deidentified': { roles: ['admin', 'researcher'], fn: (p, { db, session, now }) => {
    const ds = loadDataset(db);
    const t = now();
    const from = p?.from ? ms(p.from) : -Infinity, to = p?.to ? ms(p.to) + DAY_MS : Infinity;
    const rows = ds.admissions.filter(a => ms(a.admitAt) >= from && ms(a.admitAt) < to);
    const studyIds = new Map<string, string>();
    const sid = (pid: string) => { if (!studyIds.has(pid)) studyIds.set(pid, `S${String(studyIds.size + 1).padStart(4, '0')}`); return studyIds.get(pid)!; };
    const header = ['study_id', 'admission_seq', 'admit_month', 'age_months', 'sex', 'weight_kg', 'source', 'admission_type', 'primary_dx', 'primary_dx_icd10',
      'secondary_dx', 'chronic_condition', 'malnutrition', 'arrival_support', 'shock_on_arrival', 'coma_on_arrival', 'peak_support',
      'mv_days', 'vaso_days', 'antimicrobials', 'dot_total', 'positive_cultures', 'mdr_isolates', 'los_days', 'disposition'];
    const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const seq: Record<string, number> = {};
    const lines = rows.sort((a, b) => a.admitAt.localeCompare(b.admitAt)).map(a => {
      const eps = ds.episodes.filter(e => e.admissionId === a.id);
      const end = (e: Episode) => (e.endAt ? ms(e.endAt) : a.dischargeAt ? ms(a.dischargeAt) : t);
      const days = (k: string, d?: string) => eps.filter(e => e.kind === k && (!d || e.detail === d)).reduce((s, e) => s + (end(e) - ms(e.startAt)) / DAY_MS, 0);
      const cult = ds.cultures.filter(c => c.admissionId === a.id && c.organism);
      seq[a.patientId] = (seq[a.patientId] ?? 0) + 1;
      return [sid(a.patientId), seq[a.patientId], a.admitAt.slice(0, 7), Math.round(a.ageMonths), a.sex, a.weightKg ?? '', a.source, a.admissionType,
        a.primaryDx, DX_BY_CODE[a.primaryDx]?.icd10 ?? '', a.secondaryDx.join(';'), +a.chronicCondition, +a.malnutrition, a.arrivalSupport,
        +a.shockOnArrival, +a.comaOnArrival, peakSupport(a, eps), days('resp', 'MV').toFixed(1), days('vaso').toFixed(1),
        [...new Set(eps.filter(e => e.kind === 'abx').map(e => e.detail))].join(';'),
        eps.filter(e => e.kind === 'abx').reduce((s, e) => s + Math.max(1, Math.ceil((end(e) - ms(e.startAt)) / DAY_MS)), 0),
        cult.length, cult.filter(isMDR).length, losDays(a, t).toFixed(1), a.disposition ?? 'In PICU'].map(esc).join(',');
    });
    audit(db, session, 'export', 'research', null, `De-identified export: ${rows.length} admissions`);
    return { csv: [header.join(','), ...lines].join('\n'), rows: rows.length };
  } },

  // Administration
  'users.list': { roles: ['admin'], fn: (_p, { db }) =>
    (db.prepare('SELECT id, username, display_name, role, active, created_at FROM users ORDER BY active DESC, display_name').all() as any[])
      .map(r => ({ id: r.id, username: r.username, displayName: r.display_name, role: r.role, active: !!r.active, createdAt: r.created_at })) },
  'users.create': { roles: ['admin'], fn: (p, { db, session }) => {
    if (!p.username || !p.displayName) fail('Name and username are required');
    if (!['admin', 'clinician', 'viewer', 'researcher'].includes(p.role)) fail('Choose a role');
    if (!p.password || p.password.length < PASSWORD_MIN) fail(`Password must be at least ${PASSWORD_MIN} characters`);
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(p.username.trim())) fail('That username is taken');
    const { hash, salt } = hashPassword(p.password);
    const r = db.prepare('INSERT INTO users(username, display_name, role, pw_hash, pw_salt, created_at) VALUES (?,?,?,?,?,?)')
      .run(p.username.trim(), p.displayName.trim(), p.role, hash, salt, nowLocal());
    audit(db, session, 'add', 'user', String(r.lastInsertRowid), `Added ${p.displayName} as ${p.role}`);
    return true;
  } },
  'users.update': { roles: ['admin'], fn: (p, { db, session }) => {
    const r = db.prepare('SELECT * FROM users WHERE id = ?').get(p.id) as any ?? fail('User not found');
    if (r.id === session.user!.id && (p.active === false || (p.role && p.role !== 'admin'))) fail('You cannot demote or deactivate yourself');
    if (p.role) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(p.role, p.id);
    if (typeof p.active === 'boolean') db.prepare('UPDATE users SET active = ? WHERE id = ?').run(p.active ? 1 : 0, p.id);
    if (p.password) {
      if (p.password.length < PASSWORD_MIN) fail(`Password must be at least ${PASSWORD_MIN} characters`);
      const { hash, salt } = hashPassword(p.password);
      db.prepare('UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?').run(hash, salt, p.id);
    }
    audit(db, session, 'update', 'user', String(p.id), `Updated ${r.display_name}${p.role ? ` → ${p.role}` : ''}${typeof p.active === 'boolean' ? (p.active ? ' (activated)' : ' (deactivated)') : ''}${p.password ? ' (password reset)' : ''}`);
    return true;
  } },
  'settings.get': { roles: ALL, fn: (_p, { db }) => ({ unitName: getSetting(db, 'unitName', 'PICU'), beds: Number(getSetting(db, 'beds', '12')) }) },
  'settings.update': { roles: ['admin'], fn: (p, { db, session }) => {
    if (p.unitName) setSetting(db, 'unitName', String(p.unitName).trim().slice(0, 60));
    if (p.beds) setSetting(db, 'beds', String(Math.max(1, Math.min(200, Number(p.beds)))));
    audit(db, session, 'update', 'settings', null, `Unit settings changed`);
    return true;
  } },
};

export function createApi(db: DB, nowFn: () => number = Date.now) {
  const session: Session = { user: null, lastActivity: Date.now() };
  /** Enforces the idle lock and role for any privileged call (API routes and desktop-only routes alike). */
  const authorize = (roles: Role[]) => {
    if (session.user && Date.now() - session.lastActivity > IDLE_LOCK_MS) {
      audit(db, session, 'lock', 'user', String(session.user.id), `${session.user.displayName} locked out after inactivity`);
      session.user = null;
    }
    if (!session.user) throw new ApiError('SESSION_EXPIRED');
    if (!roles.includes(session.user.role)) throw new ApiError('Your role does not allow this action');
    session.lastActivity = Date.now();
  };
  return {
    session,
    authorize,
    async call(method: string, params: unknown) {
      const route = routes[method];
      if (!route) throw new ApiError(`Unknown method ${method}`);
      if (route.roles !== 'public') authorize(route.roles);
      return route.fn(params ?? {}, { db, session, now: nowFn });
    },
  };
}
