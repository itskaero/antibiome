// ═══════════════════════════════════════════════════════════
//  Parameter & disease-module engine (pure, shared by server and UI).
//
//  • A module is data: a label, the diagnoses that trigger it (none = every
//    admission) and a list of parameter definitions. Admins add modules and
//    parameters at runtime; nothing here needs a code change.
//  • Every parameter records the date it was introduced. Admissions before that
//    date are "not collected" (NC), never "no"/"0", so research can restrict to
//    the period in which a field existed.
//  • Semantic edits (type, unit, range, removed options) bump the version; each
//    value stores the version it was entered under.
//  • Derived values come from a fixed, safe registry computed from core data
//    (episodes, cultures, outcome), so modules never re-ask what core captures.
// ═══════════════════════════════════════════════════════════
import type { Admission, Culture, Episode } from './types';
import { DAY_MS, ms } from './time';
import { fisherExact, mannWhitney, medianIqr } from './stats';

export const PARAM_TYPES = ['number', 'boolean', 'choice', 'multi', 'date', 'datetime', 'text'] as const;
export type ParamType = typeof PARAM_TYPES[number];
export const PARAM_TYPE_LABEL: Record<ParamType, string> = {
  number: 'Number', boolean: 'Yes / no', choice: 'Single choice', multi: 'Multiple choice', date: 'Date', datetime: 'Date & time', text: 'Short text',
};

export const CAPTURE_STAGES = ['admission', 'discharge', 'daily', 'any'] as const;
export type CaptureStage = typeof CAPTURE_STAGES[number];
export const CAPTURE_LABEL: Record<CaptureStage, string> = {
  admission: 'At admission', discharge: 'At discharge', daily: 'Repeated (time series)', any: 'Any time during stay',
};

/** Show a field only when another field in the same module has a given value. */
export interface ShowIf { param: string; equals?: string | boolean; includes?: string }

export interface ParamDef {
  /** Globally unique: `${moduleId}.${key}` */
  id: string;
  moduleId: string;
  key: string;
  label: string;
  type: ParamType;
  unit: string | null;
  options: string[];
  min: number | null;
  max: number | null;
  /** Number of decimals allowed for numbers (0 = integer). */
  decimals: number;
  capture: CaptureStage;
  required: boolean;
  help: string | null;
  showIf: ShowIf | null;
  sort: number;
  version: number;
  /** YYYY-MM-DD — admissions before this date were not asked. */
  introducedAt: string;
  retiredAt: string | null;
}

export interface ModuleDef {
  id: string;
  label: string;
  description: string | null;
  /** Diagnosis codes that switch the module on (primary or secondary). Empty = applies to every admission. */
  triggerDx: string[];
  /** Derived values (from DERIVED) shown on the module card and available as outcomes. */
  derived: string[];
  /** Parameter keys / derived ids the research view offers as outcomes and exposures. */
  outcomes: string[];
  exposures: string[];
  active: boolean;
  builtIn: boolean;
  introducedAt: string;
  params: ParamDef[];
}

export type ParamValue = number | boolean | string | string[];
export interface StoredValue { id: string; paramId: string; paramVersion: number; value: ParamValue; recordedAt: string | null }

// ── Validation ───────────────────────────────────────────────

