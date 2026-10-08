// ═══════════════════════════════════════════════════════════
//  Research Explorer — cohort query DSL and executor (pure).
//
//  A CohortSpec is plain JSON. It is the ONLY thing that runs: the explorer UI builds it,
//  saved cohorts store it, and the AI layer may only propose one (validated here, shown to
//  the user in plain words, and confirmed before it runs). Rows hold no identifiers.
// ═══════════════════════════════════════════════════════════
import { chiSquareKx2, fisherExact, kruskalWallis, logisticRegression, mannWhitney, medianIqr, wilson, type LogisticResult } from './stats';

export type FieldKind = 'number' | 'boolean' | 'category' | 'set';
export interface ExplorerField {
  id: string; label: string; group: string; kind: FieldKind;
  /** Known values for category/set fields (display labels via optionLabels). */
  options?: string[]; optionLabels?: Record<string, string>; unit?: string;
  /** Text shown in the data dictionary / AI schema. */
  description?: string;
}
export type Row = Record<string, number | boolean | string | string[] | null | undefined> & { _admitAt: string };

export type Op = 'gte' | 'lte' | 'between' | 'is_true' | 'is_false' | 'in' | 'not_in' | 'includes_any' | 'includes_all' | 'excludes' | 'exists' | 'missing';
export interface Condition { field: string; op: Op; value?: number | string | (number | string)[] }
export interface CohortSpec {
  name?: string;
  from?: string | null; to?: string | null;
  include: Condition[];
  exclude: Condition[];
  groupBy?: string | null;
  outcomes: string[];
  describe: string[];
  /** Logistic regression: binary outcome ~ exposure (groupBy, 2 levels) + covariates. */
  regression?: { outcome: string; covariates: string[] } | null;
}

export const OPS_BY_KIND: Record<FieldKind, Op[]> = {
  number: ['gte', 'lte', 'between', 'exists', 'missing'],
  boolean: ['is_true', 'is_false', 'exists', 'missing'],
  category: ['in', 'not_in', 'exists', 'missing'],
  set: ['includes_any', 'includes_all', 'excludes', 'exists', 'missing'],
};
export const OP_LABEL: Record<Op, string> = {
  gte: '≥', lte: '≤', between: 'between', is_true: 'is yes', is_false: 'is no', in: 'is one of', not_in: 'is not', includes_any: 'includes any of',
  includes_all: 'includes all of', excludes: 'does not include', exists: 'is recorded', missing: 'is not recorded',
};
export const LIMITS = { conditions: 12, outcomes: 8, describe: 15, covariates: 6 };

// ── Validation (the gate the AI layer must pass) ─────────────

