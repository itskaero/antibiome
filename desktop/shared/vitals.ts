// ═══════════════════════════════════════════════════════════
//  Vital signs — recorded at key moments (admission, ad hoc), never as a full chart.
//  The worst value in the first 24 h is derived, not entered.
//
//  Age-specific thresholds: International Pediatric Sepsis Consensus Conference
//  (Goldstein B et al., Pediatr Crit Care Med 2005;6:2-8, Table 3). The 12–23-month gap
//  in that table is assigned to the 2–5-year band. Verify against the paper and local
//  practice before using flags for protocol measurement.
// ═══════════════════════════════════════════════════════════

export const VITAL_CODES = ['hr', 'rr', 'spo2', 'fio2', 'sbp', 'dbp', 'map', 'temp', 'crt', 'gcs', 'urine', 'glucose'] as const;
export type VitalCode = typeof VITAL_CODES[number];

export interface VitalDef { code: VitalCode; label: string; short: string; unit: string; min: number; max: number; decimals: number; worst: 'max' | 'min' | 'both' }
export const VITALS: Record<VitalCode, VitalDef> = {
  hr: { code: 'hr', label: 'Heart rate', short: 'HR', unit: '/min', min: 20, max: 300, decimals: 0, worst: 'max' },
  rr: { code: 'rr', label: 'Respiratory rate', short: 'RR', unit: '/min', min: 4, max: 150, decimals: 0, worst: 'max' },
  spo2: { code: 'spo2', label: 'SpO₂', short: 'SpO₂', unit: '%', min: 30, max: 100, decimals: 0, worst: 'min' },
  fio2: { code: 'fio2', label: 'FiO₂', short: 'FiO₂', unit: '%', min: 21, max: 100, decimals: 0, worst: 'max' },
  sbp: { code: 'sbp', label: 'Systolic BP', short: 'SBP', unit: 'mmHg', min: 10, max: 250, decimals: 0, worst: 'min' },
  dbp: { code: 'dbp', label: 'Diastolic BP', short: 'DBP', unit: 'mmHg', min: 5, max: 200, decimals: 0, worst: 'min' },
  map: { code: 'map', label: 'Mean arterial pressure', short: 'MAP', unit: 'mmHg', min: 8, max: 220, decimals: 0, worst: 'min' },
  temp: { code: 'temp', label: 'Temperature', short: 'Temp', unit: '°C', min: 25, max: 44, decimals: 1, worst: 'both' },
  crt: { code: 'crt', label: 'Capillary refill', short: 'CRT', unit: 's', min: 0, max: 15, decimals: 0, worst: 'max' },
  gcs: { code: 'gcs', label: 'Glasgow Coma Scale', short: 'GCS', unit: '', min: 3, max: 15, decimals: 0, worst: 'min' },
  urine: { code: 'urine', label: 'Urine output', short: 'UO', unit: 'mL/kg/h', min: 0, max: 20, decimals: 1, worst: 'min' },
  glucose: { code: 'glucose', label: 'Blood glucose', short: 'Glu', unit: 'mmol/L', min: 0.5, max: 60, decimals: 1, worst: 'both' },
};

export const VITAL_CONTEXTS = ['admission', 'routine', 'event'] as const;
export type VitalContext = typeof VITAL_CONTEXTS[number];
export const VITAL_CONTEXT_LABEL: Record<VitalContext, string> = { admission: 'Admission', routine: 'Routine', event: 'Deterioration / review' };

export type VitalValues = Partial<Record<VitalCode, number>>;
export interface VitalSet { id: string; admissionId: string; at: string; context: VitalContext; values: VitalValues }

/** Validate one set: plausible ranges, DBP < SBP, derived MAP when not entered. Abnormal-for-age values are allowed. */
export function validateVitals(raw: Record<string, unknown>): VitalValues {
  const out: VitalValues = {};
  for (const code of VITAL_CODES) {
    const v = raw?.[code];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    const d = VITALS[code];
    if (!Number.isFinite(n) || n < d.min || n > d.max) throw new Error(`${d.label} must be between ${d.min} and ${d.max}${d.unit ? ` ${d.unit}` : ''}`);
    const f = 10 ** d.decimals;
    out[code] = Math.round(n * f) / f;
  }
  if (out.sbp != null && out.dbp != null && out.dbp >= out.sbp) throw new Error('Diastolic BP must be lower than systolic BP');
  if (out.map == null && out.sbp != null && out.dbp != null) out.map = Math.round((out.sbp + 2 * out.dbp) / 3);
  if (!Object.keys(out).length) throw new Error('Enter at least one vital sign');
  return out;
}

