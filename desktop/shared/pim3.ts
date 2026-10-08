// ═══════════════════════════════════════════════════════════
//  PIM3 — Paediatric Index of Mortality 3 (Straney et al., Pediatr Crit Care Med 2013;14:673-81).
//  Recorded from the first hour of PICU care. Used only for risk adjustment of unit-level
//  mortality (SMR), never as an individual prognosis.
//  Coefficients are transcribed from the published equation; verify against the paper (and
//  recalibration guidance for your region) before formal benchmarking.
// ═══════════════════════════════════════════════════════════

export const PIM3_VERSION = 'PIM3-2013';

export type Pim3Recovery = 'none' | 'bypass_cardiac' | 'nonbypass_cardiac' | 'noncardiac';
export type Pim3RiskDx = 'none' | 'very_high' | 'high' | 'low';

export interface Pim3Input {
  pupilsFixed: boolean;
  elective: boolean;
  mvFirstHour: boolean;
  /** mmol/L; null = not measured (treated as 0) */
  baseExcess: number | null;
  /** mmHg; null = not measured (120). Use 0 for cardiac arrest, 30 for shock with unrecordable BP. */
  sbp: number | null;
  /** Fraction 0.21–1.0; with paO2 (mmHg). Either missing → ratio treated as 0.23. */
  fio2: number | null;
  pao2: number | null;
  recovery: Pim3Recovery;
  riskDx: Pim3RiskDx;
}

export const PIM3_RECOVERY_LABEL: Record<Pim3Recovery, string> = {
  none: 'Not a post-procedure admission', bypass_cardiac: 'Recovery: cardiac bypass surgery',
  nonbypass_cardiac: 'Recovery: cardiac, non-bypass', noncardiac: 'Recovery: non-cardiac procedure',
};
export const PIM3_RISKDX_LABEL: Record<Pim3RiskDx, string> = {
  none: 'None of the listed diagnoses', very_high: 'Very high-risk diagnosis', high: 'High-risk diagnosis', low: 'Low-risk diagnosis (main reason)',
};
export const PIM3_RISKDX_HELP: Record<Exclude<Pim3RiskDx, 'none'>, string> = {
  very_high: 'Cardiac arrest before admission, SCID, leukaemia/lymphoma after first induction, bone-marrow transplant recipient, liver failure as main reason',
  high: 'Spontaneous cerebral haemorrhage, cardiomyopathy or myocarditis, hypoplastic left heart syndrome, neurodegenerative disorder, necrotising enterocolitis as main reason',
  low: 'Main reason is asthma, bronchiolitis, croup, obstructive sleep apnoea, DKA or seizure disorder',
};

/** Suggest the PIM3 diagnosis category from the local diagnosis code (clinician confirms). */
export function suggestRiskDx(dxCode: string): Pim3RiskDx {
  if (['CARDIAC_ARREST', 'ALF'].includes(dxCode)) return 'very_high';
  if (['MYOCARDITIS', 'HEART_FAILURE'].includes(dxCode)) return 'high';
  if (['ASTHMA', 'BRONCHIOLITIS', 'CROUP', 'DKA', 'STATUS_EPILEPTICUS'].includes(dxCode)) return 'low';
  return 'none';
}

export function pim3Logit(x: Pim3Input): number {
  const sbp = x.sbp ?? 120;
  const be = x.baseExcess ?? 0;
  const ratio = x.fio2 != null && x.pao2 != null && x.pao2 > 0 ? (x.fio2 * 100) / x.pao2 : 0.23;
  return (
    3.8233 * +x.pupilsFixed
    - 0.5378 * +x.elective
    + 0.9763 * +x.mvFirstHour
    + 0.0671 * Math.abs(be)
    - 0.0431 * sbp
    + 0.1716 * (sbp * sbp) / 1000
    + 0.4214 * ratio
    - 1.2246 * +(x.recovery === 'bypass_cardiac')
    - 0.8762 * +(x.recovery === 'nonbypass_cardiac')
    - 1.5164 * +(x.recovery === 'noncardiac')
    + 1.6225 * +(x.riskDx === 'very_high')
    + 1.0725 * +(x.riskDx === 'high')
    - 2.1766 * +(x.riskDx === 'low')
    - 1.7928
  );
}

export const pim3Risk = (x: Pim3Input) => { const l = pim3Logit(x); return 1 / (1 + Math.exp(-l)); };

export function validatePim3(raw: any): Pim3Input {
  const num = (v: unknown, lo: number, hi: number, name: string) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${name} must be between ${lo} and ${hi}`);
    return n;
  };
  const recovery = raw?.recovery ?? 'none', riskDx = raw?.riskDx ?? 'none';
  if (!(recovery in PIM3_RECOVERY_LABEL)) throw new Error('Unknown recovery category');
  if (!(riskDx in PIM3_RISKDX_LABEL)) throw new Error('Unknown diagnosis category');
  let fio2 = num(raw?.fio2, 0.21, 100, 'FiO₂');
  if (fio2 != null && fio2 > 1) fio2 = fio2 / 100; // accept 21–100 %
  return {
    pupilsFixed: !!raw?.pupilsFixed, elective: !!raw?.elective, mvFirstHour: !!raw?.mvFirstHour,
    baseExcess: num(raw?.baseExcess, -40, 40, 'Base excess'), sbp: num(raw?.sbp, 0, 300, 'Systolic BP'),
    fio2, pao2: num(raw?.pao2, 5, 700, 'PaO₂'), recovery, riskDx,
  };
}

/**
 * Standardised mortality ratio with a 95% CI (Byar's approximation to the exact Poisson interval).
 * Only admissions with both an outcome and a PIM3 risk contribute.
 */
export function smr(observed: number, expected: number): { smr: number; lo: number; hi: number } | null {
  if (expected <= 0) return null;
  const z = 1.96;
  const lo = observed === 0 ? 0 : (observed * (1 - 1 / (9 * observed) - z / (3 * Math.sqrt(observed))) ** 3) / expected;
  const o1 = observed + 1;
  const hi = (o1 * (1 - 1 / (9 * o1) + z / (3 * Math.sqrt(o1))) ** 3) / expected;
  return { smr: observed / expected, lo, hi };
}