export function validateSpec(raw: unknown, fields: ExplorerField[]): CohortSpec {
  const byId = new Map(fields.map(f => [f.id, f]));
  const s = (raw ?? {}) as Partial<CohortSpec>;
  const fail = (m: string): never => { throw new Error(m); };
  const date = (v: unknown, name: string) => (v == null || v === '' ? null : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fail(`${name} must be a date (YYYY-MM-DD)`));
  const field = (id: unknown, ctx: string) => byId.get(String(id)) ?? fail(`${ctx}: unknown field "${String(id)}"`);
  const cond = (c: any, ctx: string): Condition => {
    const f = field(c?.field, ctx);
    if (!OPS_BY_KIND[f.kind].includes(c?.op)) fail(`${ctx}: "${OP_LABEL[c?.op as Op] ?? c?.op}" cannot be used with ${f.label}`);
    const op = c.op as Op;
    if (op === 'gte' || op === 'lte') { const n = Number(c.value); if (!Number.isFinite(n)) fail(`${ctx}: ${f.label} needs a number`); return { field: f.id, op, value: n }; }
    if (op === 'between') {
      const v: number[] = Array.isArray(c.value) ? c.value.map(Number) : [];
      if (v.length !== 2 || v.some(x => !Number.isFinite(x)) || v[0] > v[1]) fail(`${ctx}: ${f.label} needs a valid range`);
      return { field: f.id, op, value: v };
    }
    if (['in', 'not_in', 'includes_any', 'includes_all', 'excludes'].includes(op)) {
      const v: string[] = (Array.isArray(c.value) ? c.value : [c.value]).map(String).filter(Boolean);
      if (!v.length) fail(`${ctx}: choose at least one value for ${f.label}`);
      if (f.options) { const bad = v.filter(x => !f.options!.includes(x)); if (bad.length) fail(`${ctx}: ${f.label} has no value "${bad[0]}"`); }
      return { field: f.id, op, value: v };
    }
    return { field: f.id, op };
  };
  const list = (v: unknown, kinds: FieldKind[], max: number, ctx: string) => {
    const arr = Array.isArray(v) ? [...new Set(v.map(String))] : [];
    if (arr.length > max) fail(`${ctx}: at most ${max}`);
    arr.forEach(id => { const f = field(id, ctx); if (!kinds.includes(f.kind)) fail(`${ctx}: ${f.label} must be ${kinds.join(' or ')}`); });
    return arr;
  };
  const include = (Array.isArray(s.include) ? s.include : []).map((c, i) => cond(c, `Condition ${i + 1}`));
  const exclude = (Array.isArray(s.exclude) ? s.exclude : []).map((c, i) => cond(c, `Exclusion ${i + 1}`));
  if (include.length + exclude.length > LIMITS.conditions) fail(`At most ${LIMITS.conditions} conditions`);
  const groupBy = s.groupBy ? field(s.groupBy, 'Group by') : null;
  if (groupBy && groupBy.kind === 'number') fail('Group by needs a yes/no or category field');
  let regression: CohortSpec['regression'] = null;
  if (s.regression && (s.regression as any).outcome) {
    const o = field((s.regression as any).outcome, 'Regression outcome');
    if (o.kind !== 'boolean') fail('Regression outcome must be a yes/no field');
    if (!groupBy) fail('Regression needs an exposure (group by) field');
    regression = { outcome: o.id, covariates: list((s.regression as any).covariates, ['number', 'boolean', 'category'], LIMITS.covariates, 'Covariates') };
  }
  return {
    name: s.name ? String(s.name).slice(0, 120) : undefined,
    from: date(s.from, 'From'), to: date(s.to, 'To'),
    include, exclude, groupBy: groupBy?.id ?? null,
    outcomes: list(s.outcomes, ['number', 'boolean'], LIMITS.outcomes, 'Outcomes'),
    describe: list(s.describe, ['number', 'boolean', 'category', 'set'], LIMITS.describe, 'Describe'),
    regression,
  };
}

// ── Human-readable description (shown before anything runs) ─

const valueText = (f: ExplorerField, v: unknown) =>
  (Array.isArray(v) ? v : [v]).map(x => f.optionLabels?.[String(x)] ?? String(x)).join(f.kind === 'number' ? ' and ' : ', ');

export function describeCondition(c: Condition, fields: ExplorerField[]): string {
  const f = fields.find(x => x.id === c.field);
  if (!f) return c.field;
  if (c.op === 'exists' || c.op === 'missing' || c.op === 'is_true' || c.op === 'is_false') return `${f.label} ${OP_LABEL[c.op]}`;
  return `${f.label} ${OP_LABEL[c.op]} ${valueText(f, c.value)}${f.unit && f.kind === 'number' ? ` ${f.unit}` : ''}`;
}

export function describeSpec(spec: CohortSpec, fields: ExplorerField[]): string[] {
  const label = (id: string) => fields.find(f => f.id === id)?.label ?? id;
  const lines = [`Admissions ${spec.from ? `from ${spec.from}` : 'from the start of records'} ${spec.to ? `to ${spec.to}` : 'to today'}`];
  lines.push(spec.include.length ? `where ${spec.include.map(c => describeCondition(c, fields)).join(' AND ')}` : 'with no inclusion criteria (all admissions)');
  if (spec.exclude.length) lines.push(`excluding any where ${spec.exclude.map(c => describeCondition(c, fields)).join(' OR ')}`);
  if (spec.groupBy) lines.push(`grouped by ${label(spec.groupBy)}`);
  if (spec.outcomes.length) lines.push(`outcomes: ${spec.outcomes.map(label).join(', ')}`);
  if (spec.describe.length) lines.push(`describing: ${spec.describe.map(label).join(', ')}`);
  if (spec.regression) lines.push(`logistic regression of ${label(spec.regression.outcome)} on ${label(spec.groupBy!)}${spec.regression.covariates.length ? `, adjusted for ${spec.regression.covariates.map(label).join(', ')}` : ''}`);
  return lines;
}