// ── Age-specific thresholds (IPSCC 2005, Table 3) ─────────────

interface Band { label: string; maxMonths: number; tachy: number; brady: number | null; rr: number; sbpLow: number }
const BANDS: Band[] = [
  { label: '0–7 days', maxMonths: 0.25, tachy: 180, brady: 100, rr: 50, sbpLow: 65 },
  { label: '1 week–1 month', maxMonths: 1, tachy: 180, brady: 100, rr: 40, sbpLow: 75 },
  { label: '1 month–1 year', maxMonths: 12, tachy: 180, brady: 90, rr: 34, sbpLow: 100 },
  { label: '1–5 years', maxMonths: 72, tachy: 140, brady: null, rr: 22, sbpLow: 94 },
  { label: '6–12 years', maxMonths: 156, tachy: 130, brady: null, rr: 18, sbpLow: 105 },
  { label: '13–18 years', maxMonths: Infinity, tachy: 110, brady: null, rr: 14, sbpLow: 117 },
];
export const ageBand = (ageMonths: number) => BANDS.find(b => ageMonths < b.maxMonths) ?? BANDS[BANDS.length - 1];

export const VITAL_FLAGS = {
  tachycardia: 'Tachycardia for age', bradycardia: 'Bradycardia for age', tachypnoea: 'Tachypnoea for age', hypotension: 'Hypotension for age',
  hypoxaemia: 'SpO₂ < 92%', fever: 'Fever ≥ 38.5 °C', hypothermia: 'Temperature < 36 °C', prolonged_crt: 'Capillary refill > 3 s',
  coma: 'GCS ≤ 8', oliguria: 'Urine output < 0.5 mL/kg/h', hypoglycaemia: 'Glucose < 3.0 mmol/L',
} as const;
export type VitalFlag = keyof typeof VITAL_FLAGS;

export function vitalFlags(v: VitalValues, ageMonths: number): VitalFlag[] {
  const b = ageBand(ageMonths), f: VitalFlag[] = [];
  if (v.hr != null && v.hr > b.tachy) f.push('tachycardia');
  if (v.hr != null && b.brady != null && v.hr < b.brady) f.push('bradycardia');
  if (v.rr != null && v.rr > b.rr) f.push('tachypnoea');
  if (v.sbp != null && v.sbp < b.sbpLow) f.push('hypotension');
  if (v.spo2 != null && v.spo2 < 92) f.push('hypoxaemia');
  if (v.temp != null && v.temp >= 38.5) f.push('fever');
  if (v.temp != null && v.temp < 36) f.push('hypothermia');
  if (v.crt != null && v.crt > 3) f.push('prolonged_crt');
  if (v.gcs != null && v.gcs <= 8) f.push('coma');
  if (v.urine != null && v.urine < 0.5) f.push('oliguria');
  if (v.glucose != null && v.glucose < 3) f.push('hypoglycaemia');
  return f;
}

/** SpO₂/FiO₂ ratio — only meaningful when SpO₂ ≤ 97% (PALICC). */
export const sfRatio = (v: VitalValues) => (v.spo2 != null && v.fio2 != null && v.spo2 <= 97 ? Math.round((v.spo2 / (v.fio2 / 100)) * 10) / 10 : null);
export const shockIndex = (v: VitalValues) => (v.hr != null && v.sbp != null && v.sbp > 0 ? Math.round((v.hr / v.sbp) * 100) / 100 : null);

// ── Key-moment summaries ─────────────────────────────────────

const msOf = (s: string) => new Date(s.length === 10 ? `${s}T00:00` : s).getTime();

/** First set recorded within 1 h of admission (any context), else a set explicitly marked "admission". */
export function admissionSet(sets: VitalSet[], admitAt: string): VitalSet | null {
  const t0 = msOf(admitAt);
  const sorted = [...sets].sort((a, b) => a.at.localeCompare(b.at));
  return sorted.find(s => msOf(s.at) >= t0 - 30 * 60_000 && msOf(s.at) <= t0 + 60 * 60_000) ?? sorted.find(s => s.context === 'admission') ?? null;
}

export interface Worst24 { values: VitalValues & { tempMin?: number; tempMax?: number; glucoseMin?: number; glucoseMax?: number }; sfMin: number | null; shockIndexMax: number | null; sets: number }

