// Repository for modules, parameter definitions and values.
import { randomUUID } from 'node:crypto';
import type { DB } from './db';
import { BUILT_IN_MODULES } from '../shared/builtinModules';
import {
  DERIVED, PARAM_TYPES, CAPTURE_STAGES, computeDerived, isSemanticChange, moduleApplies, moduleCompletion, slugify, validateValue, wasCollected,
  type ModuleCase, type ModuleDef, type ParamDef, type ParamValue, type StoredValue,
} from '../shared/modules';
import { DX_BY_CODE } from '../shared/reference';
import { nowLocal, toDateStr } from '../shared/time';
import type { Dataset } from '../shared/types';

const J = <T,>(s: string | null, d: T): T => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

function rowToParam(r: any): ParamDef {
  return {
    id: r.id, moduleId: r.module_id, key: r.key, label: r.label, type: r.type, unit: r.unit, options: J(r.options, []),
    min: r.min, max: r.max, decimals: r.decimals, capture: r.capture, required: !!r.required, help: r.help,
    showIf: J(r.show_if, null), sort: r.sort, version: r.version, introducedAt: r.introduced_at, retiredAt: r.retired_at,
  };
}

export function loadModules(db: DB, opts: { includeInactive?: boolean } = {}): ModuleDef[] {
  const params = (db.prepare('SELECT * FROM parameter_definitions ORDER BY sort, created_at').all() as any[]).map(rowToParam);
  return (db.prepare(`SELECT * FROM modules ${opts.includeInactive ? '' : 'WHERE active = 1'} ORDER BY built_in DESC, rowid`).all() as any[]).map(r => ({
    id: r.id, label: r.label, description: r.description, triggerDx: J(r.trigger_dx, []), derived: J(r.derived, []),
    outcomes: J(r.outcomes, []), exposures: J(r.exposures, []), active: !!r.active, builtIn: !!r.built_in, introducedAt: r.introduced_at,
    params: params.filter(p => p.moduleId === r.id),
  }));
}

/**
 * Insert built-in modules/params that are missing. Never overwrites local edits.
 * On an empty database they count as present from the start of data collection; when a release adds
 * a module to a database that already holds admissions, it is stamped with today's date so earlier
 * admissions are correctly reported as "not collected".
 */
export const SINCE_START = '2000-01-01';
export function ensureBuiltInModules(db: DB, introducedAt?: string) {
  introducedAt ??= (db.prepare('SELECT COUNT(*) n FROM admissions').get() as any).n ? toDateStr(new Date()) : SINCE_START;
  const t = nowLocal();
  const hasModule = db.prepare('SELECT 1 FROM modules WHERE id = ?');
  const hasParam = db.prepare('SELECT 1 FROM parameter_definitions WHERE id = ?');
  BUILT_IN_MODULES.forEach(m => {
    if (!hasModule.get(m.id)) {
      db.prepare('INSERT INTO modules(id, label, description, trigger_dx, derived, outcomes, exposures, active, built_in, introduced_at, created_at) VALUES (?,?,?,?,?,?,?,1,1,?,?)')
        .run(m.id, m.label, m.description, JSON.stringify(m.triggerDx), JSON.stringify(m.derived), JSON.stringify(m.outcomes), JSON.stringify(m.exposures), introducedAt, t);
    }
    m.params.forEach((p, i) => {
      const id = `${m.id}.${p.key}`;
      if (hasParam.get(id)) return;
      insertParam(db, {
        id, moduleId: m.id, key: p.key, label: p.label, type: p.type, unit: p.unit ?? null, options: p.options ?? [], min: p.min ?? null, max: p.max ?? null,
        decimals: p.decimals ?? 1, capture: p.capture, required: !!p.required, help: p.help ?? null, showIf: p.showIf ?? null, sort: i * 10,
        version: 1, introducedAt, retiredAt: null,
      }, null);
    });
  });
}