export function validateValue(def: ParamDef, raw: unknown): ParamValue {
  const fail = (m: string): never => { throw new Error(`${def.label}: ${m}`); };
  switch (def.type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (raw === '' || raw == null || !Number.isFinite(n)) fail('enter a number');
      if (def.min != null && n < def.min) fail(`must be ≥ ${def.min}${def.unit ? ` ${def.unit}` : ''}`);
      if (def.max != null && n > def.max) fail(`must be ≤ ${def.max}${def.unit ? ` ${def.unit}` : ''}`);
      const f = 10 ** Math.max(0, def.decimals);
      return Math.round(n * f) / f;
    }
    case 'boolean':
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === 'yes') return true;
      if (raw === 'false' || raw === 'no') return false;
      return fail('choose yes or no');
    case 'choice':
      if (typeof raw !== 'string' || !def.options.includes(raw)) fail('choose one of the listed options');
      return raw as string;
    case 'multi': {
      if (!Array.isArray(raw) || !raw.length) fail('choose at least one option');
      const arr = [...new Set(raw as unknown[])];
      if (arr.some(v => typeof v !== 'string' || !def.options.includes(v))) fail('unknown option');
      return def.options.filter(o => arr.includes(o)); // canonical order
    }
    case 'date':
      if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) fail('enter a date');
      return raw as string;
    case 'datetime':
      if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) fail('enter a date and time');
      return raw as string;
    case 'text': {
      const s = String(raw ?? '').trim();
      if (!s) fail('enter text');
      return s.slice(0, 300);
    }
  }
}

/** Is a definition change semantic (meaning old values could be read differently)? */
export function isSemanticChange(prev: ParamDef, next: Pick<ParamDef, 'type' | 'unit' | 'min' | 'max' | 'options' | 'decimals'>): boolean {
  if (prev.type !== next.type || (prev.unit ?? '') !== (next.unit ?? '')) return true;
  if (prev.min !== next.min || prev.max !== next.max || prev.decimals !== next.decimals) return true;
  return prev.options.some(o => !next.options.includes(o)); // removing/renaming an option changes meaning; adding does not
}

export const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'field';

// ── Applicability & visibility ──────────────────────────────

export function moduleApplies(m: ModuleDef, a: Pick<Admission, 'primaryDx' | 'secondaryDx'>): boolean {
  if (!m.active) return false;
  if (!m.triggerDx.length) return true;
  return m.triggerDx.includes(a.primaryDx) || a.secondaryDx.some(c => m.triggerDx.includes(c));
}

export function isVisible(def: ParamDef, valuesByKey: Record<string, ParamValue | undefined>): boolean {
  if (!def.showIf) return true;
  const v = valuesByKey[def.showIf.param];
  if (v === undefined) return false;
  if (def.showIf.includes !== undefined) return Array.isArray(v) ? v.includes(def.showIf.includes) : v === def.showIf.includes;
  if (def.showIf.equals !== undefined) return v === def.showIf.equals;
  return v !== false;
}

/** Was this parameter part of the form when the patient was admitted? */
export const wasCollected = (def: ParamDef, admitAt: string) => admitAt.slice(0, 10) >= def.introducedAt && (!def.retiredAt || admitAt.slice(0, 10) < def.retiredAt);

// ── Derived values (safe registry; no user code is ever evaluated) ──

export interface DerivedCtx { admission: Admission; episodes: Episode[]; cultures: Culture[]; values: Record<string, ParamValue | undefined>; now: number }
export interface DerivedDef { id: string; label: string; kind: 'boolean' | 'number'; unit?: string; needs?: string; fn: (c: DerivedCtx) => number | boolean | null }

const epEnd = (e: Episode, c: DerivedCtx) => (e.endAt ? ms(e.endAt) : c.admission.dischargeAt ? ms(c.admission.dischargeAt) : c.now);
const days = (eps: Episode[], c: DerivedCtx) => eps.reduce((s, e) => s + Math.max(0, epEnd(e, c) - ms(e.startAt)), 0) / DAY_MS;
const firstAbx = (c: DerivedCtx) => c.episodes.filter(e => e.kind === 'abx').map(e => ms(e.startAt)).sort((a, b) => a - b)[0];

