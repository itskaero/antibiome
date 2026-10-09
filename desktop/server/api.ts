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
import { detectChanges, losDays, monthSummary, monthlySeries, dailyCensus, presentAt, projectMonth, peakSupport, smrFor } from '../shared/analytics';
import { runQualityChecks, QUALITY_RULES } from '../shared/quality';
import { buildAntibiogram } from '../shared/antibiogram';
import { isMDR, relevantResistantClasses, MDR_DEFINITION_VERSION } from '../shared/mdr';
import { DAY_MS, ms, nowLocal, shiftMonth, toLocal } from '../shared/time';
import { PIM3_VERSION, pim3Logit, suggestRiskDx, validatePim3 } from '../shared/pim3';
import { VITALS, VITAL_CONTEXTS, VITAL_FEATURES, vitalFeatures, admissionSet, flags24, sfRatio, shockIndex, validateVitals, vitalFlags, worst24, type VitalCode, type VitalContext, type VitalSet, type VitalValues } from '../shared/vitals';
import { buildExplorer } from './explorer';
import { infectionSuspected, phoenix24, phoenixPerSet, phoenixSepsis, phoenixSepticShock } from '../shared/scores';
import { buildProtocolCases, loadProtocols, timePoints } from './protocols';
import { describeRule, evaluateProtocol, validateProtocol } from '../shared/protocols';
import { describeCondition, describeSpec, narrate, runCohort, validateSpec } from '../shared/explorer';
import { AI_PROVIDERS, AiError, TRANSLATORS, containsIdentifier, isProvider, translateQuestion, type AiProvider, type Translator } from './ai';
import { createPairingCode, listDevices, revokeDevice, touchDevice } from './mobile';
import { buildCases, loadModules, loadValues, moduleExportColumns, moduleIssues, saveModule, saveParam, setParamRetired, setValue, valuesByKey } from './modules';
import { DERIVED, compareGroups, computeDerived, moduleApplies, moduleCompletion, summarizeModule, wasCollected } from '../shared/modules';

export class ApiError extends Error {}
const fail = (msg: string): never => { throw new ApiError(msg); };

export type Channel = 'desktop' | 'mobile';
/** One per device: the PC has a fixed 'local' session; each phone browser tab gets its own. */
export interface Session { user: User | null; lastActivity: number; channel: Channel; deviceId: string | null; deviceName: string | null }
export const IDLE_LOCK_MS = 15 * 60_000;
/** Phones are easy to leave unlocked on a bedside table — they lock sooner. */
export const MOBILE_IDLE_MS = 5 * 60_000;
const idleLimit = (s: Session) => (s.channel === 'mobile' ? MOBILE_IDLE_MS : IDLE_LOCK_MS);
const newSession = (channel: Channel = 'desktop', device?: { id: string; name: string }): Session =>
  ({ user: null, lastActivity: Date.now(), channel, deviceId: device?.id ?? null, deviceName: device?.name ?? null });

/** Bedside work only. Research, exports, AI, settings, users and configuration stay on the PC. */
export const MOBILE_METHODS = new Set([
  'auth.status', 'auth.login', 'auth.logout', 'auth.unpairDevice', 'census.list', 'patient.lookup', 'patients.search', 'recent.list',
  'admission.create', 'admission.get', 'admission.update', 'admission.discharge',
  'resp.set', 'drug.toggle', 'episode.update', 'episode.delete', 'event.add', 'event.delete',
  'values.forAdmission', 'values.set', 'modules.list', 'pim3.save',
  'vitals.add', 'vitals.delete', 'vitals.forAdmission', 'culture.save', 'culture.list', 'dashboard.get',
]);

/** Secrets live outside the database in clear text: the desktop app encrypts them with the OS keychain (safeStorage). */
export interface SecretStore { available(): boolean; load(key: string): string | null; save(key: string, value: string | null): void }
/** `translator` overrides every provider (tests, offline builds); otherwise the chosen provider's own is used. */
export interface ApiEnv { secrets: SecretStore; translator: Translator | null }
const memorySecrets = (): SecretStore => { const m = new Map<string, string>(); return { available: () => true, load: k => m.get(k) ?? null, save: (k, v) => { if (v == null) m.delete(k); else m.set(k, v); } }; };

type Handler = (p: any, ctx: { db: DB; session: Session; now: () => number; env: ApiEnv; endDeviceSessions: (deviceId: string) => void }) => unknown;
interface Route { roles: Role[] | 'public'; fn: Handler }

const ALL: Role[] = ['admin', 'clinician', 'viewer', 'researcher'];
const CLINICAL: Role[] = ['admin', 'clinician'];
const NON_RESEARCH: Role[] = ['admin', 'clinician', 'viewer'];
/** Names/MRNs: clinical roles only, and on phones only when the unit has switched it on. */
const canSeeIdentifiers = (s: Session, db: DB) => !!s.user && CLINICAL.includes(s.user.role) && (s.channel === 'desktop' || getSetting(db, 'mobileShowNames', '0') === '1');

// ── Helpers ──────────────────────────────────────────────────

const aiProvider = (db: DB): AiProvider => { const v = getSetting(db, 'aiProvider', 'anthropic'); return isProvider(v) ? v : 'anthropic'; };
const aiModel = (db: DB, p: AiProvider) => { const v = getSetting(db, `aiModel:${p}`); return AI_PROVIDERS[p].models.includes(v) ? v : AI_PROVIDERS[p].models[0]; };

