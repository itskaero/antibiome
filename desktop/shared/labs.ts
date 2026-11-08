// ═══════════════════════════════════════════════════════════
//  Laboratory panels: grouping, reference flags, derived values and a paste parser.
//
//  Values are stored as vitals codes (shared/vitals.ts, group 'lab') in SI units. Reference
//  intervals are typical paediatric ranges for flagging only; every laboratory publishes its own,
//  so the UI says so and nothing here recommends treatment.
// ═══════════════════════════════════════════════════════════
import { VITALS, type LabPanel, type VitalCode, type VitalValues } from './vitals';

export const PANELS: { id: LabPanel; label: string; codes: VitalCode[] }[] = [
  { id: 'cbc', label: 'Blood count', codes: ['hb', 'wbc', 'neut', 'lymph', 'platelets'] },
  { id: 'renal', label: 'Renal', codes: ['urea', 'creat'] },
  { id: 'lytes', label: 'Electrolytes', codes: ['na', 'k', 'cl', 'hco3', 'ica', 'mg', 'po4'] },
  { id: 'gas', label: 'Blood gas', codes: ['ph', 'pco2', 'pao2', 'be', 'lactate'] },
  { id: 'lft', label: 'Liver', codes: ['alt', 'ast', 'bili', 'alb'] },
  { id: 'coag', label: 'Coagulation', codes: ['pt', 'inr', 'aptt', 'fibrinogen', 'ddimer'] },
  { id: 'inflam', label: 'Inflammation', codes: ['crp', 'pct'] },
];
export const LAB_PANEL_CODES: VitalCode[] = PANELS.flatMap(p => p.codes);
export const isLabSet = (v: VitalValues) => Object.keys(v).some(k => VITALS[k as VitalCode]?.group === 'lab');

// ── Reference intervals ──────────────────────────────────────
type Range = [number | null, number | null];
/** Age bands in months: < 1 month, 1–11 months, 1–5 years, 6–12 years, 13 years and over. */
const band = (ageMonths: number | null | undefined) => ageMonths == null ? 3 : ageMonths < 1 ? 0 : ageMonths < 12 ? 1 : ageMonths < 72 ? 2 : ageMonths < 156 ? 3 : 4;
const BANDED: Partial<Record<VitalCode, Range[]>> = {
  hb: [[135, 215], [95, 135], [110, 140], [115, 155], [120, 160]],
  wbc: [[9, 30], [6, 17.5], [5.5, 15.5], [4.5, 13.5], [4.5, 11]],
  neut: [[6, 26], [1, 8.5], [1.5, 8.5], [1.5, 8], [1.8, 8]],
  lymph: [[2, 11], [4, 13.5], [2, 9.5], [1.5, 6.5], [1.2, 5.2]],
  creat: [[27, 88], [14, 34], [18, 42], [27, 62], [44, 97]],
  po4: [[1.5, 2.8], [1.4, 2.2], [1.1, 2.0], [1.1, 1.9], [0.9, 1.6]],
  alt: [[null, 40], [null, 45], [null, 30], [null, 30], [null, 35]],
  ast: [[null, 75], [null, 60], [null, 45], [null, 40], [null, 35]],
};
const FIXED: Partial<Record<VitalCode, Range>> = {
  platelets: [150, 450], urea: [1.8, 6.4], na: [135, 145], k: [3.5, 5.2], cl: [98, 107], hco3: [22, 28], ica: [1.1, 1.35],
  mg: [0.7, 1.0], bili: [null, 21], alb: [35, 50], ph: [7.35, 7.45], pco2: [35, 45], pao2: [80, 100], be: [-2, 2], lactate: [null, 2],
  pt: [11, 14.5], inr: [0.8, 1.2], aptt: [25, 38], fibrinogen: [1.5, 4], ddimer: [null, 0.5], crp: [null, 5], pct: [null, 0.5], glucose: [3.9, 7.8],
};
/** Values that usually need a prompt look (phoned-through results in most laboratories). */
const CRITICAL: Partial<Record<VitalCode, Range>> = {
  hb: [70, 200], platelets: [20, 1000], wbc: [1, 50], neut: [0.5, null], na: [120, 160], k: [2.5, 6.5], ica: [0.8, 1.6], mg: [0.4, null], po4: [0.3, null],
  glucose: [2.6, 25], ph: [7.2, 7.6], pco2: [20, 70], lactate: [null, 4], hco3: [10, 40], inr: [null, 3], fibrinogen: [1, null], creat: [null, 300], bili: [null, 340],
};

