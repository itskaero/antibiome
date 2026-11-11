// Antimicrobial dose timing: the usual interval when a drug is started (editable per patient), and when
// the next dose is due from the doses recorded as given.

/** Usual PICU dosing interval in hours (normal renal function). Pre-fills "every … h"; always editable. */
export const DEFAULT_INTERVAL_H: Record<string, number> = {
  Meropenem: 8, Imipenem: 6, Ertapenem: 24, Vancomycin: 6, Teicoplanin: 24, Linezolid: 8,
  Ceftriaxone: 12, Cefotaxime: 6, Ceftazidime: 8, Cefepime: 8, Cefuroxime: 8, Cefazolin: 8, Cefixime: 12,
  'Piperacillin-Tazobactam': 6, 'Ampicillin': 6, 'Amoxicillin': 8, 'Amoxicillin-Clavulanate': 8, Oxacillin: 6, 'Cefoperazone-Sulbactam': 12, 'Benzylpenicillin': 6, Cloxacillin: 6, 'Flucloxacillin': 6,
  Amikacin: 24, Gentamicin: 24, Colistin: 8, Ciprofloxacin: 12, Levofloxacin: 24, Metronidazole: 8, Clindamycin: 8,
  Azithromycin: 24, Clarithromycin: 12, 'Co-trimoxazole': 12, Doxycycline: 12, Tigecycline: 12,
  Fluconazole: 24, 'Amphotericin B': 24, Micafungin: 24, Voriconazole: 12, Acyclovir: 8, Oseltamivir: 12,
};
export const defaultInterval = (drug: string) => DEFAULT_INTERVAL_H[drug] ?? null;

const ms = (s: string) => new Date(s).getTime();
const local = (t: number) => { const d = new Date(t); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

/** `assumed`: no dose recorded yet, so the schedule runs from the start time and nothing is called overdue. */
export interface DoseDue { lastGiven: string | null; nextDue: string | null; overdueMin: number; dueInMin: number | null; dosesGiven: number; assumed: boolean }
/** Overdue only counts after this grace period. */
export const DOSE_GRACE_MIN = 30;

/**
 * Next dose = last dose given + interval. Before any dose is recorded the schedule is assumed to run from
 * the start time (start, start + interval, …), so a unit that has not begun recording doses sees no false
 * "overdue". A stopped drug or one without an interval has nothing due.
 */
export function doseDue(ep: { startAt: string; endAt: string | null; intervalHours?: number | null }, given: string[], now: number): DoseDue {
  const times = [...given].sort();
  const lastGiven = times.at(-1) ?? null;
  if (ep.endAt || !ep.intervalHours) return { lastGiven, nextDue: null, overdueMin: 0, dueInMin: null, dosesGiven: times.length, assumed: false };
  const step = ep.intervalHours * 3_600_000;
  let next: number;
  if (lastGiven) next = ms(lastGiven) + step;
  else { const start = ms(ep.startAt); next = start + Math.max(0, Math.ceil((now - start - DOSE_GRACE_MIN * 60_000) / step)) * step; }
  const diffMin = Math.round((now - next) / 60_000);
  return { lastGiven, nextDue: local(next), overdueMin: lastGiven && diffMin > DOSE_GRACE_MIN ? diffMin : 0, dueInMin: diffMin <= 0 ? -diffMin : 0, dosesGiven: times.length, assumed: !lastGiven };
}
