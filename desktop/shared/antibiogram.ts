// Cumulative antibiogram — same arithmetic as the original renderAntibiogram()
// (%S = S / (S+I+R), per organism × drug), plus two opt-in improvements:
//   • firstIsolateOnly: CLSI M39-style de-duplication (first isolate per patient
//     per organism in the analysed set) — only possible when cultures are linked
//     to a patient.
//   • every cell carries n so the UI can flag n < 30.
import type { Culture } from './types';

export const ANTIBIOGRAM_MIN_N = 30;

export interface AntibiogramCell { S: number; I: number; R: number; n: number; pctS: number | null }
export interface AntibiogramRow { organism: string; isolates: number; cells: Record<string, AntibiogramCell> }
export interface Antibiogram { drugs: string[]; rows: AntibiogramRow[]; isolatesUsed: number; duplicatesRemoved: number }

export function firstIsolates(cultures: Culture[]): Culture[] {
  const seen = new Set<string>();
  return [...cultures]
    .sort((a, b) => a.collectedAt.localeCompare(b.collectedAt))
    .filter(c => {
      if (!c.patientId || !c.organism) return true;
      const key = `${c.patientId}|${c.organism}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function buildAntibiogram(cultures: Culture[], opts: { firstIsolateOnly?: boolean } = {}): Antibiogram {
  const positives = cultures.filter(c => c.organism);
  const used = opts.firstIsolateOnly ? firstIsolates(positives) : positives;
  const raw: Record<string, { count: number; drugs: Record<string, { S: number; I: number; R: number }> }> = {};
  used.forEach(entry => {
    const org = entry.organism!;
    raw[org] ??= { count: 0, drugs: {} };
    raw[org].count++;
    entry.antibiotics.forEach(({ name, result }) => {
      if (!name || !['S', 'I', 'R'].includes(result)) return;
      raw[org].drugs[name] ??= { S: 0, I: 0, R: 0 };
      raw[org].drugs[name][result]++;
    });
  });
  const drugs = [...new Set(Object.values(raw).flatMap(o => Object.keys(o.drugs)))].sort();
  const rows = Object.keys(raw).sort().map(organism => {
    const cells: Record<string, AntibiogramCell> = {};
    Object.entries(raw[organism].drugs).forEach(([drug, c]) => {
      const n = c.S + c.I + c.R;
      cells[drug] = { ...c, n, pctS: n ? Math.round(c.S / n * 100) : null };
    });
    return { organism, isolates: raw[organism].count, cells };
  });
  return { drugs, rows, isolatesUsed: used.length, duplicatesRemoved: positives.length - used.length };
}

/** Local %S for one drug against a set of isolates (min n defaults to the original app's 3). */
export function localSusceptibility(cultures: Culture[], drug: string, minN = 3): { pct: number; n: number } | null {
  let S = 0, n = 0;
  cultures.forEach(c => c.antibiotics.forEach(ab => { if (ab.name === drug) { n++; if (ab.result === 'S') S++; } }));
  return n >= minN ? { pct: Math.round(S / n * 100), n } : null;
}