// ── Execution ────────────────────────────────────────────────

export function matches(row: Row, c: Condition): boolean {
  const v = row[c.field];
  const has = v !== undefined && v !== null && !(Array.isArray(v) && !v.length);
  switch (c.op) {
    case 'exists': return has;
    case 'missing': return !has;
    case 'is_true': return v === true;
    case 'is_false': return v === false;
    case 'gte': return typeof v === 'number' && v >= (c.value as number);
    case 'lte': return typeof v === 'number' && v <= (c.value as number);
    case 'between': { const [a, b] = c.value as number[]; return typeof v === 'number' && v >= a && v <= b; }
    case 'in': return has && (c.value as string[]).includes(String(v));
    case 'not_in': return has && !(c.value as string[]).includes(String(v));
    case 'includes_any': return Array.isArray(v) && (c.value as string[]).some(x => v.includes(x));
    case 'includes_all': return Array.isArray(v) && (c.value as string[]).every(x => v.includes(x));
    case 'excludes': return Array.isArray(v) && !(c.value as string[]).some(x => v.includes(x));
  }
}

export interface VarSummary {
  field: string; label: string; kind: FieldKind; n: number; missing: number;
  numeric?: { median: number; q1: number; q3: number; mean: number; sd: number; min: number; max: number };
  yes?: number; ci?: [number, number];
  counts?: { value: string; label: string; n: number }[];
}
export interface OutcomeRow {
  field: string; label: string; kind: 'number' | 'boolean';
  cells: { group: string; n: number; yes?: number; pct?: number; median?: number; q1?: number; q3?: number }[];
  test: { name: string; p: number; note?: string } | null;
  effect?: { name: string; value: number; lo: number; hi: number } | null;
}
export interface CohortResult {
  spec: CohortSpec; description: string[];
  n: number; inRange: number;
  steps: { label: string; remaining: number }[];
  groups: { key: string; label: string; n: number }[];
  outcomes: OutcomeRow[];
  describe: VarSummary[];
  regression: (LogisticResult & { outcome: string; exposureLevel: string; reference: string; epv: number; refused?: string }) | null;
  claim: 'DESCRIPTIVE' | 'ASSOCIATION';
  caveats: string[];
}

const numStats = (vals: number[]) => {
  const mi = medianIqr(vals);
  if (!mi) return undefined;
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const sd = vals.length > 1 ? Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length - 1)) : 0;
  return { median: mi.median, q1: mi.q1, q3: mi.q3, mean, sd, min: Math.min(...vals), max: Math.max(...vals) };
};

function summarize(field: ExplorerField, rows: Row[]): VarSummary {
  const vals = rows.map(r => r[field.id]).filter(v => v !== undefined && v !== null && !(Array.isArray(v) && !v.length));
  const s: VarSummary = { field: field.id, label: field.label, kind: field.kind, n: vals.length, missing: rows.length - vals.length };
  if (field.kind === 'number') s.numeric = numStats(vals as number[]);
  else if (field.kind === 'boolean') { s.yes = vals.filter(v => v === true).length; s.ci = wilson(s.yes, vals.length); }
  else {
    const c: Record<string, number> = {};
    vals.forEach(v => (Array.isArray(v) ? v : [String(v)]).forEach(x => { c[x] = (c[x] ?? 0) + 1; }));
    s.counts = Object.entries(c).sort((a, b) => b[1] - a[1]).map(([value, n]) => ({ value, label: field.optionLabels?.[value] ?? value, n }));
  }
  return s;
}

const groupKey = (_f: ExplorerField, v: unknown): string =>
  v === undefined || v === null || (Array.isArray(v) && !v.length) ? '∅' : Array.isArray(v) ? [...v].sort().join(' + ') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v);
const groupLabel = (f: ExplorerField, key: string) =>
  key === '∅' ? 'Not recorded' : key === 'yes' ? 'Yes' : key === 'no' ? 'No' : key.split(' + ').map(k => f.optionLabels?.[k] ?? k).join(' + ');