/** Worst values in [admission − 30 min, admission + 24 h], direction-aware. */
export function worst24(sets: VitalSet[], admitAt: string): Worst24 | null {
  const t0 = msOf(admitAt);
  const inWindow = sets.filter(s => msOf(s.at) >= t0 - 30 * 60_000 && msOf(s.at) <= t0 + 24 * 3_600_000);
  if (!inWindow.length) return null;
  const values: Worst24['values'] = {};
  for (const code of VITAL_CODES) {
    const xs = inWindow.map(s => s.values[code]).filter((x): x is number => x != null);
    if (!xs.length) continue;
    const d = VITALS[code];
    if (d.worst === 'both') {
      if (code === 'temp') { values.tempMin = Math.min(...xs); values.tempMax = Math.max(...xs); }
      if (code === 'glucose') { values.glucoseMin = Math.min(...xs); values.glucoseMax = Math.max(...xs); }
    } else values[code] = d.worst === 'max' ? Math.max(...xs) : Math.min(...xs);
  }
  const sfs = inWindow.map(s => sfRatio(s.values)).filter((x): x is number => x != null);
  const sis = inWindow.map(s => shockIndex(s.values)).filter((x): x is number => x != null);
  return { values, sfMin: sfs.length ? Math.min(...sfs) : null, shockIndexMax: sis.length ? Math.max(...sis) : null, sets: inWindow.length };
}

/** Flags present at any time in the first 24 h (worst values judged against the admission age). */
export function flags24(sets: VitalSet[], admitAt: string, ageMonths: number): VitalFlag[] {
  const t0 = msOf(admitAt);
  const out = new Set<VitalFlag>();
  sets.filter(s => msOf(s.at) >= t0 - 30 * 60_000 && msOf(s.at) <= t0 + 24 * 3_600_000).forEach(s => vitalFlags(s.values, ageMonths).forEach(f => out.add(f)));
  return [...out];
}

// ── Research features (one value per admission) ──────────────
//  Shared by the Explorer, the de-identified export and the AI catalogue so every surface
//  uses identical definitions. Missing = not recorded; a flag is only "no" when the vital it
//  depends on was actually measured in the window.

export type VitalFeatureValue = number | boolean | string[] | undefined;
export interface VitalFeature { id: string; label: string; group: string; kind: 'number' | 'boolean' | 'set'; unit?: string; description: string; options?: string[]; optionLabels?: Record<string, string> }

const FLAG_NEEDS: Record<VitalFlag, VitalCode> = {
  tachycardia: 'hr', bradycardia: 'hr', tachypnoea: 'rr', hypotension: 'sbp', hypoxaemia: 'spo2', fever: 'temp', hypothermia: 'temp',
  prolonged_crt: 'crt', coma: 'gcs', oliguria: 'urine', hypoglycaemia: 'glucose',
};
const ADM_CODES: VitalCode[] = ['hr', 'rr', 'spo2', 'fio2', 'sbp', 'map', 'temp', 'crt', 'gcs', 'glucose'];
const W24: { id: string; label: string; code: VitalCode; pick: (w: Worst24) => number | null | undefined }[] = [
  { id: 'w24_hr_max', label: 'Highest heart rate', code: 'hr', pick: w => w.values.hr },
  { id: 'w24_rr_max', label: 'Highest respiratory rate', code: 'rr', pick: w => w.values.rr },
  { id: 'w24_spo2_min', label: 'Lowest SpO₂', code: 'spo2', pick: w => w.values.spo2 },
  { id: 'w24_fio2_max', label: 'Highest FiO₂', code: 'fio2', pick: w => w.values.fio2 },
  { id: 'w24_sbp_min', label: 'Lowest systolic BP', code: 'sbp', pick: w => w.values.sbp },
  { id: 'w24_map_min', label: 'Lowest MAP', code: 'map', pick: w => w.values.map },
  { id: 'w24_temp_max', label: 'Highest temperature', code: 'temp', pick: w => w.values.tempMax },
  { id: 'w24_temp_min', label: 'Lowest temperature', code: 'temp', pick: w => w.values.tempMin },
  { id: 'w24_crt_max', label: 'Longest capillary refill', code: 'crt', pick: w => w.values.crt },
  { id: 'w24_gcs_min', label: 'Lowest GCS', code: 'gcs', pick: w => w.values.gcs },
  { id: 'w24_urine_min', label: 'Lowest urine output', code: 'urine', pick: w => w.values.urine },
  { id: 'w24_glucose_min', label: 'Lowest glucose', code: 'glucose', pick: w => w.values.glucoseMin },
  { id: 'w24_glucose_max', label: 'Highest glucose', code: 'glucose', pick: w => w.values.glucoseMax },
];
const FLAG_KEYS = Object.keys(VITAL_FLAGS) as VitalFlag[];
const G_ADM = 'Vitals · admission', G_24 = 'Vitals · first 24 h';

