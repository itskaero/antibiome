// ═══════════════════════════════════════════════════════════
//  Protocol / quality-improvement engine (pure).
//  A protocol is data: who it applies to (eligibility conditions) and measurable rules.
//  Conditions use the same validated language as the Research Explorer, so anything the
//  Explorer can see, a protocol can measure. This is QI MONITORING of local practice against
//  local protocols — it never recommends treatment for an individual patient.
// ═══════════════════════════════════════════════════════════
import { describeCondition, matches, validateSpec, type Condition, type ExplorerField, type Row } from './explorer';

/** Timestamps available to time-window rules (ms since epoch; null = did not happen). */
export const TIME_POINTS: Record<string, string> = {
  admission: 'PICU admission',
  first_abx: 'First antimicrobial',
  first_vaso: 'First vasoactive',
  first_mv: 'Start of mechanical ventilation',
  first_culture_sent: 'First culture sent',
  first_vitals: 'First vital signs recorded',
};

export type Rule =
  | { id: string; label: string; kind: 'condition'; condition: Condition; target: number; missing: 'fail' | 'exclude' }
  | { id: string; label: string; kind: 'implies'; if: Condition; then: Condition; target: number; missing: 'fail' | 'exclude' }
  | { id: string; label: string; kind: 'time_to'; anchor: string; event: string; withinMinutes: number; target: number; missing: 'fail' | 'exclude' };

export interface Protocol {
  id: string; name: string; description: string | null;
  eligibility: Condition[];
  rules: Rule[];
  active: boolean; builtIn: boolean;
}

export interface ProtocolCase { id: string; label: string; admitAt: string; row: Row; times: Record<string, number | null> }

export type Outcome = 'met' | 'not_met' | 'not_recorded' | 'not_applicable';

const hasValue = (row: Row, field: string) => { const v = row[field]; return v !== undefined && v !== null && !(Array.isArray(v) && !v.length); };
/** Operators whose meaning is about presence, so a missing value is a real answer. */
const PRESENCE_OPS = new Set(['exists', 'missing', 'excludes']);

export function evaluateRule(rule: Rule, c: ProtocolCase): Outcome {
  const missing = (): Outcome => (rule.missing === 'fail' ? 'not_met' : 'not_recorded');
  if (rule.kind === 'condition') {
    if (!PRESENCE_OPS.has(rule.condition.op) && !hasValue(c.row, rule.condition.field)) return missing();
    return matches(c.row, rule.condition) ? 'met' : 'not_met';
  }
  if (rule.kind === 'implies') {
    if (!hasValue(c.row, rule.if.field) && !PRESENCE_OPS.has(rule.if.op)) return 'not_applicable';
    if (!matches(c.row, rule.if)) return 'not_applicable';
    if (!PRESENCE_OPS.has(rule.then.op) && !hasValue(c.row, rule.then.field)) return missing();
    return matches(c.row, rule.then) ? 'met' : 'not_met';
  }
  const a = c.times[rule.anchor];
  if (a == null) return missing(); // e.g. time-zero not documented
  const e = c.times[rule.event];
  if (e == null) return 'not_met'; // the event never happened
  return (e - a) / 60_000 <= rule.withinMinutes ? 'met' : 'not_met';
}

export interface RuleResult { id: string; label: string; target: number; met: number; notMet: number; notRecorded: number; notApplicable: number; pct: number | null }
export interface ProtocolResult {
  protocol: Protocol; eligible: number;
  bundle: { met: number; evaluable: number; pct: number | null };
  rules: RuleResult[];
  monthly: { month: string; eligible: number; bundlePct: number | null; rulePct: Record<string, number | null> }[];
  failures: { id: string; label: string; admitAt: string; failed: string[]; notRecorded: string[] }[];
}

const pct = (a: number, b: number) => (b ? (a / b) * 100 : null);