export const DERIVED: Record<string, DerivedDef> = {
  mv_required: { id: 'mv_required', label: 'Mechanical ventilation', kind: 'boolean', fn: c => c.episodes.some(e => e.kind === 'resp' && e.detail === 'MV') },
  mv_days: { id: 'mv_days', label: 'Ventilation days', kind: 'number', unit: 'd', fn: c => Math.round(days(c.episodes.filter(e => e.kind === 'resp' && e.detail === 'MV'), c) * 10) / 10 },
  niv_failure: {
    id: 'niv_failure', label: 'NIV/HFNC failure (escalated to ventilation)', kind: 'boolean',
    fn: c => {
      const resp = c.episodes.filter(e => e.kind === 'resp').sort((a, b) => a.startAt.localeCompare(b.startAt));
      const firstNon = resp.findIndex(e => e.detail === 'NIV' || e.detail === 'HFNC');
      return firstNon === -1 ? null : resp.slice(firstNon + 1).some(e => e.detail === 'MV');
    },
  },
  vaso_required: { id: 'vaso_required', label: 'Vasoactive support', kind: 'boolean', fn: c => c.episodes.some(e => e.kind === 'vaso') },
  vaso_days: { id: 'vaso_days', label: 'Vasoactive days', kind: 'number', unit: 'd', fn: c => Math.round(days(c.episodes.filter(e => e.kind === 'vaso'), c) * 10) / 10 },
  abx_dot: {
    id: 'abx_dot', label: 'Antimicrobial days of therapy', kind: 'number', unit: 'd',
    fn: c => c.episodes.filter(e => e.kind === 'abx').reduce((s, e) => s + Math.max(1, Math.ceil((epEnd(e, c) - ms(e.startAt)) / DAY_MS)), 0),
  },
  culture_positive: { id: 'culture_positive', label: 'Culture positive', kind: 'boolean', fn: c => (c.cultures.length ? c.cultures.some(x => x.organism) : null) },
  culture_before_abx: {
    id: 'culture_before_abx', label: 'Culture taken before first antimicrobial', kind: 'boolean',
    fn: c => {
      const abx = firstAbx(c);
      if (abx === undefined || !c.cultures.length) return null;
      // Cultures are recorded by date, so a culture on the same calendar day as the first dose counts as "before".
      return c.cultures.some(x => ms(x.collectedAt.slice(0, 10)) <= abx);
    },
  },
  time_to_abx_min: {
    id: 'time_to_abx_min', label: 'Time from recognition to first antimicrobial', kind: 'number', unit: 'min', needs: 'recognised_at',
    fn: c => {
      const t0 = c.values.recognised_at, abx = firstAbx(c);
      if (typeof t0 !== 'string' || abx === undefined) return null;
      return Math.round((abx - ms(t0)) / 60_000);
    },
  },
  hughes_improvement: {
    id: 'hughes_improvement', label: 'Hughes grade improvement', kind: 'number', needs: 'hughes_admission, hughes_discharge',
    fn: c => (typeof c.values.hughes_admission === 'number' && typeof c.values.hughes_discharge === 'number' ? c.values.hughes_admission - c.values.hughes_discharge : null),
  },
  los_days: { id: 'los_days', label: 'PICU length of stay', kind: 'number', unit: 'd', fn: c => Math.round(((c.admission.dischargeAt ? ms(c.admission.dischargeAt) : c.now) - ms(c.admission.admitAt)) / DAY_MS * 10) / 10 },
  died: { id: 'died', label: 'Died in PICU', kind: 'boolean', fn: c => (c.admission.dischargeAt ? c.admission.disposition === 'Died' : null) },
};

export function computeDerived(m: ModuleDef, ctx: DerivedCtx): Record<string, number | boolean | null> {
  const out: Record<string, number | boolean | null> = {};
  m.derived.forEach(id => { const d = DERIVED[id]; if (d) { try { out[id] = d.fn(ctx); } catch { out[id] = null; } } });
  return out;
}