function insertParam(db: DB, p: ParamDef, userId: number | null) {
  db.prepare(`INSERT INTO parameter_definitions(id, module_id, key, label, type, unit, options, min, max, decimals, capture, required, help, show_if, sort, version, introduced_at, retired_at, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    p.id, p.moduleId, p.key, p.label, p.type, p.unit, JSON.stringify(p.options), p.min, p.max, p.decimals, p.capture, p.required ? 1 : 0,
    p.help, p.showIf ? JSON.stringify(p.showIf) : null, p.sort, p.version, p.introducedAt, p.retiredAt, nowLocal());
  recordVersion(db, p, userId);
}
const recordVersion = (db: DB, p: ParamDef, userId: number | null) =>
  db.prepare('INSERT OR REPLACE INTO parameter_versions(param_id, version, definition, created_by, created_at) VALUES (?,?,?,?,?)')
    .run(p.id, p.version, JSON.stringify(p), userId, nowLocal());

// ── Admin: modules & parameters ─────────────────────────────

export function saveModule(db: DB, input: any): { id: string; created: boolean } {
  const label = String(input.label ?? '').trim();
  if (label.length < 2) throw new Error('Module name is required');
  const triggerDx = [...new Set<string>(input.triggerDx ?? [])].filter(c => DX_BY_CODE[c]);
  const derived = [...new Set<string>(input.derived ?? [])].filter(d => DERIVED[d]);
  const list = (v: unknown) => JSON.stringify([...new Set((Array.isArray(v) ? v : []).map(String))]);
  if (input.id) {
    const r = db.prepare('SELECT * FROM modules WHERE id = ?').get(input.id) as any;
    if (!r) throw new Error('Module not found');
    db.prepare('UPDATE modules SET label = ?, description = ?, trigger_dx = ?, derived = ?, outcomes = ?, exposures = ?, active = ? WHERE id = ?')
      .run(label, input.description || null, JSON.stringify(triggerDx), JSON.stringify(derived), list(input.outcomes), list(input.exposures), input.active === false ? 0 : 1, input.id);
    return { id: input.id, created: false };
  }
  let id = slugify(label);
  for (let i = 2; db.prepare('SELECT 1 FROM modules WHERE id = ?').get(id); i++) id = `${slugify(label)}_${i}`;
  db.prepare('INSERT INTO modules(id, label, description, trigger_dx, derived, outcomes, exposures, active, built_in, introduced_at, created_at) VALUES (?,?,?,?,?,?,?,1,0,?,?)')
    .run(id, label, input.description || null, JSON.stringify(triggerDx), JSON.stringify(derived), list(input.outcomes), list(input.exposures), toDateStr(new Date()), nowLocal());
  return { id, created: true };
}

function normaliseParamInput(input: any, existing?: ParamDef): Omit<ParamDef, 'id' | 'moduleId' | 'key' | 'version' | 'introducedAt' | 'retiredAt' | 'sort'> {
  const type = input.type ?? existing?.type;
  if (!PARAM_TYPES.includes(type)) throw new Error('Choose a field type');
  const capture = input.capture ?? existing?.capture ?? 'any';
  if (!CAPTURE_STAGES.includes(capture)) throw new Error('Choose when the field is captured');
  const label = String(input.label ?? existing?.label ?? '').trim();
  if (label.length < 2) throw new Error('Field label is required');
  const options = (type === 'choice' || type === 'multi')
    ? [...new Set<string>((input.options ?? existing?.options ?? []).map((o: unknown) => String(o).trim()).filter(Boolean))] : [];
  if ((type === 'choice' || type === 'multi') && options.length < 2) throw new Error('Add at least two options');
  const num = (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v));
  const min = type === 'number' ? num(input.min ?? existing?.min) : null, max = type === 'number' ? num(input.max ?? existing?.max) : null;
  if (min != null && max != null && min > max) throw new Error('Minimum is above maximum');
  if (type === 'text' && capture === 'daily') throw new Error('Free text cannot be a repeated field');
  return {
    label, type, capture, options, min, max,
    unit: type === 'number' ? (String(input.unit ?? existing?.unit ?? '').trim() || null) : null,
    decimals: type === 'number' ? Math.max(0, Math.min(4, Number(input.decimals ?? existing?.decimals ?? 1))) : 0,
    required: !!(input.required ?? existing?.required),
    help: String(input.help ?? existing?.help ?? '').trim() || null,
    showIf: input.showIf === null ? null : (input.showIf ?? existing?.showIf ?? null),
  };
}

/** Create or edit a parameter. Semantic edits bump the version (old values keep their version). */
export function saveParam(db: DB, input: any, userId: number | null): { id: string; version: number; bumped: boolean } {
  const module = db.prepare('SELECT * FROM modules WHERE id = ?').get(input.moduleId) as any;
  if (!module) throw new Error('Module not found');
  if (input.id) {
    const existing = db.prepare('SELECT * FROM parameter_definitions WHERE id = ?').get(input.id) as any;
    if (!existing) throw new Error('Field not found');
    const prev = rowToParam(existing);
    const next = normaliseParamInput(input, prev);
    const hasValues = !!db.prepare('SELECT 1 FROM parameter_values WHERE param_id = ? AND deleted_at IS NULL').get(prev.id);
    if (prev.type !== next.type && hasValues) throw new Error('This field already has data; its type cannot change. Retire it and add a new field instead.');
    const bumped = hasValues && isSemanticChange(prev, next);
    const version = bumped ? prev.version + 1 : prev.version;
    db.prepare(`UPDATE parameter_definitions SET label=?, type=?, unit=?, options=?, min=?, max=?, decimals=?, capture=?, required=?, help=?, show_if=?, version=? WHERE id=?`)
      .run(next.label, next.type, next.unit, JSON.stringify(next.options), next.min, next.max, next.decimals, next.capture, next.required ? 1 : 0,
        next.help, next.showIf ? JSON.stringify(next.showIf) : null, version, prev.id);
    recordVersion(db, { ...prev, ...next, version }, userId);
    return { id: prev.id, version, bumped };
  }
  const next = normaliseParamInput(input);
  const key = slugify(input.key || next.label);
  const id = `${module.id}.${key}`;
  if (db.prepare('SELECT 1 FROM parameter_definitions WHERE id = ?').get(id)) throw new Error(`A field with key "${key}" already exists in this module`);
  const sort = ((db.prepare('SELECT MAX(sort) s FROM parameter_definitions WHERE module_id = ?').get(module.id) as any)?.s ?? 0) + 10;
  // Default: asked from today. An admin who will back-fill older admissions can choose an earlier date.
  const introducedAt = /^\d{4}-\d{2}-\d{2}$/.test(String(input.introducedAt ?? '')) && input.introducedAt <= toDateStr(new Date()) ? input.introducedAt : toDateStr(new Date());
  insertParam(db, { ...next, id, moduleId: module.id, key, sort, version: 1, introducedAt, retiredAt: null }, userId);
  return { id, version: 1, bumped: false };
}

export function setParamRetired(db: DB, id: string, retired: boolean) {
  const r = db.prepare('SELECT * FROM parameter_definitions WHERE id = ?').get(id) as any;
  if (!r) throw new Error('Field not found');
  db.prepare('UPDATE parameter_definitions SET retired_at = ? WHERE id = ?').run(retired ? toDateStr(new Date()) : null, id);
  return rowToParam(r);
}

// ── Values ───────────────────────────────────────────────────

export function loadValues(db: DB, admissionId?: string): Record<string, StoredValue[]> {
  const rows = (admissionId
    ? db.prepare('SELECT * FROM parameter_values WHERE admission_id = ? AND deleted_at IS NULL ORDER BY recorded_at, created_at').all(admissionId)
    : db.prepare('SELECT * FROM parameter_values WHERE deleted_at IS NULL ORDER BY recorded_at, created_at').all()) as any[];
  const out: Record<string, StoredValue[]> = {};
  rows.forEach(r => (out[r.admission_id] ??= []).push({ id: r.id, paramId: r.param_id, paramVersion: r.param_version, value: J(r.value, null as any), recordedAt: r.recorded_at }));
  return out;
}

/** Latest value per key for one module (repeated fields: the last recorded value). */
export function valuesByKey(m: ModuleDef, stored: StoredValue[] = []): Record<string, ParamValue | undefined> {
  const out: Record<string, ParamValue | undefined> = {};
  m.params.forEach(p => {
    const vs = stored.filter(v => v.paramId === p.id);
    if (vs.length) out[p.key] = vs[vs.length - 1].value;
  });
  return out;
}

/**
 * Set (or clear with value === null) a value. Single-value fields are replaced (the previous row is
 * soft-deleted, so history survives); repeated fields append a time-stamped row.
 */
export function setValue(db: DB, admissionId: string, paramId: string, raw: unknown, userId: number | null, recordedAt?: string | null): { def: ParamDef; value: ParamValue | null } {
  const row = db.prepare('SELECT * FROM parameter_definitions WHERE id = ?').get(paramId) as any;
  if (!row) throw new Error('Unknown field');
  const def = rowToParam(row);
  if (def.retiredAt) throw new Error(`${def.label} has been retired`);
  const t = nowLocal();
  if (def.capture !== 'daily') db.prepare('UPDATE parameter_values SET deleted_at = ? WHERE admission_id = ? AND param_id = ? AND deleted_at IS NULL').run(t, admissionId, paramId);
  if (raw === null || raw === undefined || raw === '' || (Array.isArray(raw) && !raw.length)) {
    if (def.capture === 'daily') throw new Error('Remove repeated values individually');
    return { def, value: null };
  }
  const value = validateValue(def, raw);
  if (def.capture === 'daily' && (!recordedAt || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(recordedAt))) throw new Error('A time is required for repeated values');
  db.prepare('INSERT INTO parameter_values(id, admission_id, param_id, param_version, value, recorded_at, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(randomUUID(), admissionId, paramId, def.version, JSON.stringify(value), def.capture === 'daily' ? (recordedAt ?? null) : null, userId, t);
  return { def, value };
}

/** Build per-module research cases from the de-identified dataset. */
export function buildCases(m: ModuleDef, ds: Dataset, allValues: Record<string, StoredValue[]>, now: number, filter: (admitAt: string) => boolean = () => true): ModuleCase[] {
  return ds.admissions.filter(a => moduleApplies({ ...m, active: true }, a) && filter(a.admitAt)).map(a => {
    const values = valuesByKey(m, allValues[a.id]);
    const ctx = { admission: a, episodes: ds.episodes.filter(e => e.admissionId === a.id), cultures: ds.cultures.filter(c => c.admissionId === a.id), values, now };
    return { admission: a, values, derived: computeDerived(m, ctx) };
  });
}

/** Data-quality: discharged admissions whose module is missing required fields (only fields that existed at admission). */
export function moduleIssues(modules: ModuleDef[], ds: Dataset, allValues: Record<string, StoredValue[]>) {
  const out: { id: string; severity: 'warn'; rule: string; admissionId: string; message: string }[] = [];
  ds.admissions.filter(a => a.dischargeAt).forEach(a => modules.forEach(m => {
    if (!moduleApplies(m, a)) return;
    const c = moduleCompletion(m, a.admitAt, valuesByKey(m, allValues[a.id]));
    if (c.missingRequired.length) out.push({
      id: `moduleIncomplete:${a.id}:${m.id}`, severity: 'warn', rule: 'moduleIncomplete', admissionId: a.id,
      message: `${m.label}: missing ${c.missingRequired.map(p => p.label).join(', ')}`,
    });
  }));
  return out;
}

// ── Research export columns ─────────────────────────────────
// Cell codes: value · "" = not recorded · "NC" = field did not exist when the patient was admitted
// · "NA" = module not applicable to this admission. Dates become day offsets from admission.

const CORE_DERIVED = new Set(['mv_days', 'vaso_days', 'los_days', 'died', 'abx_dot', 'mv_required', 'vaso_required']);

export interface DictRow { column: string; module: string; label: string; type: string; unit: string; codes: string; capture: string; introduced: string; versions: string }

export function moduleExportColumns(db: DB, modules: ModuleDef[], ds: Dataset, allValues: Record<string, StoredValue[]>, now: number) {
  const versionsOf = db.prepare('SELECT GROUP_CONCAT(version) v FROM parameter_versions WHERE param_id = ?');
  const cols: { name: string; dict: DictRow; cell: (a: Dataset['admissions'][number]) => string }[] = [];
  const dayOffset = (a: Dataset['admissions'][number], v: string) => (Math.round((new Date(v.length === 10 ? `${v}T00:00` : v).getTime() - new Date(a.admitAt).getTime()) / 864e5 * 10) / 10).toString();
  const fmt = (v: ParamValue, type: string, a: Dataset['admissions'][number]) =>
    Array.isArray(v) ? v.join(';') : typeof v === 'boolean' ? (v ? '1' : '0') : type === 'date' || type === 'datetime' ? dayOffset(a, String(v)) : String(v);

  modules.forEach(m => {
    const applies = (a: Dataset['admissions'][number]) => moduleApplies({ ...m, active: true }, a);
    m.params.filter(p => p.type !== 'text').forEach(p => {
      const base = `${m.id}__${p.key}`;
      const dict = (column: string, label: string, codes: string): DictRow => ({
        column, module: m.label, label, type: p.type, unit: p.unit ?? '', codes, capture: p.capture,
        introduced: p.introducedAt, versions: (versionsOf.get(p.id) as any)?.v ?? '1',
      });
      const pre = (a: Dataset['admissions'][number], vs: StoredValue[]) => (!applies(a) ? 'NA' : !vs.length && !wasCollected(p, a.admitAt) ? 'NC' : null);
      const codes = p.type === 'boolean' ? '1 = yes, 0 = no' : p.type === 'multi' ? `; separated: ${p.options.join(' | ')}` : p.type === 'choice' ? p.options.join(' | ')
        : p.type === 'date' || p.type === 'datetime' ? 'days from PICU admission' : p.min != null || p.max != null ? `range ${p.min ?? ''}–${p.max ?? ''}` : '';
      if (p.capture === 'daily') {
        const series = (a: Dataset['admissions'][number]) => (allValues[a.id] ?? []).filter(v => v.paramId === p.id);
        cols.push({ name: `${base}_n`, dict: dict(`${base}_n`, `${p.label} — number of measurements`, 'count'), cell: a => pre(a, series(a)) ?? String(series(a).length) });
        cols.push({ name: `${base}_first`, dict: dict(`${base}_first`, `${p.label} — first value`, codes), cell: a => { const s = series(a); return pre(a, s) ?? (s[0] ? fmt(s[0].value, p.type, a) : ''); } });
        cols.push({ name: `${base}_last`, dict: dict(`${base}_last`, `${p.label} — last value`, codes), cell: a => { const s = series(a); return pre(a, s) ?? (s.length ? fmt(s[s.length - 1].value, p.type, a) : ''); } });
        if (p.type === 'number') {
          cols.push({ name: `${base}_max`, dict: dict(`${base}_max`, `${p.label} — highest value`, codes), cell: a => { const s = series(a); return pre(a, s) ?? (s.length ? String(Math.max(...s.map(v => v.value as number))) : ''); } });
        }
      } else {
        cols.push({
          name: base, dict: dict(base, p.label, codes),
          cell: a => { const vs = (allValues[a.id] ?? []).filter(v => v.paramId === p.id); return pre(a, vs) ?? (vs.length ? fmt(vs[vs.length - 1].value, p.type, a) : ''); },
        });
      }
    });
    m.derived.filter(id => !CORE_DERIVED.has(id) && DERIVED[id]).forEach(id => {
      const d = DERIVED[id];
      const name = `${m.id}__${id}`;
      cols.push({
        name, dict: { column: name, module: m.label, label: `${d.label} (derived)`, type: d.kind, unit: d.unit ?? '', codes: d.kind === 'boolean' ? '1 = yes, 0 = no' : '', capture: 'derived', introduced: '', versions: '' },
        cell: a => {
          if (!applies(a)) return 'NA';
          const values = valuesByKey(m, allValues[a.id]);
          const v = computeDerived({ ...m, derived: [id] }, { admission: a, episodes: ds.episodes.filter(e => e.admissionId === a.id), cultures: ds.cultures.filter(c => c.admissionId === a.id), values, now })[id];
          return v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? '1' : '0') : String(v);
        },
      });
    });
  });
  return cols;
}
