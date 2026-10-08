// Data-quality rules. Warnings are surfaced, never silently "fixed".
// 'error' = physically impossible; 'warn' = implausible or incomplete.
import type { Dataset } from './types';
import { DAY_MS, ms } from './time';
import { dxLabel } from './reference';

export interface QualityIssue {
  id: string;
  severity: 'error' | 'warn';
  rule: string;
  admissionId: string | null;
  cultureId?: string;
  message: string;
}

export const QUALITY_RULES: Record<string, string> = {
  age: 'Age outside 0–18 years',
  weight: 'Weight implausible for age',
  dischargeBeforeAdmit: 'Discharge before admission',
  episodeOrder: 'Episode ends before it starts',
  episodeAfterDischarge: 'Episode open after discharge',
  episodeBeforeAdmit: 'Episode starts before admission',
  longStay: 'Still admitted after 60 days (missed discharge?)',
  longAbx: 'Antimicrobial course open > 21 days',
  dupDx: 'Secondary diagnosis repeats primary',
  dupCulture: 'Possible duplicate culture',
  cultureOutside: 'Culture date outside the admission',
  overlapAdmission: 'Overlapping admissions for one patient',
};

/** Very wide plausibility band: ~3rd centile of a premature neonate up to adult-sized adolescents. */
function weightPlausible(kg: number, ageMonths: number): boolean {
  const lo = ageMonths < 1 ? 0.5 : ageMonths < 12 ? 1.5 : ageMonths < 60 ? 4 : 8;
  const hi = ageMonths < 1 ? 6 : ageMonths < 12 ? 15 : ageMonths < 60 ? 35 : 150;
  return kg >= lo && kg <= hi;
}

export function runQualityChecks(ds: Dataset, now: number): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const push = (rule: string, severity: QualityIssue['severity'], admissionId: string | null, message: string, cultureId?: string) =>
    issues.push({ id: `${rule}:${admissionId ?? ''}:${cultureId ?? issues.length}`, rule, severity, admissionId, message, cultureId });

  const admById = Object.fromEntries(ds.admissions.map(a => [a.id, a]));

  ds.admissions.forEach(a => {
    if (a.ageMonths < 0 || a.ageMonths > 216) push('age', 'error', a.id, `Age recorded as ${a.ageMonths} months`);
    if (a.weightKg != null && !weightPlausible(a.weightKg, a.ageMonths)) push('weight', 'warn', a.id, `${a.weightKg} kg at ${Math.round(a.ageMonths)} months`);
    if (a.dischargeAt && ms(a.dischargeAt) < ms(a.admitAt)) push('dischargeBeforeAdmit', 'error', a.id, `Discharged ${a.dischargeAt} before admission ${a.admitAt}`);
    if (!a.dischargeAt && (now - ms(a.admitAt)) / DAY_MS > 60) push('longStay', 'warn', a.id, `Admitted ${a.admitAt}, no discharge recorded`);
    if (a.secondaryDx.includes(a.primaryDx)) push('dupDx', 'warn', a.id, `${dxLabel(a.primaryDx)} is both primary and secondary`);
  });

  ds.episodes.forEach(e => {
    const a = admById[e.admissionId];
    if (!a) return;
    if (e.endAt && ms(e.endAt) < ms(e.startAt)) push('episodeOrder', 'error', a.id, `${e.detail}: ends ${e.endAt}, starts ${e.startAt}`);
    if (ms(e.startAt) < ms(a.admitAt) - 6 * 3_600_000) push('episodeBeforeAdmit', 'warn', a.id, `${e.detail} starts ${e.startAt}, admitted ${a.admitAt}`);
    if (a.dischargeAt && (!e.endAt || ms(e.endAt) > ms(a.dischargeAt) + 60_000)) push('episodeAfterDischarge', 'warn', a.id, `${e.detail} not closed by discharge`);
    if (e.kind === 'abx' && !e.endAt && !a.dischargeAt && (now - ms(e.startAt)) / DAY_MS > 21) push('longAbx', 'warn', a.id, `${e.detail} running since ${e.startAt.slice(0, 10)}`);
  });

  // Overlapping admissions for the same patient.
  const byPatient: Record<string, typeof ds.admissions> = {};
  ds.admissions.forEach(a => (byPatient[a.patientId] ??= []).push(a));
  Object.values(byPatient).forEach(list => {
    list.sort((x, y) => ms(x.admitAt) - ms(y.admitAt));
    for (let i = 1; i < list.length; i++) {
      const prevEnd = list[i - 1].dischargeAt ? ms(list[i - 1].dischargeAt!) : now;
      if (ms(list[i].admitAt) < prevEnd) push('overlapAdmission', 'error', list[i].id, `Overlaps admission from ${list[i - 1].admitAt.slice(0, 10)}`);
    }
  });

  // Cultures: duplicates (same patient/specimen/organism within 3 days) and dates outside the admission.
  const linked = ds.cultures.filter(c => c.patientId && c.organism).sort((x, y) => x.collectedAt.localeCompare(y.collectedAt));
  for (let i = 0; i < linked.length; i++) for (let j = i + 1; j < linked.length; j++) {
    const x = linked[i], y = linked[j];
    if ((ms(y.collectedAt) - ms(x.collectedAt)) / DAY_MS > 3) break;
    if (x.patientId === y.patientId && x.specimen === y.specimen && x.organism === y.organism)
      push('dupCulture', 'warn', y.admissionId, `${y.organism} (${y.specimen}) on ${x.collectedAt.slice(0, 10)} and ${y.collectedAt.slice(0, 10)}`, y.id);
  }
  ds.cultures.forEach(c => {
    const a = c.admissionId ? admById[c.admissionId] : null;
    if (!a) return;
    const t = ms(c.collectedAt.slice(0, 10)), start = ms(a.admitAt.slice(0, 10)), end = a.dischargeAt ? ms(a.dischargeAt.slice(0, 10)) : now;
    if (t < start - 2 * DAY_MS || t > end + DAY_MS) push('cultureOutside', 'warn', a.id, `Culture ${c.collectedAt.slice(0, 10)} outside stay ${a.admitAt.slice(0, 10)}–${a.dischargeAt?.slice(0, 10) ?? 'now'}`, c.id);
  });

  return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}