function audit(db: DB, s: Session, action: string, entity: string, entityId: string | null, summary: string) {
  db.prepare('INSERT INTO audit_log(at, user_id, username, action, entity, entity_id, summary) VALUES (?,?,?,?,?,?,?)')
    .run(nowLocal(), s.user?.id ?? null, s.user?.displayName ?? 'system', action, entity, entityId, s.channel === 'mobile' ? `${summary} · via ${s.deviceName ?? 'phone'}` : summary);
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

/** Vital-sign sets, oldest first (optionally for one admission). */
export function loadVitals(db: DB, admissionId?: string): VitalSet[] {
  const sets = (admissionId
    ? db.prepare('SELECT * FROM vital_sets WHERE admission_id = ? AND deleted_at IS NULL ORDER BY at').all(admissionId)
    : db.prepare('SELECT * FROM vital_sets WHERE deleted_at IS NULL ORDER BY at').all()) as any[];
  if (!sets.length) return [];
  const vals = db.prepare(`SELECT v.* FROM vital_values v JOIN vital_sets s ON s.id = v.set_id WHERE s.deleted_at IS NULL${admissionId ? ' AND s.admission_id = ?' : ''}`)
    .all(...(admissionId ? [admissionId] : [])) as any[];
  const by: Record<string, VitalValues> = {};
  vals.forEach(v => { (by[v.set_id] ??= {})[v.code as VitalCode] = v.value; });
  return sets.map(s => ({ id: s.id, admissionId: s.admission_id, at: s.at, context: s.context, values: by[s.id] ?? {} }));
}

function saveVitalSet(db: DB, s: Session, admissionId: string, at: string, context: string, raw: unknown, now: number) {
  if (!VITAL_CONTEXTS.includes(context as VitalContext)) fail('Unknown vitals context');
  if (ms(at) > now + 10 * 60_000) fail('Vitals time is in the future');
  const values = (() => { try { return validateVitals(raw as Record<string, unknown>); } catch (e: any) { return fail(e.message); } })();
  const id = randomUUID();
  db.prepare('INSERT INTO vital_sets(id, admission_id, at, context, created_by, created_at) VALUES (?,?,?,?,?,?)').run(id, admissionId, at, context, s.user?.id ?? null, nowLocal());
  Object.entries(values).forEach(([code, v]) => db.prepare('INSERT INTO vital_values(set_id, code, value) VALUES (?,?,?)').run(id, code, v));
  audit(db, s, 'add', 'vitals', admissionId, `${admissionLabel(db, admissionId)}: vitals (${Object.entries(values).map(([c, v]) => `${VITALS[c as VitalCode].short} ${v}`).join(', ')})`);
  return { id, values };
}

/** The de-identified dataset every analytic is computed from. */
export function loadDataset(db: DB): Dataset {
  const dxRows = db.prepare('SELECT admission_id, code, role FROM diagnoses').all() as any[];
  const dxBy: Record<string, { code: string; role: string }[]> = {};
  dxRows.forEach(d => (dxBy[d.admission_id] ??= []).push(d));
  const admissions = (db.prepare(`SELECT a.*, p.sex, s.risk AS pim3_risk FROM admissions a JOIN patients p ON p.id = a.patient_id
      LEFT JOIN pim3_assessments s ON s.admission_id = a.id WHERE a.deleted_at IS NULL`).all() as any[])
    .map(r => ({ ...rowToAdmission(r, dxBy[r.id] ?? []), pim3Risk: r.pim3_risk ?? null }));
  const episodes = (db.prepare('SELECT * FROM episodes WHERE deleted_at IS NULL').all() as any[]).map(rowToEpisode);
  const events = (db.prepare('SELECT * FROM clinical_events WHERE deleted_at IS NULL').all() as any[]).map(rowToEvent);
  return { admissions, episodes, events, cultures: loadCultures(db), vitals: loadVitals(db), beds: Number(getSetting(db, 'beds', '12')) };
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

/** Apply { paramId: value } for one admission (used by admit, discharge and the module card). */
function applyModuleValues(db: DB, s: Session, admissionId: string, values: Record<string, unknown> | undefined, recordedAt?: string) {
  const entries = Object.entries(values ?? {}).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length));
  entries.forEach(([paramId, v]) => {
    try { setValue(db, admissionId, paramId, v, s.user?.id ?? null, recordedAt); } catch (e: any) { fail(e.message); }
  });
  return entries.length;
}

function savePim3(db: DB, s: Session, admissionId: string, raw: unknown) {
  const input = (() => { try { return validatePim3(raw); } catch (e: any) { return fail(e.message); } })();
  const logit = pim3Logit(input), risk = 1 / (1 + Math.exp(-logit)), t = nowLocal();
  db.prepare(`INSERT INTO pim3_assessments(admission_id, inputs, logit, risk, version, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(admission_id) DO UPDATE SET inputs = excluded.inputs, logit = excluded.logit, risk = excluded.risk, version = excluded.version, updated_at = excluded.updated_at`)
    .run(admissionId, JSON.stringify(input), logit, risk, PIM3_VERSION, s.user?.id ?? null, t, t);
  audit(db, s, 'update', 'pim3', admissionId, `${admissionLabel(db, admissionId)}: PIM3 recorded (${(risk * 100).toFixed(1)}%)`);
  return { risk };
}