export const VITAL_FEATURES: VitalFeature[] = [
  ...ADM_CODES.map(c => ({ id: `vit_adm_${c}`, label: `${VITALS[c].label} at admission`, group: G_ADM, kind: 'number' as const, unit: VITALS[c].unit || undefined, description: 'First vital-sign set within 1 h of admission (−30 min to +1 h)' })),
  { id: 'vit_adm_sf', label: 'S/F ratio at admission', group: G_ADM, kind: 'number', description: 'SpO₂ / FiO₂ at admission; only when SpO₂ ≤ 97% (PALICC)' },
  { id: 'vit_adm_shock_index', label: 'Shock index at admission', group: G_ADM, kind: 'number', description: 'Heart rate / systolic BP at admission' },
  { id: 'vit_adm_flags', label: 'Abnormal-for-age signs at admission', group: G_ADM, kind: 'set', options: FLAG_KEYS, optionLabels: { ...VITAL_FLAGS }, description: 'IPSCC 2005 age bands for HR, RR, SBP; fixed thresholds otherwise' },
  { id: 'vit_hours_to_first', label: 'Hours to first vitals', group: G_ADM, kind: 'number', unit: 'h', description: 'Time from PICU admission to the first recorded vital-sign set' },
  ...W24.map(w => ({ id: w.id, label: `${w.label} (first 24 h)`, group: G_24, kind: 'number' as const, unit: VITALS[w.code].unit || undefined, description: 'Worst value from 30 min before to 24 h after admission' })),
  { id: 'w24_sf_min', label: 'Lowest S/F ratio (first 24 h)', group: G_24, kind: 'number', description: 'Lowest SpO₂/FiO₂ when SpO₂ ≤ 97%' },
  { id: 'w24_shock_index_max', label: 'Highest shock index (first 24 h)', group: G_24, kind: 'number', description: 'Highest HR/SBP' },
  ...FLAG_KEYS.map(f => ({ id: `w24_${f}`, label: `${VITAL_FLAGS[f]} (first 24 h)`, group: G_24, kind: 'boolean' as const, description: `Any set in the first 24 h; missing when ${VITALS[FLAG_NEEDS[f]].label.toLowerCase()} was not measured` })),
  { id: 'vit_sets_24h', label: 'Vital-sign sets in first 24 h', group: G_24, kind: 'number', description: 'Number of recorded sets (recording intensity, not severity)' },
];

const hoursBetween = (a: string, b: string) => Math.round(((msOf(b) - msOf(a)) / 3_600_000) * 10) / 10;

export function vitalFeatures(sets: VitalSet[], admitAt: string, ageMonths: number): Record<string, VitalFeatureValue> {
  const out: Record<string, VitalFeatureValue> = {};
  if (!sets.length) return out;
  const adm = admissionSet(sets, admitAt);
  if (adm) {
    ADM_CODES.forEach(c => { if (adm.values[c] != null) out[`vit_adm_${c}`] = adm.values[c]; });
    out.vit_adm_sf = sfRatio(adm.values) ?? undefined;
    out.vit_adm_shock_index = shockIndex(adm.values) ?? undefined;
    out.vit_adm_flags = vitalFlags(adm.values, ageMonths);
  }
  const first = [...sets].sort((a, b) => a.at.localeCompare(b.at))[0];
  out.vit_hours_to_first = Math.max(0, hoursBetween(admitAt, first.at));
  const w = worst24(sets, admitAt);
  if (w) {
    W24.forEach(x => { const v = x.pick(w); if (v != null) out[x.id] = v; });
    if (w.sfMin != null) out.w24_sf_min = w.sfMin;
    if (w.shockIndexMax != null) out.w24_shock_index_max = w.shockIndexMax;
    const f24 = new Set(flags24(sets, admitAt, ageMonths));
    const t0 = msOf(admitAt);
    const measured = new Set(sets.filter(s => msOf(s.at) >= t0 - 30 * 60_000 && msOf(s.at) <= t0 + 24 * 3_600_000).flatMap(s => Object.keys(s.values)));
    FLAG_KEYS.forEach(f => { if (measured.has(FLAG_NEEDS[f])) out[`w24_${f}`] = f24.has(f); });
    out.vit_sets_24h = w.sets;
  } else out.vit_sets_24h = 0;
  return out;
}