export function refRange(code: VitalCode, ageMonths?: number | null): Range | null {
  return BANDED[code]?.[band(ageMonths)] ?? FIXED[code] ?? null;
}
export type LabFlag = 'LL' | 'L' | 'H' | 'HH';
/** H / L against the reference interval; HH / LL when beyond the critical limits. Neonatal bilirubin is not flagged (it needs a nomogram). */
export function labFlag(code: VitalCode, value: number | null | undefined, ageMonths?: number | null): LabFlag | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (code === 'bili' && ageMonths != null && ageMonths < 1) return null;
  const c = CRITICAL[code];
  if (c && c[0] != null && value < c[0]) return 'LL';
  if (c && c[1] != null && value > c[1]) return 'HH';
  const r = refRange(code, ageMonths);
  if (!r) return null;
  if (r[0] != null && value < r[0]) return 'L';
  if (r[1] != null && value > r[1]) return 'H';
  return null;
}
export const rangeLabel = (code: VitalCode, ageMonths?: number | null) => {
  const r = refRange(code, ageMonths); if (!r) return null;
  return r[0] == null ? `< ${r[1]}` : r[1] == null ? `> ${r[0]}` : `${r[0]}–${r[1]}`;
};

// ── Derived values ───────────────────────────────────────────
export interface Derived { id: string; label: string; value: number; unit: string; note: string }
export function derivedLabs(v: VitalValues, opts: { heightCm?: number | null } = {}): Derived[] {
  const out: Derived[] = [];
  if (v.na != null && v.cl != null && v.hco3 != null) out.push({ id: 'ag', label: 'Anion gap', value: Math.round(v.na - v.cl - v.hco3), unit: 'mmol/L', note: 'Na − (Cl + HCO₃); typical 8–16' });
  if (v.pao2 != null && v.fio2 != null) out.push({ id: 'pf', label: 'P/F ratio', value: Math.round(v.pao2 / (v.fio2 / 100)), unit: '', note: 'PaO₂ / FiO₂ (same set)' });
  if (v.creat != null && opts.heightCm) out.push({ id: 'egfr', label: 'eGFR (bedside Schwartz)', value: Math.round((36.5 * opts.heightCm) / v.creat), unit: 'mL/min/1.73m²', note: '36.5 × height (cm) / creatinine (µmol/L)' });
  if (v.urea != null && v.creat != null) out.push({ id: 'ucr', label: 'Urea : creatinine', value: Math.round((v.urea / v.creat) * 1000), unit: '', note: 'mmol/L : mmol/L' });
  return out;
}

// ── Paste a lab report ───────────────────────────────────────
// Names as they appear on reports (case-insensitive), and conversions from conventional units.
const NAMES: [VitalCode, RegExp][] = [
  ['hb', /\b(hb|hgb|ha?emoglobin)\b/i], ['wbc', /\b(wbc|tlc|white (blood )?cells?|total leu[ck]ocyte count|leu[ck]ocytes)\b/i],
  ['neut', /\b(anc|neutrophils?( abs(olute)?)?|abs(olute)? neutrophils?)\b/i], ['lymph', /\b(alc|lymphocytes?( abs(olute)?)?)\b/i],
  ['platelets', /\b(plt|platelets?( count)?)\b/i], ['urea', /\b(urea|bun|blood urea( nitrogen)?)\b/i], ['creat', /\b(creat(inine)?|cr)\b/i],
  ['na', /\b(na\+?|sodium)\b/i], ['k', /\b(k\+?|potassium)\b/i], ['cl', /\b(cl-?|chloride)\b/i], ['hco3', /\b(hco3-?|bicarb(onate)?|tco2|total co2)\b/i],
  ['ica', /\b(ica|ionis?ed ca(lcium)?|ca\+\+|ca2\+)\b/i], ['mg', /\b(mg\+?\+?|magnesium)\b/i], ['po4', /\b(po4|phosph(ate|orus))\b/i],
  ['alt', /\b(alt|sgpt)\b/i], ['ast', /\b(ast|sgot)\b/i], ['bili', /\b(t\.?\s?bili(rubin)?|total bilirubin|bilirubin( total)?|tsb)\b/i], ['alb', /\b(alb(umin)?)\b/i],
  ['ph', /\bph\b/i], ['pco2', /\b(p\s?co2|paco2)\b/i], ['pao2', /\b(p\s?o2|pao2)\b/i], ['be', /\b(be|base excess|beb|beecf)\b/i], ['lactate', /\b(lac(tate)?)\b/i],
  ['pt', /\b(pt|prothrombin time)\b/i], ['inr', /\binr\b/i], ['aptt', /\b(a?ptt|aptt|partial thromboplastin time)\b/i], ['fibrinogen', /\b(fibrinogen|fib)\b/i],
  ['ddimer', /\b(d[- ]?dimer)\b/i], ['crp', /\b(crp|c[- ]reactive protein)\b/i], ['pct', /\b(pct|procalcitonin)\b/i], ['glucose', /\b(glu(cose)?|bsr|rbs|blood sugar)\b/i],
];
type Conv = { unit: RegExp; factor: number; label: string };
const CONVERSIONS: Partial<Record<VitalCode, Conv[]>> = {
  hb: [{ unit: /g\/dl/i, factor: 10, label: 'g/dL' }],
  alb: [{ unit: /g\/dl/i, factor: 10, label: 'g/dL' }],
  creat: [{ unit: /mg\/dl/i, factor: 88.4, label: 'mg/dL' }],
  urea: [{ unit: /mg\/dl/i, factor: 0.1665, label: 'mg/dL' }],
  bili: [{ unit: /mg\/dl/i, factor: 17.1, label: 'mg/dL' }],
  glucose: [{ unit: /mg\/dl/i, factor: 1 / 18.016, label: 'mg/dL' }],
  mg: [{ unit: /mg\/dl/i, factor: 0.4114, label: 'mg/dL' }],
  po4: [{ unit: /mg\/dl/i, factor: 0.3229, label: 'mg/dL' }],
  ica: [{ unit: /mg\/dl/i, factor: 0.25, label: 'mg/dL' }],
  crp: [{ unit: /mg\/dl/i, factor: 10, label: 'mg/dL' }],
  pco2: [{ unit: /kpa/i, factor: 7.50062, label: 'kPa' }],
  pao2: [{ unit: /kpa/i, factor: 7.50062, label: 'kPa' }],
  fibrinogen: [{ unit: /mg\/dl/i, factor: 0.01, label: 'mg/dL' }],
};
/** Counts written per µL / mm³ (e.g. 12,500 or 2.1 lakh) become ×10⁹/L. */
const COUNT_CODES: VitalCode[] = ['wbc', 'neut', 'lymph', 'platelets'];