export function evaluateProtocol(p: Protocol, cases: ProtocolCase[], months: string[]): ProtocolResult {
  const eligible = cases.filter(c => p.eligibility.every(cond => matches(c.row, cond)));
  const outcomes = eligible.map(c => ({ c, o: p.rules.map(r => evaluateRule(r, c)) }));
  const rules: RuleResult[] = p.rules.map((r, i) => {
    const count = (k: Outcome) => outcomes.filter(x => x.o[i] === k).length;
    const met = count('met'), notMet = count('not_met');
    return { id: r.id, label: r.label, target: r.target, met, notMet, notRecorded: count('not_recorded'), notApplicable: count('not_applicable'), pct: pct(met, met + notMet) };
  });
  // Bundle: every applicable rule met; a case with an unrecorded rule is not evaluable for the bundle.
  const bundleOf = (o: Outcome[]) => (o.includes('not_met') ? 'no' : o.includes('not_recorded') ? 'unknown' : 'yes');
  const bundleMet = outcomes.filter(x => bundleOf(x.o) === 'yes').length;
  const bundleEval = outcomes.filter(x => bundleOf(x.o) !== 'unknown').length;
  const monthly = months.map(m => {
    const inM = outcomes.filter(x => x.c.admitAt.slice(0, 7) === m);
    const be = inM.filter(x => bundleOf(x.o) !== 'unknown');
    return {
      month: m, eligible: inM.length, bundlePct: pct(be.filter(x => bundleOf(x.o) === 'yes').length, be.length),
      rulePct: Object.fromEntries(p.rules.map((r, i) => { const met = inM.filter(x => x.o[i] === 'met').length, no = inM.filter(x => x.o[i] === 'not_met').length; return [r.id, pct(met, met + no)]; })),
    };
  });
  const failures = outcomes.filter(x => x.o.some(o => o === 'not_met' || o === 'not_recorded'))
    .sort((a, b) => b.c.admitAt.localeCompare(a.c.admitAt))
    .map(x => ({ id: x.c.id, label: x.c.label, admitAt: x.c.admitAt, failed: p.rules.filter((_, i) => x.o[i] === 'not_met').map(r => r.label), notRecorded: p.rules.filter((_, i) => x.o[i] === 'not_recorded').map(r => r.label) }));
  return { protocol: p, eligible: eligible.length, bundle: { met: bundleMet, evaluable: bundleEval, pct: pct(bundleMet, bundleEval) }, rules, monthly, failures };
}

// ── Validation & description ────────────────────────────────

export function validateProtocol(raw: any, fields: ExplorerField[], timePoints: Record<string, string>): Omit<Protocol, 'id' | 'builtIn'> {
  const fail = (m: string): never => { throw new Error(m); };
  const name = String(raw?.name ?? '').trim();
  if (name.length < 3) fail('Protocol name is required');
  const cond = (c: unknown, ctx: string) => { try { return validateSpec({ include: [c] }, fields).include[0]; } catch (e: any) { return fail(`${ctx}: ${e.message.replace(/^Condition 1: /, '')}`); } };
  const eligibility = (Array.isArray(raw?.eligibility) ? raw.eligibility : []).map((c: unknown, i: number) => cond(c, `Eligibility ${i + 1}`));
  const rulesIn = Array.isArray(raw?.rules) ? raw.rules : [];
  if (!rulesIn.length) fail('Add at least one rule');
  if (rulesIn.length > 12) fail('At most 12 rules');
  const ids = new Set<string>();
  const rules: Rule[] = rulesIn.map((r: any, i: number) => {
    const ctx = `Rule ${i + 1}`;
    const label = String(r?.label ?? '').trim() || fail(`${ctx}: label is required`);
    let id = String(r?.id ?? '').trim() || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
    while (ids.has(id)) id = `${id}_`;
    ids.add(id);
    const target = Math.max(0, Math.min(100, Number(r?.target ?? 90)));
    const missing = r?.missing === 'fail' ? 'fail' : 'exclude';
    if (r?.kind === 'condition') return { id, label, kind: 'condition', condition: cond(r.condition, ctx), target, missing };
    if (r?.kind === 'implies') return { id, label, kind: 'implies', if: cond(r.if, `${ctx} (if)`), then: cond(r.then, `${ctx} (then)`), target, missing };
    if (r?.kind === 'time_to') {
      if (!timePoints[r.anchor]) fail(`${ctx}: unknown start point`);
      if (!timePoints[r.event]) fail(`${ctx}: unknown event`);
      const w = Number(r.withinMinutes);
      if (!Number.isFinite(w) || w < 0 || w > 60 * 24 * 14) fail(`${ctx}: time window must be 0–20160 minutes`);
      return { id, label, kind: 'time_to', anchor: r.anchor, event: r.event, withinMinutes: w, target, missing };
    }
    return fail(`${ctx}: unknown rule type`);
  });
  return { name, description: raw?.description ? String(raw.description).slice(0, 300) : null, eligibility, rules, active: raw?.active !== false };
}

export function describeRule(r: Rule, fields: ExplorerField[], timePoints: Record<string, string>): string {
  if (r.kind === 'condition') return describeCondition(r.condition, fields);
  if (r.kind === 'implies') return `if ${describeCondition(r.if, fields)}, then ${describeCondition(r.then, fields)}`;
  return `${timePoints[r.event] ?? r.event} within ${r.withinMinutes >= 120 && r.withinMinutes % 60 === 0 ? `${r.withinMinutes / 60} h` : `${r.withinMinutes} min`} of ${(timePoints[r.anchor] ?? r.anchor).toLowerCase()}`;
}