/** Completion of a module for one admission: required, visible, non-daily fields that have a value. */
export function moduleCompletion(m: ModuleDef, admitAt: string, valuesByKey: Record<string, ParamValue | undefined>) {
  const asked = m.params.filter(p => !p.retiredAt && wasCollected(p, admitAt) && p.capture !== 'daily' && isVisible(p, valuesByKey));
  const required = asked.filter(p => p.required);
  const filled = (list: ParamDef[]) => list.filter(p => valuesByKey[p.key] !== undefined).length;
  return { asked: asked.length, filled: filled(asked), required: required.length, requiredFilled: filled(required), missingRequired: required.filter(p => valuesByKey[p.key] === undefined) };
}

// ── Research summary (descriptive by default; association only when tested) ──

export interface ModuleCase { admission: Admission; values: Record<string, ParamValue | undefined>; derived: Record<string, number | boolean | null> }

export interface VariableSummary {
  id: string; label: string; kind: 'number' | 'boolean' | 'categorical' | 'other';
  /** n with a value / n eligible (asked and visible) / n not collected (before introduction). */
  n: number; eligible: number; notCollected: number;
  numeric?: { median: number; q1: number; q3: number; min: number; max: number };
  yes?: number;
  counts?: { option: string; n: number }[];
}

export interface GroupComparison {
  groupBy: string; groupLabel: string;
  groups: { key: string; n: number }[];
  outcomes: {
    id: string; label: string; kind: 'number' | 'boolean';
    cells: { key: string; n: number; yes?: number; median?: number; q1?: number; q3?: number }[];
    test: { name: string; p: number } | null;
  }[];
  claim: 'DESCRIPTIVE' | 'ASSOCIATION';
  caveats: string[];
}

function describe(id: string, label: string, kind: VariableSummary['kind'], vals: unknown[], eligible: number, notCollected: number, options?: string[]): VariableSummary {
  const present = vals.filter(v => v !== undefined && v !== null);
  const s: VariableSummary = { id, label, kind, n: present.length, eligible, notCollected };
  if (kind === 'number') {
    const nums = present.filter((v): v is number => typeof v === 'number');
    const mi = medianIqr(nums);
    if (mi) s.numeric = { median: mi.median, q1: mi.q1, q3: mi.q3, min: Math.min(...nums), max: Math.max(...nums) };
  } else if (kind === 'boolean') s.yes = present.filter(v => v === true).length;
  else if (kind === 'categorical') {
    const c: Record<string, number> = {};
    present.forEach(v => (Array.isArray(v) ? v : [v]).forEach(o => { c[String(o)] = (c[String(o)] ?? 0) + 1; }));
    s.counts = (options ?? Object.keys(c)).map(o => ({ option: o, n: c[o] ?? 0 })).filter(x => x.n > 0 || options);
  }
  return s;
}

export function summarizeModule(m: ModuleDef, cases: ModuleCase[]): VariableSummary[] {
  const out: VariableSummary[] = [];
  m.params.forEach(p => {
    if (p.type === 'text') return; // free text is not analysed (and may be identifying)
    const collected = cases.filter(c => wasCollected(p, c.admission.admitAt) || c.values[p.key] !== undefined);
    const eligible = collected.filter(c => isVisible(p, c.values));
    const kind = p.type === 'number' ? 'number' : p.type === 'boolean' ? 'boolean' : p.type === 'choice' || p.type === 'multi' ? 'categorical' : 'other';
    out.push(describe(p.key, `${p.label}${p.unit ? ` (${p.unit})` : ''}`, kind, eligible.map(c => c.values[p.key]), eligible.length, cases.length - collected.length, p.options));
  });
  m.derived.forEach(id => {
    const d = DERIVED[id];
    if (!d) return;
    const vals = cases.map(c => c.derived[id]);
    out.push(describe(id, `${d.label}${d.unit ? ` (${d.unit})` : ''}`, d.kind, vals, vals.filter(v => v !== null && v !== undefined).length, 0));
  });
  return out;
}

const groupKeyOf = (v: ParamValue | undefined): string =>
  v === undefined ? 'Not recorded' : Array.isArray(v) ? (v.length ? v.join(' + ') : 'None') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);