export interface ParsedLab { code: VitalCode; value: number; raw: string; note?: string }

export function parseLabText(text: string): { values: ParsedLab[]; unmatched: string[] } {
  const values = new Map<VitalCode, ParsedLab>();
  const unmatched: string[] = [];
  // One analyte per line or per "name: value" chunk; tables pasted from PDFs are usually line-based.
  const chunks = text.split(/\r?\n|;|\t{2,}|\s{3,}(?=[A-Za-z])/).map(s => s.trim()).filter(Boolean);
  for (const chunk of chunks) {
    let hit: VitalCode | null = null, at = -1, len = 0;
    for (const [code, re] of NAMES) {
      const m = re.exec(chunk);
      if (m && (hit == null || m.index < at || (m.index === at && m[0].length > len))) { hit = code; at = m.index; len = m[0].length; }
    }
    // The first number after the analyte name ("Hb (g/dL) 11.2  12-16" → 11.2, not the reference range).
    const after = hit != null ? chunk.slice(at + len) : '';
    const num = after.match(/(?:^|[^\d.])(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)\s*(lakh|lac)?/i);
    if (!hit || !num) { if (/\d/.test(chunk) && chunk.length < 80) unmatched.push(chunk); continue; }
    if (values.has(hit)) continue;
    let value = Number(num[1].replace(/,/g, ''));
    let note: string | undefined;
    const tail = after.slice((num.index ?? 0) + num[0].length, (num.index ?? 0) + num[0].length + 16);
    if (num[2]) { value = value * 100; note = 'lakh → ×10⁹/L'; }                    // 2.1 lakh/µL = 210 ×10⁹/L
    else if (COUNT_CODES.includes(hit) && value >= 1000) { value = value / 1000; note = 'per µL → ×10⁹/L'; }
    for (const c of CONVERSIONS[hit] ?? []) if (c.unit.test(tail) || c.unit.test(chunk)) { value = value * c.factor; note = `from ${c.label}`; break; }
    // No unit printed but the number only makes sense in conventional units (Hb 11.2, creatinine 0.6 …).
    if (!note) {
      if (hit === 'hb' && value < 25) { value *= 10; note = 'assumed g/dL'; }
      else if (hit === 'alb' && value < 7) { value *= 10; note = 'assumed g/dL'; }
      else if (hit === 'creat' && value < 15) { value *= 88.4; note = 'assumed mg/dL'; }
      else if (hit === 'bili' && value < 30 && /mg/i.test(text)) { value *= 17.1; note = 'assumed mg/dL'; }
      else if (hit === 'glucose' && value > 60) { value /= 18.016; note = 'assumed mg/dL'; }
    }
    const d = VITALS[hit];
    const f = 10 ** d.decimals;
    value = Math.round(value * f) / f;
    if (value < d.min || value > d.max) { unmatched.push(chunk); continue; }
    values.set(hit, { code: hit, value, raw: chunk, note });
  }
  return { values: [...values.values()], unmatched };
}