// ── Built-in protocols (seeded once; editable afterwards) ───

export const BUILT_IN_PROTOCOLS: Omit<Protocol, 'active' | 'builtIn'>[] = [
  {
    id: 'sepsis_bundle', name: 'Sepsis — first-hour bundle',
    description: 'Surviving Sepsis Campaign-style first-hour elements. Edit to match the local protocol.',
    eligibility: [{ field: 'any_dx', op: 'includes_any', value: ['SEPSIS', 'SEPTIC_SHOCK'] }],
    rules: [
      { id: 'abx_60', label: 'Antimicrobial within 60 min of recognition', kind: 'time_to', anchor: 'sepsis.recognised_at', event: 'first_abx', withinMinutes: 60, target: 80, missing: 'exclude' },
      { id: 'culture_first', label: 'Culture taken before first antimicrobial', kind: 'condition', condition: { field: 'culture_before_abx', op: 'is_true' }, target: 90, missing: 'fail' },
      { id: 'lactate', label: 'Lactate measured', kind: 'condition', condition: { field: 'sepsis.lactate_initial', op: 'exists' }, target: 90, missing: 'fail' },
      { id: 'fluids', label: 'Fluid bolus ≥ 20 mL/kg in first hour (if in shock)', kind: 'implies', if: { field: 'shock_on_arrival', op: 'is_true' }, then: { field: 'sepsis.early_fluids', op: 'is_true' }, target: 80, missing: 'exclude' },
    ],
  },
  {
    id: 'ventilation_safety', name: 'Ventilation safety',
    description: 'Ventilator-associated harms among ventilated patients.',
    eligibility: [{ field: 'mv_required', op: 'is_true' }],
    rules: [
      { id: 'no_unplanned_extubation', label: 'No unplanned extubation', kind: 'condition', condition: { field: 'complications', op: 'excludes', value: ['Unplanned extubation'] }, target: 98, missing: 'exclude' },
      { id: 'no_vap', label: 'No ventilator-associated pneumonia', kind: 'condition', condition: { field: 'complications', op: 'excludes', value: ['VAP'] }, target: 95, missing: 'exclude' },
      { id: 'no_reintubation', label: 'No reintubation within 48 h', kind: 'condition', condition: { field: 'complications', op: 'excludes', value: ['Reintubation <48h'] }, target: 95, missing: 'exclude' },
    ],
  },
  {
    id: 'stewardship', name: 'Antimicrobial stewardship',
    description: 'Microbiology before treatment, and Reserve agents backed by microbiology.',
    eligibility: [{ field: 'antimicrobials', op: 'exists' }],
    rules: [
      { id: 'culture_before', label: 'Culture obtained before first antimicrobial', kind: 'condition', condition: { field: 'culture_before_abx', op: 'is_true' }, target: 80, missing: 'fail' },
      { id: 'reserve_with_micro', label: 'Reserve agents used with a positive culture', kind: 'implies', if: { field: 'reserve_agent', op: 'is_true' }, then: { field: 'culture_positive', op: 'is_true' }, target: 90, missing: 'fail' },
    ],
  },
  {
    id: 'severity_documented', name: 'Severity documented (PIM3)',
    description: 'PIM3 recorded — required for risk-adjusted mortality.',
    eligibility: [],
    rules: [{ id: 'pim3', label: 'PIM3 recorded', kind: 'condition', condition: { field: 'pim3_risk', op: 'exists' }, target: 95, missing: 'fail' }],
  },
  {
    id: 'admission_vitals', name: 'Admission vital signs',
    description: 'A full set of vital signs on arrival. Admissions from before vitals recording began count as not met — choose a period from go-live.',
    eligibility: [],
    rules: [
      { id: 'vitals_60', label: 'Vital signs within 1 h of admission', kind: 'time_to', anchor: 'admission', event: 'first_vitals', withinMinutes: 60, target: 95, missing: 'fail' },
      { id: 'bp_adm', label: 'Blood pressure recorded at admission', kind: 'condition', condition: { field: 'vit_adm_sbp', op: 'exists' }, target: 90, missing: 'fail' },
      { id: 'spo2_adm', label: 'SpO₂ recorded at admission', kind: 'condition', condition: { field: 'vit_adm_spo2', op: 'exists' }, target: 95, missing: 'fail' },
    ],
  },
];
