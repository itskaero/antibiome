// All timestamps are local wall-clock strings ('YYYY-MM-DDTHH:mm'); the PICU PC is the clock.
const pad = (n: number) => String(n).padStart(2, '0');
export const DAY_MS = 86_400_000;

export const toLocal = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const nowLocal = () => toLocal(new Date());
export const parse = (s: string) => new Date(s.length === 10 ? `${s}T00:00` : s);
export const ms = (s: string) => parse(s).getTime();

export const monthKey = (s: string) => s.slice(0, 7);
export function monthBounds(month: string): [number, number] {
  const [y, m] = month.split('-').map(Number);
  return [new Date(y, m - 1, 1).getTime(), new Date(y, m, 1).getTime()];
}
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export const daysInMonth = (month: string) => { const [a, b] = monthBounds(month); return Math.round((b - a) / DAY_MS); };
export function fmtMonth(month: string, long = false) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: long ? 'long' : 'short', year: long ? 'numeric' : '2-digit' });
}
export function fmtDateTime(s: string | null | undefined) {
  if (!s) return '—';
  const d = parse(s);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + (s.length > 10 ? ` · ${s.slice(11, 16)}` : '');
}
export function fmtAge(months: number) {
  if (months < 1) return '<1 mo';
  if (months < 24) return `${Math.round(months)} mo`;
  const y = Math.floor(months / 12), mo = Math.round(months % 12);
  return mo ? `${y} y ${mo} m` : `${y} y`;
}

/** Overlap of [a,b) with [p,q) in days. */
export const overlapDays = (a: number, b: number, p: number, q: number) => Math.max(0, Math.min(b, q) - Math.max(a, p)) / DAY_MS;

/** Calendar days (local) touched by [a,b] that fall inside [p,q). Used for Days of Therapy. */
export function calendarDaysTouched(a: number, b: number, p: number, q: number): number {
  const start = Math.max(a, p), end = Math.min(b, q - 1);
  if (end < start) return 0;
  const s = new Date(start); s.setHours(0, 0, 0, 0);
  const e = new Date(end); e.setHours(0, 0, 0, 0);
  return Math.round((e.getTime() - s.getTime()) / DAY_MS) + 1;
}
