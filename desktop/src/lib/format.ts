export const fmtInt = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('en-GB'));
export const fmt1 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : (Math.round(n * 10) / 10).toLocaleString('en-GB'));
export const fmtPct = (n: number | null | undefined, digits = 0) => (n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(digits)}%`);
export function delta(cur: number | null | undefined, prev: number | null | undefined) {
  if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export const losLabel = (days: number) => (days < 1 ? `${Math.max(1, Math.round(days * 24))} h` : `${fmt1(days)} d`);