/** Compare outcomes across groups of an exposure (choice / multi / boolean parameter). */
export function compareGroups(m: ModuleDef, cases: ModuleCase[], groupBy: string, outcomeIds: string[]): GroupComparison | null {
  const exposure = m.params.find(p => p.key === groupBy);
  if (!exposure || !['choice', 'multi', 'boolean'].includes(exposure.type)) return null;
  const inScope = cases.filter(c => wasCollected(exposure, c.admission.admitAt) || c.values[groupBy] !== undefined);
  const byGroup: Record<string, ModuleCase[]> = {};
  inScope.forEach(c => (byGroup[groupKeyOf(c.values[groupBy])] ??= []).push(c));
  const groups = Object.entries(byGroup).sort((a, b) => b[1].length - a[1].length).map(([key, list]) => ({ key, n: list.length }));

  const outcomeDefs = outcomeIds.map(id => {
    const p = m.params.find(x => x.key === id);
    if (p && (p.type === 'number' || p.type === 'boolean')) return { id, label: `${p.label}${p.unit ? ` (${p.unit})` : ''}`, kind: p.type as 'number' | 'boolean', get: (c: ModuleCase) => c.values[id] };
    const d = DERIVED[id];
    if (d) return { id, label: `${d.label}${d.unit ? ` (${d.unit})` : ''}`, kind: d.kind, get: (c: ModuleCase) => c.derived[id] };
    return null;
  }).filter(Boolean) as { id: string; label: string; kind: 'number' | 'boolean'; get: (c: ModuleCase) => unknown }[];

  // Formal tests only for exactly two recorded groups with ≥ 3 patients each.
  const testable = groups.filter(g => g.key !== 'Not recorded' && g.n >= 3);
  const twoGroups = testable.length === 2 ? testable.map(g => byGroup[g.key]) : null;

  const outcomes = outcomeDefs.map(o => {
    const cells = groups.map(g => {
      const vals = byGroup[g.key].map(o.get).filter(v => v !== null && v !== undefined);
      if (o.kind === 'boolean') return { key: g.key, n: vals.length, yes: vals.filter(v => v === true).length };
      const mi = medianIqr(vals as number[]);
      return { key: g.key, n: vals.length, ...(mi ? { median: mi.median, q1: mi.q1, q3: mi.q3 } : {}) };
    });
    let test: GroupComparison['outcomes'][number]['test'] = null;
    if (twoGroups) {
      const [a, b] = twoGroups.map(list => list.map(o.get).filter(v => v !== null && v !== undefined));
      if (o.kind === 'boolean' && a.length && b.length) {
        const ya = a.filter(v => v === true).length, yb = b.filter(v => v === true).length;
        test = { name: "Fisher's exact", p: fisherExact(ya, a.length - ya, yb, b.length - yb) };
      } else if (o.kind === 'number' && a.length >= 3 && b.length >= 3) {
        test = { name: 'Mann–Whitney U (normal approx.)', p: mannWhitney(a as number[], b as number[]).p };
      }
    }
    return { id: o.id, label: o.label, kind: o.kind, cells, test };
  });

  const tested = outcomes.some(o => o.test);
  return {
    groupBy, groupLabel: exposure.label, groups, outcomes,
    claim: tested ? 'ASSOCIATION' : 'DESCRIPTIVE',
    caveats: [
      'Retrospective observational data: differences between groups are not evidence that a treatment caused an outcome.',
      'Confounding by indication is likely — sicker patients tend to receive different treatment.',
      ...(tested ? ['Several outcomes were tested; some p-values below 0.05 are expected by chance alone.'] : ['Formal tests run only when exactly two recorded groups each have at least 3 patients.']),
      ...(inScope.length < cases.length ? [`${cases.length - inScope.length} admissions predate the "${exposure.label}" field and are excluded.`] : []),
    ],
  };
}