function censusRows(db: DB, s: Session, now: number) {
  const ds = loadDataset(db);
  const issues = runQualityChecks(ds, now);
  const ids = canSeeIdentifiers(s, db)
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
    channel: session.channel, deviceName: session.deviceName, idleMinutes: idleLimit(session) / 60_000,
  }) },
  'auth.setup': { roles: 'public', fn: (p, { db, session }) => {
    if ((db.prepare('SELECT COUNT(*) n FROM users').get() as any).n > 0) fail('Already set up');
    if (session.channel !== 'desktop') fail('Set up the unit on the PICU PC');
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
      audit(db, { ...session, user: null }, 'login-failed', 'user', null, `Failed sign-in for "${String(p.username ?? '').slice(0, 40)}"`);
      fail('Incorrect username or password');
    }
    if (session.channel === 'mobile' && r.role === 'researcher') fail('Research accounts work on the PICU PC only');
    session.user = { id: r.id, username: r.username, displayName: r.display_name, role: r.role, active: !!r.active };
    session.lastActivity = Date.now();
    if (session.deviceId) touchDevice(db, session.deviceId, r.display_name);
    audit(db, session, 'login', 'user', String(r.id), `${r.display_name} signed in`);
    return session.user;
  } },
  'auth.logout': { roles: ALL, fn: (_p, { db, session }) => { audit(db, session, 'logout', 'user', String(session.user!.id), `${session.user!.displayName} signed out`); session.user = null; return true; } },
  /** A phone unpairing itself (from "Me"). */
  'auth.unpairDevice': { roles: ALL, fn: (_p, { db, session, endDeviceSessions }) => {
    if (!session.deviceId) fail('Only a paired phone can unpair itself');
    const d = revokeDevice(db, session.deviceId!);
    audit(db, session, 'delete', 'device', d.id, `Phone "${d.name}" unpaired itself`);
    endDeviceSessions(d.id);
    return true;
  } },
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
    rows: censusRows(db, session, now()), beds: Number(getSetting(db, 'beds', '12')), showIdentifiers: canSeeIdentifiers(session, db),
  }) },
  'patient.lookup': { roles: CLINICAL, fn: (p, { db, session }) => {
    const r = db.prepare('SELECT i.*, p.sex FROM patient_identifiers i JOIN patients p ON p.id = i.patient_id WHERE i.mrn = ?').get(String(p.mrn ?? '').trim()) as any;
    if (!r) return null;
    const last = db.prepare('SELECT admit_at, discharge_at, age_months, weight_kg FROM admissions WHERE patient_id = ? AND deleted_at IS NULL ORDER BY admit_at DESC LIMIT 1').get(r.patient_id) as any;
    const open = db.prepare('SELECT id FROM admissions WHERE patient_id = ? AND discharge_at IS NULL AND deleted_at IS NULL').get(r.patient_id) as any;
    const named = canSeeIdentifiers(session, db);
    return { patientId: r.patient_id, name: named ? r.name : null, dob: named ? r.dob : null, sex: r.sex, lastAdmission: last ?? null, openAdmissionId: open?.id ?? null };
  } },
  'admission.create': { roles: CLINICAL, fn: (p, { db, session, now }) => {
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
      const nModule = applyModuleValues(db, session, id, p.moduleValues, p.admitAt);
      if (p.vitals && Object.values(p.vitals).some(v => v !== '' && v != null)) saveVitalSet(db, session, id, p.admitAt, 'admission', p.vitals, now());
      if (p.pim3) savePim3(db, session, id, p.pim3);
      audit(db, session, 'admit', 'admission', id, `Admitted ${admissionLabel(db, id)} from ${p.source}${nModule ? ` (+${nModule} module fields)` : ''}`);
      return { id };
    });
  } },
  'admission.get': { roles: NON_RESEARCH, fn: (p, { db, session, now }) => {
    const r = getAdmissionRow(db, p.id);
    const dx = db.prepare('SELECT code, role FROM diagnoses WHERE admission_id = ?').all(p.id) as any[];
    const admission = rowToAdmission(r, dx);
    const ident = canSeeIdentifiers(session, db) ? db.prepare('SELECT mrn, name, dob FROM patient_identifiers WHERE patient_id = ?').get(r.patient_id) as any : null;
    if (ident) audit(db, session, 'view', 'patient', r.patient_id, `Opened record ${admissionLabel(db, p.id)}`);
    const episodes = (db.prepare('SELECT * FROM episodes WHERE admission_id = ? AND deleted_at IS NULL ORDER BY start_at').all(p.id) as any[]).map(rowToEpisode);
    const events = (db.prepare('SELECT * FROM clinical_events WHERE admission_id = ? AND deleted_at IS NULL ORDER BY at').all(p.id) as any[]).map(rowToEvent);
    const cultures = loadCultures(db, 'admission_id = ?', [p.id]).map(c => ({ ...c, mdr: isMDR(c) }));
    const vitals = loadVitals(db, p.id);
    const admVitals = admissionSet(vitals, admission.admitAt)?.values ?? {};
    const ds = loadDataset(db);
    const previous = (db.prepare(`SELECT a.id, a.admit_at, a.discharge_at, a.disposition, d.code FROM admissions a
      LEFT JOIN diagnoses d ON d.admission_id = a.id AND d.role = 'primary'
      WHERE a.patient_id = ? AND a.id != ? AND a.deleted_at IS NULL ORDER BY a.admit_at DESC`).all(r.patient_id, p.id) as any[])
      .map(x => ({ id: x.id, admit_at: x.admit_at, discharge_at: x.discharge_at, disposition: x.disposition, dx: dxLabel(x.code) }));
    return {
      admission, label: pseudo(r.patient_id), identifiers: ident ?? null, episodes, events, cultures,
      losDays: losDays(admission, now()), peakSupport: peakSupport(admission, episodes),
      pim3: (() => { const s = db.prepare('SELECT * FROM pim3_assessments WHERE admission_id = ?').get(p.id) as any; return s ? { inputs: JSON.parse(s.inputs), risk: s.risk, version: s.version, updatedAt: s.updated_at } : null; })(),
      vitals,
      pim3Suggestion: { sbp: admVitals.sbp, fio2: admVitals.fio2 != null ? admVitals.fio2 / 100 : undefined, riskDx: suggestRiskDx(admission.primaryDx), elective: admission.admissionType === 'elective',
        mvFirstHour: episodes.some(e => e.kind === 'resp' && e.detail === 'MV' && ms(e.startAt) <= ms(admission.admitAt) + 3_600_000) },
      issues: [...runQualityChecks(ds, now()), ...moduleIssues(loadModules(db), ds, loadValues(db, p.id))].filter(i => i.admissionId === p.id),
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
      applyModuleValues(db, session, p.id, p.moduleValues, at);
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
  'pim3.save': { roles: CLINICAL, fn: (p, { db, session }) => { getAdmissionRow(db, p.admissionId); return tx(db, () => savePim3(db, session, p.admissionId, p.inputs)); } },
  'vitals.add': { roles: CLINICAL, fn: (p, { db, session, now }) => {
    const a = getAdmissionRow(db, p.admissionId);
    const at = reqDT(p.at ?? nowLocal(), 'Time');
    if (ms(at) < ms(a.admit_at) - 2 * 3_600_000) fail('Vitals are more than 2 h before admission');
    if (a.discharge_at && ms(at) > ms(a.discharge_at) + 3_600_000) fail('Vitals are after discharge');
    return tx(db, () => saveVitalSet(db, session, p.admissionId, at, p.context ?? 'routine', p.values, now()));
  } },
  'vitals.delete': { roles: CLINICAL, fn: (p, { db, session }) => {
    const v = db.prepare('SELECT * FROM vital_sets WHERE id = ?').get(p.id) as any ?? fail('Vitals not found');
    db.prepare('UPDATE vital_sets SET deleted_at = ? WHERE id = ?').run(nowLocal(), p.id);
    audit(db, session, 'delete', 'vitals', v.admission_id, `${admissionLabel(db, v.admission_id)}: removed vitals from ${v.at}`);
    return true;
  } },
  'vitals.forAdmission': { roles: NON_RESEARCH, fn: (p, { db }) => {
    const a = getAdmissionRow(db, p.admissionId);
    const sets = loadVitals(db, p.admissionId);
    const adm = admissionSet(sets, a.admit_at);
    const admission = rowToAdmission(a, db.prepare('SELECT code, role FROM diagnoses WHERE admission_id = ?').all(p.admissionId) as any[]);
    const eps = (db.prepare('SELECT * FROM episodes WHERE admission_id = ? AND deleted_at IS NULL').all(p.admissionId) as any[]).map(rowToEpisode);
    const evs = (db.prepare('SELECT * FROM clinical_events WHERE admission_id = ? AND deleted_at IS NULL').all(p.admissionId) as any[]).map(rowToEvent);
    const infection = infectionSuspected(admission, eps, evs, loadCultures(db, 'admission_id = ?', [p.admissionId]));
    const perSet = new Map(phoenixPerSet(sets, eps, a.age_months).map(x => [x.set.id, x.score]));
    const p24 = phoenix24(sets, eps, a.admit_at, a.age_months);
    return {
      sets: [...sets].reverse().map(s => ({ ...s, flags: vitalFlags(s.values, a.age_months), sf: sfRatio(s.values), shockIndex: shockIndex(s.values), phoenix: perSet.get(s.id) ?? null })),
      admissionSetId: adm?.id ?? null, worst24: worst24(sets, a.admit_at), flags24: flags24(sets, a.admit_at, a.age_months), ageMonths: a.age_months,
      phoenix24: p24 ? { ...p24, sepsis: phoenixSepsis(p24, infection), septicShock: phoenixSepticShock(p24, infection), infectionSuspected: infection } : null,
    };
  } },
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
    const ids = canSeeIdentifiers(session, db) ? Object.fromEntries((db.prepare('SELECT * FROM patient_identifiers').all() as any[]).map(r => [r.patient_id, r])) : {};
    return rows.filter(c => (!p?.unit || c.unit === p.unit)).map(c => ({
      ...c,
      patientLabel: c.patientId ? (ids[c.patientId]?.name ?? pseudo(c.patientId)) : canSeeIdentifiers(session, db) ? (c.legacyLabel || '—') : '—',
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
    // A single month rarely has enough expected deaths for a stable SMR, so the dashboard uses a rolling 12 months.
    const smrFrom = ms(`${shiftMonth(month, -11)}-01`), smrTo = ms(`${shiftMonth(month, 1)}-01`);
    const smr12 = smrFor(ds.admissions.filter(a => a.dischargeAt && ms(a.dischargeAt) >= smrFrom && ms(a.dischargeAt) < smrTo));
    return {
      month, current: cur, previous: prev, projection: projectMonth(cur), smr12,
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
      return { month: m, patientDays: s.patientDays, daysPresent: s.daysPresent, per1000: s.dot.per1000, byDrug: s.dot.byDrug, byAware: s.dot.byAware,
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
    const issues = [...runQualityChecks(ds, now()), ...moduleIssues(loadModules(db), ds, loadValues(db))];
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
  /** Every admission, newest first: the patients archive. Name/MRN search only for roles that may see them. */
  'patients.search': { roles: NON_RESEARCH, fn: (p, { db, session, now }) => {
    const named = canSeeIdentifiers(session, db);
    const q = String(p?.q ?? '').trim().toLowerCase().slice(0, 60);
    const status = ['all', 'in', 'discharged', 'died'].includes(p?.status) ? p.status : 'all';
    const limit = Math.min(200, Math.max(1, Number(p?.limit) || 50));
    const where: string[] = ['a.deleted_at IS NULL'], args: any[] = [];
    if (status === 'in') where.push('a.discharge_at IS NULL');
    if (status === 'discharged') where.push('a.discharge_at IS NOT NULL');
    if (status === 'died') where.push("a.disposition = 'Died'");
    if (p?.from) { where.push('a.admit_at >= ?'); args.push(String(p.from)); }
    if (p?.to) { where.push('a.admit_at < ?'); args.push(`${String(p.to)}T99`); }
    const rows = db.prepare(`SELECT a.*, pt.sex, i.mrn, i.name FROM admissions a JOIN patients pt ON pt.id = a.patient_id
      LEFT JOIN patient_identifiers i ON i.patient_id = a.patient_id WHERE ${where.join(' AND ')} ORDER BY a.admit_at DESC`).all(...args) as any[];
    const dxRows = db.prepare('SELECT admission_id, code, role FROM diagnoses').all() as any[];
    const dxBy: Record<string, { code: string; role: string }[]> = {};
    dxRows.forEach(d => (dxBy[d.admission_id] ??= []).push(d));
    const t = now();
    const matched = rows.filter(r => {
      if (!q) return true;
      const dx = (dxBy[r.id] ?? []).map(d => `${dxLabel(d.code)} ${DX_BY_CODE[d.code]?.icd10 ?? ''}`).join(' ');
      const hay = [pseudo(r.patient_id), dx, r.bed ? `bed ${r.bed}` : '', ...(named ? [r.mrn ?? '', r.name ?? ''] : [])].join(' ').toLowerCase();
      return q.split(/\s+/).every(w => hay.includes(w));
    });
    const page = matched.slice(0, limit).map(r => {
      const a = rowToAdmission(r, dxBy[r.id] ?? []);
      return { admission: a, label: pseudo(r.patient_id), name: named ? r.name : null, mrn: named ? r.mrn : null, losDays: losDays(a, t) };
    });
    return { rows: page, total: matched.length, showIdentifiers: named };
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
      'mv_days', 'vaso_days', 'antimicrobials', 'dot_total', 'positive_cultures', 'mdr_isolates', 'los_days', 'disposition', 'pim3_risk'];
    const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const moduleCols = p?.includeModules === false ? [] : moduleExportColumns(db, loadModules(db, { includeInactive: true }), ds, loadValues(db), t);
    header.push(...moduleCols.map(c => c.name));
    const vitalsBy = new Map<string, VitalSet[]>();
    (ds.vitals ?? []).forEach(v => { (vitalsBy.get(v.admissionId) ?? vitalsBy.set(v.admissionId, []).get(v.admissionId)!).push(v); });
    const vitalCols = p?.includeVitals === false ? [] : VITAL_FEATURES;
    header.push(...vitalCols.map(f => f.id));
    const vitalCells = (a: Admission) => {
      const eps = ds.episodes.filter(e => e.admissionId === a.id);
      const f = vitalFeatures(vitalsBy.get(a.id) ?? [], a.admitAt, a.ageMonths, {
        episodes: eps, infectionSuspected: infectionSuspected(a, eps, ds.events.filter(e => e.admissionId === a.id), ds.cultures.filter(c => c.admissionId === a.id)),
      });
      return vitalCols.map(c => { const v = f[c.id]; return v === undefined ? '' : Array.isArray(v) ? v.join(';') : typeof v === 'boolean' ? +v : v; });
    };
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
        cult.length, cult.filter(isMDR).length, losDays(a, t).toFixed(1), a.disposition ?? 'In PICU', a.pim3Risk != null ? a.pim3Risk.toFixed(4) : '', ...moduleCols.map(c => c.cell(a)), ...vitalCells(a)].map(esc).join(',');
    });
    audit(db, session, 'export', 'research', null, `De-identified export: ${rows.length} admissions, ${header.length} columns`);
    const dictHeader = ['column', 'module', 'label', 'type', 'unit', 'codes', 'capture', 'introduced', 'versions'];
    const vitalDict = vitalCols.map(f => ({
      column: f.id, module: f.group, label: `${f.label}. ${f.description}`, type: f.kind, unit: f.unit ?? '',
      codes: f.kind === 'boolean' ? '1 = yes, 0 = no' : f.kind === 'set' ? `; separated: ${f.options!.join(' | ')}` : '', capture: 'derived from vital-sign sets', introduced: '', versions: '',
    }));
    const dictionary = [dictHeader.join(','), ...[...moduleCols.map(c => c.dict), ...vitalDict].map(d => dictHeader.map(k => esc((d as any)[k])).join(','))].join('\n');
    return { csv: [header.join(','), ...lines].join('\n'), dictionary, rows: rows.length, columns: header.length };
  } },

  // Parameters & disease modules
  'modules.list': { roles: ALL, fn: (_p, { db, session }) => ({
    modules: loadModules(db, { includeInactive: session.user!.role === 'admin' }).map(m => ({
      ...m, valueCounts: Object.fromEntries((db.prepare(`SELECT param_id, COUNT(DISTINCT admission_id) n FROM parameter_values WHERE deleted_at IS NULL AND param_id LIKE ? GROUP BY param_id`).all(`${m.id}.%`) as any[]).map(r => [r.param_id, r.n])),
    })),
    derived: Object.values(DERIVED).map(({ fn: _fn, ...d }) => d),
  }) },
  'modules.save': { roles: ['admin'], fn: (p, { db, session }) => {
    const r = (() => { try { return saveModule(db, p); } catch (e: any) { return fail(e.message); } })();
    audit(db, session, r.created ? 'add' : 'update', 'module', r.id, `${r.created ? 'Created' : 'Updated'} module "${p.label}"${p.active === false ? ' (deactivated)' : ''}`);
    return r;
  } },
  'params.save': { roles: ['admin'], fn: (p, { db, session }) => tx(db, () => {
    const r = (() => { try { return saveParam(db, p, session.user!.id); } catch (e: any) { return fail(e.message); } })();
    audit(db, session, p.id ? 'update' : 'add', 'parameter', r.id, `${p.id ? 'Edited' : 'Added'} field "${p.label}" in ${p.moduleId}${r.bumped ? ` → version ${r.version}` : ''}`);
    return r;
  }) },
  'params.retire': { roles: ['admin'], fn: (p, { db, session }) => {
    const def = (() => { try { return setParamRetired(db, p.id, !!p.retired); } catch (e: any) { return fail(e.message); } })();
    audit(db, session, 'update', 'parameter', p.id, `${p.retired ? 'Retired' : 'Restored'} field "${def.label}"`);
    return true;
  } },
  'values.forAdmission': { roles: NON_RESEARCH, fn: (p, { db, now }) => {
    const r = getAdmissionRow(db, p.admissionId);
    const dx = db.prepare('SELECT code, role FROM diagnoses WHERE admission_id = ?').all(p.admissionId) as any[];
    const admission = rowToAdmission(r, dx);
    const stored = loadValues(db, p.admissionId)[p.admissionId] ?? [];
    const ds = loadDataset(db);
    return loadModules(db).filter(m => moduleApplies(m, admission)).map(m => {
      const values = valuesByKey(m, stored);
      const ctx = { admission, episodes: ds.episodes.filter(e => e.admissionId === admission.id), cultures: ds.cultures.filter(c => c.admissionId === admission.id), values, now: now() };
      return {
        module: { ...m, params: m.params.filter(x => !x.retiredAt || stored.some(v => v.paramId === x.id)) },
        /** Fields added after this admission: hidden by default, available to back-fill. */
        notCollected: m.params.filter(x => !x.retiredAt && !wasCollected(x, admission.admitAt) && !stored.some(v => v.paramId === x.id)).map(x => x.key),
        stored: stored.filter(v => v.paramId.startsWith(`${m.id}.`)),
        derived: computeDerived(m, ctx),
        completion: moduleCompletion(m, admission.admitAt, values),
        introducedAfterAdmission: m.params.some(x => !wasCollected(x, admission.admitAt) && !x.retiredAt),
      };
    });
  } },
  'values.set': { roles: CLINICAL, fn: (p, { db, session }) => tx(db, () => {
    getAdmissionRow(db, p.admissionId);
    const r = (() => { try { return setValue(db, p.admissionId, p.paramId, p.value, session.user!.id, p.recordedAt ?? null); } catch (e: any) { return fail(e.message); } })();
    const shown = r.value === null ? 'cleared' : Array.isArray(r.value) ? r.value.join(', ') : typeof r.value === 'boolean' ? (r.value ? 'yes' : 'no') : String(r.value);
    audit(db, session, 'update', 'module value', p.admissionId, `${admissionLabel(db, p.admissionId)}: ${r.def.label} = ${r.def.type === 'text' ? '(text)' : shown}`);
    return true;
  }) },
  'values.delete': { roles: CLINICAL, fn: (p, { db, session }) => {
    const v = db.prepare('SELECT v.*, d.label FROM parameter_values v JOIN parameter_definitions d ON d.id = v.param_id WHERE v.id = ?').get(p.id) as any ?? fail('Value not found');
    db.prepare('UPDATE parameter_values SET deleted_at = ? WHERE id = ?').run(nowLocal(), p.id);
    audit(db, session, 'delete', 'module value', v.admission_id, `${admissionLabel(db, v.admission_id)}: removed ${v.label} entry`);
    return true;
  } },
  /** Module research view: per-variable description and optional group comparison. Aggregates only. */
  'research.module': { roles: ALL, fn: (p, { db, session, now }) => {
    const m = loadModules(db, { includeInactive: true }).find(x => x.id === p.moduleId) ?? fail('Module not found');
    const inRange = (admitAt: string) => (!p.from || admitAt.slice(0, 10) >= p.from) && (!p.to || admitAt.slice(0, 10) <= p.to);
    const cases = buildCases(m, loadDataset(db), loadValues(db), now(), inRange);
    const outcomes: string[] = Array.isArray(p.outcomes) && p.outcomes.length ? p.outcomes : m.outcomes;
    const comparison = p.groupBy ? compareGroups(m, cases, p.groupBy, outcomes) : null;
    if (comparison) audit(db, session, 'query', 'research', m.id, `Compared ${m.label} outcomes by "${comparison.groupLabel}" (${cases.length} admissions)`);
    return {
      module: m, n: cases.length, discharged: cases.filter(c => c.admission.dischargeAt).length,
      completion: cases.length ? cases.filter(c => moduleCompletion(m, c.admission.admitAt, c.values).missingRequired.length === 0).length / cases.length * 100 : null,
      variables: summarizeModule(m, cases), comparison,
      filters: { from: p.from ?? null, to: p.to ?? null, diagnoses: m.triggerDx, groupBy: p.groupBy ?? null, outcomes },
    };
  } },

  // Research Explorer (aggregates only; rows never leave the main process)
  'explorer.fields': { roles: ALL, fn: (_p, { db, now }) => buildExplorer(db, now()).fields },
  'explorer.run': { roles: ALL, fn: (p, { db, session, now }) => {
    const { fields, rows } = buildExplorer(db, now());
    const spec = (() => { try { return validateSpec(p.spec, fields); } catch (e: any) { return fail(e.message); } })();
    const result = runCohort(spec, fields, rows);
    audit(db, session, 'query', 'explorer', null, `${p.source === 'ai' ? 'AI-assisted query' : 'Cohort query'}: ${describeSpec(spec, fields).join('; ').slice(0, 400)} → n = ${result.n}`);
    return { ...result, narrative: narrate(result), dataAsOf: nowLocal() };
  } },
  'cohorts.list': { roles: ALL, fn: (_p, { db }) => (db.prepare('SELECT c.*, u.display_name AS author FROM saved_cohorts c LEFT JOIN users u ON u.id = c.created_by ORDER BY c.updated_at DESC').all() as any[])
    .map(r => ({ id: r.id, name: r.name, spec: JSON.parse(r.spec), author: r.author, createdBy: r.created_by, updatedAt: r.updated_at })) },
  'cohorts.save': { roles: ALL, fn: (p, { db, session, now }) => {
    const name = String(p.name ?? '').trim();
    if (name.length < 2) fail('Give the cohort a name');
    const { fields } = buildExplorer(db, now());
    const spec = (() => { try { return validateSpec(p.spec, fields); } catch (e: any) { return fail(e.message); } })();
    const t = nowLocal();
    if (p.id) {
      const r = db.prepare('SELECT created_by FROM saved_cohorts WHERE id = ?').get(p.id) as any ?? fail('Cohort not found');
      if (r.created_by !== session.user!.id && session.user!.role !== 'admin') fail('Only the author or an admin can change this cohort');
      db.prepare('UPDATE saved_cohorts SET name = ?, spec = ?, updated_at = ? WHERE id = ?').run(name, JSON.stringify(spec), t, p.id);
    } else db.prepare('INSERT INTO saved_cohorts(id, name, spec, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?)').run(p.id = randomUUID(), name, JSON.stringify(spec), session.user!.id, t, t);
    audit(db, session, 'update', 'cohort', p.id, `Saved cohort "${name}"`);
    return { id: p.id };
  } },
  'cohorts.delete': { roles: ALL, fn: (p, { db, session }) => {
    const r = db.prepare('SELECT * FROM saved_cohorts WHERE id = ?').get(p.id) as any ?? fail('Cohort not found');
    if (r.created_by !== session.user!.id && session.user!.role !== 'admin') fail('Only the author or an admin can delete this cohort');
    db.prepare('DELETE FROM saved_cohorts WHERE id = ?').run(p.id);
    audit(db, session, 'delete', 'cohort', p.id, `Deleted cohort "${r.name}"`);
    return true;
  } },

  // Protocols / QI monitoring
  'protocols.list': { roles: ALL, fn: (_p, { db, session, now }) => {
    const { fields } = buildExplorer(db, now());
    const tp = timePoints(db);
    return {
      protocols: loadProtocols(db, session.user!.role === 'admin').map(p => ({
        ...p, ruleText: Object.fromEntries(p.rules.map(r => [r.id, describeRule(r, fields, tp)])),
        eligibilityText: p.eligibility.length ? p.eligibility.map(c => describeCondition(c, fields)).join(' AND ') : 'every admission',
      })),
      timePoints: tp,
    };
  } },
  'protocols.results': { roles: ALL, fn: (p, { db, session, now }) => {
    const t = now();
    const { cases } = buildProtocolCases(db, t);
    const end = toLocal(new Date(t)).slice(0, 7);
    const months = Array.from({ length: 12 }, (_, i) => shiftMonth(end, i - 11));
    const inRange = cases.filter(c => (!p?.from || c.admitAt.slice(0, 10) >= p.from) && (!p?.to || c.admitAt.slice(0, 10) <= p.to));
    return loadProtocols(db).filter(x => !p?.id || x.id === p.id).map(proto => {
      const r = evaluateProtocol(proto, inRange, months);
      // Case lists are for clinical review only; researchers get aggregates.
      return session.user!.role === 'researcher' ? { ...r, failures: [] } : { ...r, failures: r.failures.slice(0, 200) };
    });
  } },
  'protocols.save': { roles: ['admin'], fn: (p, { db, session, now }) => {
    const { fields } = buildExplorer(db, now());
    const v = (() => { try { return validateProtocol(p, fields, timePoints(db)); } catch (e: any) { return fail(e.message); } })();
    const t = nowLocal();
    let id = p.id as string | undefined;
    if (id) {
      if (!db.prepare('SELECT 1 FROM protocols WHERE id = ?').get(id)) fail('Protocol not found');
      db.prepare('UPDATE protocols SET name = ?, description = ?, eligibility = ?, rules = ?, active = ?, updated_at = ? WHERE id = ?')
        .run(v.name, v.description, JSON.stringify(v.eligibility), JSON.stringify(v.rules), v.active ? 1 : 0, t, id);
    } else {
      id = randomUUID();
      db.prepare('INSERT INTO protocols(id, name, description, eligibility, rules, active, built_in, created_at, updated_at) VALUES (?,?,?,?,?,?,0,?,?)')
        .run(id, v.name, v.description, JSON.stringify(v.eligibility), JSON.stringify(v.rules), v.active ? 1 : 0, t, t);
    }
    audit(db, session, p.id ? 'update' : 'add', 'protocol', id, `${p.id ? 'Updated' : 'Created'} protocol "${v.name}" (${v.rules.length} rules)`);
    return { id };
  } },
  'protocols.delete': { roles: ['admin'], fn: (p, { db, session }) => {
    const r = db.prepare('SELECT * FROM protocols WHERE id = ?').get(p.id) as any ?? fail('Protocol not found');
    if (r.built_in) fail('Built-in protocols can be deactivated but not deleted');
    db.prepare('DELETE FROM protocols WHERE id = ?').run(p.id);
    audit(db, session, 'delete', 'protocol', p.id, `Deleted protocol "${r.name}"`);
    return true;
  } },

  // AI natural-language queries (optional; translation only — see server/ai.ts)
  'ai.status': { roles: ALL, fn: (_p, { db, env }) => {
    const provider = aiProvider(db), info = AI_PROVIDERS[provider];
    return {
      enabled: getSetting(db, 'aiEnabled') === '1', provider, model: aiModel(db, provider), providerLabel: info.label,
      configured: !!env.secrets.load(info.keySetting), secureStorage: env.secrets.available(),
      providers: Object.values(AI_PROVIDERS).map(p => ({ id: p.id, label: p.label, models: p.models, model: aiModel(db, p.id), keyHint: p.keyHint, notice: p.notice, configured: !!env.secrets.load(p.keySetting) })),
    };
  } },
  'ai.configure': { roles: ['admin'], fn: (p, { db, session, env }) => {
    const changes: string[] = [];
    if (p.provider !== undefined) {
      if (!isProvider(p.provider)) fail('Unknown AI provider');
      setSetting(db, 'aiProvider', p.provider); changes.push(`provider ${AI_PROVIDERS[p.provider as AiProvider].label}`);
    }
    const target: AiProvider = isProvider(p.keyProvider) ? p.keyProvider : aiProvider(db);
    const info = AI_PROVIDERS[target];
    if (p.model !== undefined) {
      if (!info.models.includes(p.model)) fail(`Unknown model for ${info.label}`);
      setSetting(db, `aiModel:${target}`, p.model); changes.push(`model ${p.model}`);
    }
    if (typeof p.apiKey === 'string' && p.apiKey.trim()) {
      if (!env.secrets.available()) fail('This computer has no secure key storage, so an API key cannot be saved.');
      if (!info.keyPattern.test(p.apiKey.trim())) fail(`That does not look like a${/^[AEIOU]/.test(info.vendor) ? 'n' : ''} ${info.vendor} API key (${info.keyHint})`);
      env.secrets.save(info.keySetting, p.apiKey.trim()); changes.push(`${info.label} API key replaced`);
    }
    if (p.removeKey) { env.secrets.save(info.keySetting, null); changes.push(`${info.label} API key removed`); }
    if (typeof p.enabled === 'boolean') { setSetting(db, 'aiEnabled', p.enabled ? '1' : '0'); changes.push(p.enabled ? 'enabled' : 'disabled'); }
    audit(db, session, 'update', 'settings', null, `AI questions: ${changes.join(', ') || 'no change'}`);
    return true;
  } },
  'ai.ask': { roles: ALL, fn: async (p, { db, session, now, env }) => {
    if (getSetting(db, 'aiEnabled') !== '1') fail('AI questions are switched off. An administrator can enable them in Settings.');
    const provider = aiProvider(db), info = AI_PROVIDERS[provider];
    const apiKey = env.secrets.load(info.keySetting) ?? fail(`No ${info.label} API key is configured.`);
    const question = String(p.question ?? '').trim();
    if (question.length < 5) fail('Type a question');
    if (question.length > 600) fail('Keep the question under 600 characters');
    if (containsIdentifier(db, question)) {
      audit(db, session, 'blocked', 'ai', null, 'AI question blocked: it contained a patient identifier');
      fail('Your question contains a patient name or MRN. Remove identifiers — questions are sent to an external AI service.');
    }
    const { fields } = buildExplorer(db, now());
    try {
      const t = await translateQuestion(question, fields, toLocal(new Date(now())).slice(0, 10), apiKey, env.translator ?? TRANSLATORS[provider], aiModel(db, provider));
      audit(db, session, 'query', 'ai', null, `AI (${info.label}) translated a question into: ${t.description.join('; ').slice(0, 400)}`);
      return t;
    } catch (e: any) {
      if (e instanceof AiError) fail(e.message);
      throw e;
    }
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
  // Phone access (configured on the PC by an admin; never reachable from a phone)
  'mobile.devices': { roles: ['admin'], fn: (_p, { db }) => ({ devices: listDevices(db), showNames: getSetting(db, 'mobileShowNames', '0') === '1' }) },
  'mobile.pairingCode': { roles: ['admin'], fn: (_p, { db, session, now }) => {
    const r = createPairingCode(db, session.user!.id, now());
    audit(db, session, 'add', 'device', null, 'Created a phone pairing code (valid 10 min, single use)');
    return r;
  } },
  'mobile.revoke': { roles: ['admin'], fn: (p, { db, session, endDeviceSessions }) => {
    const d = (() => { try { return revokeDevice(db, String(p.id)); } catch (e: any) { return fail(e.message); } })();
    endDeviceSessions(d.id);
    audit(db, session, 'delete', 'device', d.id, `Revoked phone "${d.name}" — its sessions ended`);
    return d;
  } },
  'mobile.showNames': { roles: ['admin'], fn: (p, { db, session }) => {
    setSetting(db, 'mobileShowNames', p.on ? '1' : '0');
    audit(db, session, 'update', 'settings', null, `Patient names on phones ${p.on ? 'shown' : 'hidden'}`);
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

export function createApi(db: DB, nowFn: () => number = Date.now, envIn: Partial<ApiEnv> = {}) {
  const env: ApiEnv = { secrets: envIn.secrets ?? memorySecrets(), translator: envIn.translator ?? null };
  const local = newSession('desktop');
  const sessions = new Map<string, Session>([['local', local]]);
  const endDeviceSessions = (deviceId: string) => { for (const [k, s] of sessions) if (s.deviceId === deviceId) sessions.delete(k); };
  const get = (key: string) => sessions.get(key) ?? fail('SESSION_EXPIRED');
  /** Enforces the idle lock and role for any privileged call (API routes and desktop-only routes alike). */
  const authorize = (roles: Role[], key = 'local') => {
    const session = get(key);
    if (session.user && Date.now() - session.lastActivity > idleLimit(session)) {
      audit(db, session, 'lock', 'user', String(session.user.id), `${session.user.displayName} locked out after inactivity`);
      session.user = null;
    }
    if (!session.user) throw new ApiError('SESSION_EXPIRED');
    if (!roles.includes(session.user.role)) throw new ApiError('Your role does not allow this action');
    session.lastActivity = Date.now();
    return session;
  };
  return {
    /** The PC's own session. */
    get session() { return local; },
    authorize,
    /** A new phone session (token kept in the phone's memory only). Stale phone sessions are pruned here. */
    openSession(device: { id: string; name: string }) {
      const t = Date.now();
      for (const [k, s] of sessions) if (s.channel === 'mobile' && s.lastActivity < t - (s.user ? 12 * 3_600_000 : 30 * 60_000)) sessions.delete(k);
      const token = randomUUID() + randomUUID().replace(/-/g, '');
      sessions.set(token, newSession('mobile', device));
      return token;
    },
    sessionFor: (key: string) => sessions.get(key) ?? null,
    endDeviceSessions,
    async call(method: string, params?: unknown, key = 'local') {
      const route = routes[method];
      if (!route) throw new ApiError(`Unknown method ${method}`);
      const session = get(key);
      if (session.channel === 'mobile' && !MOBILE_METHODS.has(method)) throw new ApiError('This is available on the PICU PC only');
      if (route.roles !== 'public') authorize(route.roles, key);
      return route.fn(params ?? {}, { db, session, now: nowFn, env, endDeviceSessions });
    },
  };
}