export function runCohort(spec: CohortSpec, fields: ExplorerField[], allRows: Row[]): CohortResult {
  const byId = new Map(fields.map(f => [f.id, f]));
  const steps: CohortResult['steps'] = [];
  let rows = allRows.filter(r => (!spec.from || r._admitAt.slice(0, 10) >= spec.from) && (!spec.to || r._admitAt.slice(0, 10) <= spec.to));
  const inRange = rows.length;
  steps.push({ label: describeSpec(spec, fields)[0], remaining: rows.length });
  spec.include.forEach(c => { rows = rows.filter(r => matches(r, c)); steps.push({ label: `+ ${describeCondition(c, fields)}`, remaining: rows.length }); });
  spec.exclude.forEach(c => { rows = rows.filter(r => !matches(r, c)); steps.push({ label: `− excluding ${describeCondition(c, fields)}`, remaining: rows.length }); });

  const gf = spec.groupBy ? byId.get(spec.groupBy)! : null;
  const groupsMap = new Map<string, Row[]>();
  rows.forEach(r => { const k = gf ? groupKey(gf, r[gf.id]) : 'all'; (groupsMap.get(k) ?? groupsMap.set(k, []).get(k)!).push(r); });
  // Yes/no groupings always read "Yes vs No" (so effects are exposure vs reference); others by size; not-recorded last.
  const rank = (k: string) => (k === '∅' ? 2 : gf?.kind === 'boolean' ? (k === 'yes' ? 0 : 1) : 0);
  const groups = [...groupsMap.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || b[1].length - a[1].length)
    .map(([key, list]) => ({ key, label: gf ? groupLabel(gf, key) : 'Cohort', n: list.length }));
  const tested = groups.filter(g => g.key !== '∅' && g.n >= 3);

  const outcomes: OutcomeRow[] = spec.outcomes.map(id => {
    const f = byId.get(id)!;
    const valsOf = (key: string) => groupsMap.get(key)!.map(r => r[id]).filter(v => v !== undefined && v !== null);
    const cells = groups.map(g => {
      const vals = valsOf(g.key);
      if (f.kind === 'boolean') { const yes = vals.filter(v => v === true).length; return { group: g.label, n: vals.length, yes, pct: vals.length ? (yes / vals.length) * 100 : undefined }; }
      const mi = medianIqr(vals as number[]);
      return { group: g.label, n: vals.length, ...(mi ? { median: mi.median, q1: mi.q1, q3: mi.q3 } : {}) };
    });
    let test: OutcomeRow['test'] = null, effect: OutcomeRow['effect'] = null;
    if (gf && tested.length >= 2) {
      if (f.kind === 'boolean') {
        const tab = tested.map(g => { const v = valsOf(g.key); const y = v.filter(x => x === true).length; return [y, v.length - y] as [number, number]; });
        if (tested.length === 2) {
          const [[a, b], [c, d]] = tab;
          test = { name: "Fisher's exact", p: fisherExact(a, b, c, d) };
          // Risk ratio (group 1 vs group 2) with log-method 95% CI; 0.5 continuity correction on zero cells.
          const [aa, bb, cc, dd] = [a, b, c, d].map(x => (a * b * c * d === 0 ? x + 0.5 : x));
          const rr = (aa / (aa + bb)) / (cc / (cc + dd)), se = Math.sqrt(1 / aa - 1 / (aa + bb) + 1 / cc - 1 / (cc + dd));
          effect = { name: `Risk ratio (${groupLabel(gf, tested[0].key)} vs ${groupLabel(gf, tested[1].key)})`, value: rr, lo: rr * Math.exp(-1.96 * se), hi: rr * Math.exp(1.96 * se) };
        } else {
          const r = chiSquareKx2(tab);
          test = { name: `χ² (${r.df} df)`, p: r.p, note: r.minExpected < 5 ? 'Some expected counts < 5 — interpret with caution' : undefined };
        }
      } else {
        const samples = tested.map(g => valsOf(g.key) as number[]);
        if (samples.every(x => x.length >= 3)) test = tested.length === 2 ? { name: 'Mann–Whitney U', p: mannWhitney(samples[0], samples[1]).p } : { name: `Kruskal–Wallis (${tested.length - 1} df)`, p: kruskalWallis(samples).p };
      }
    }
    return { field: id, label: `${f.label}${f.unit ? ` (${f.unit})` : ''}`, kind: f.kind as 'number' | 'boolean', cells, test, effect };
  });

  const describe = spec.describe.map(id => summarize(byId.get(id)!, rows));

  // ── Regression ──
  let regression: CohortResult['regression'] = null;
  if (spec.regression && gf) {
    const levels = tested.slice(0, 2);
    const outcome = spec.regression.outcome;
    const base = { outcome, terms: [], n: 0, events: 0, converged: false, iterations: 0, warnings: [] as string[], exposureLevel: levels[0] ? groupLabel(gf, levels[0].key) : '', reference: levels[1] ? groupLabel(gf, levels[1].key) : '', epv: 0 };
    if (tested.length !== 2) regression = { ...base, refused: 'Regression needs an exposure with exactly two recorded groups (each with ≥ 3 patients).' };
    else {
      const covs = spec.regression.covariates.map(id => byId.get(id)!);
      // Category covariates → dummy variables against their most common level.
      const design: { name: string; get: (r: Row) => number | null }[] = [{ name: `${gf.label}: ${groupLabel(gf, levels[0].key)} vs ${groupLabel(gf, levels[1].key)}`, get: r => (groupKey(gf, r[gf.id]) === levels[0].key ? 1 : 0) }];
      covs.forEach(f => {
        if (f.kind === 'number') design.push({ name: f.label, get: r => (typeof r[f.id] === 'number' ? (r[f.id] as number) : null) });
        else if (f.kind === 'boolean') design.push({ name: f.label, get: r => (typeof r[f.id] === 'boolean' ? +(r[f.id] as boolean) : null) });
        else {
          const counts: Record<string, number> = {};
          rows.forEach(r => { const v = r[f.id]; if (v != null) counts[String(v)] = (counts[String(v)] ?? 0) + 1; });
          const levelsC = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k]) => k);
          levelsC.slice(1, 5).forEach(l => design.push({ name: `${f.label}: ${f.optionLabels?.[l] ?? l} (vs ${f.optionLabels?.[levelsC[0]] ?? levelsC[0]})`, get: r => (r[f.id] == null ? null : +(String(r[f.id]) === l)) }));
        }
      });
      const usable = rows.filter(r => [levels[0].key, levels[1].key].includes(groupKey(gf, r[gf.id])) && typeof r[outcome] === 'boolean' && design.every(d => d.get(r) !== null));
      const y = usable.map(r => +(r[outcome] as boolean));
      const events = Math.min(y.filter(v => v === 1).length, y.filter(v => v === 0).length);
      const epv = events / design.length;
      if (epv < 10) regression = { ...base, n: usable.length, events, epv, refused: `Too few events for ${design.length} predictor${design.length > 1 ? 's' : ''}: ${events} events gives ${epv.toFixed(1)} per variable (at least 10 needed). Remove covariates or widen the cohort.` };
      else regression = { ...logisticRegression(usable.map(r => design.map(d => d.get(r) as number)), y, design.map(d => d.name)), outcome, exposureLevel: base.exposureLevel, reference: base.reference, epv };
    }
  }

  const anyTest = outcomes.some(o => o.test) || !!(regression && !regression.refused);
  const caveats = [
    'Retrospective, routinely collected data from one unit: results describe what happened here and cannot show that a treatment or exposure caused an outcome.',
    ...(gf ? ['Groups differ in ways not recorded (confounding, especially by indication — sicker patients receive different care).'] : []),
    ...(anyTest ? [`${outcomes.filter(o => o.test).length + (regression && !regression.refused ? regression.terms.length : 0)} p-values were calculated; with many comparisons some will fall below 0.05 by chance. Treat them as hypothesis-generating.`] : []),
    ...(groups.some(g => g.key === '∅') ? ['Patients with the grouping field not recorded are shown separately and excluded from tests.'] : []),
    ...(rows.length < 30 ? ['Small cohort: estimates are imprecise — look at the confidence intervals, not just p-values.'] : []),
    ...(regression && !regression.refused ? ['Adjusted odds ratios only account for the covariates listed; unmeasured confounding remains.'] : []),
  ];
  return {
    spec, description: describeSpec(spec, fields), n: rows.length, inRange, steps, groups, outcomes, describe, regression,
    claim: anyTest ? 'ASSOCIATION' : 'DESCRIPTIVE', caveats,
  };
}
