// Import cultures from the original Antibiome web app so NICU/ward history is kept.
// Accepts either the JSON array stored in localStorage ('nicu-cultures') / Firestore
// export, or the CSV produced by its "Export CSV" button.
import { randomUUID } from 'node:crypto';
import { type DB, tx } from './db';
import { nowLocal } from '../shared/time';
import { ORGANISMS, SPECIMEN_TYPES } from '../shared/reference';

export interface LegacyCulture {
  date: string; organism?: string | null; specimen?: string; age_group?: string; ward?: string; patient_name?: string;
  antibiotics?: { name: string; result: string }[];
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

export function parseLegacy(text: string): LegacyCulture[] {
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const data = JSON.parse(trimmed);
    return (Array.isArray(data) ? data : data.cultures ?? []) as LegacyCulture[];
  }
  const [header, ...rows] = parseCsv(trimmed);
  const idx = (name: string) => header.findIndex(h => h.trim().toLowerCase() === name);
  const col = { date: idx('date'), name: idx('patient name'), age: idx('age group'), org: idx('organism'), spec: idx('specimen'), ward: idx('ward'), ab: idx('antibiotics') };
  if (col.date < 0 || col.org < 0) throw new Error('Unrecognised file. Expected the Antibiome CSV export or JSON backup.');
  return rows.map(r => ({
    date: r[col.date], patient_name: r[col.name], age_group: r[col.age], organism: r[col.org], specimen: r[col.spec], ward: r[col.ward],
    antibiotics: (r[col.ab] || '').split('|').map(s => s.trim()).filter(Boolean).map(s => {
      const k = s.lastIndexOf(':'); return { name: s.slice(0, k).trim(), result: s.slice(k + 1).trim() };
    }),
  }));
}

/** Free-text ward ("NICU Bed 3") → unit ("NICU"). */
export function unitFromWard(ward: string | undefined): string {
  const w = (ward || '').toUpperCase();
  for (const u of ['NICU', 'PICU', 'SCBU', 'HDU', 'ICU']) if (w.includes(u)) return u;
  return (ward || 'Unknown').trim().split(/\s+bed\b/i)[0] || 'Unknown';
}

export function importLegacy(db: DB, records: LegacyCulture[], userId: number | null) {
  let imported = 0, skipped = 0;
  const exists = db.prepare("SELECT 1 FROM cultures WHERE source = 'legacy' AND collected_at = ? AND specimen = ? AND IFNULL(organism,'') = ? AND IFNULL(legacy_label,'') = ?");
  const ins = db.prepare("INSERT INTO cultures(id, unit, collected_at, specimen, organism, age_group, legacy_label, source, created_by, created_at) VALUES (?,?,?,?,?,?,?,'legacy',?,?)");
  const insR = db.prepare('INSERT OR IGNORE INTO susceptibility_results(culture_id, drug, result) VALUES (?,?,?)');
  tx(db, () => {
    for (const r of records) {
      const date = String(r.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { skipped++; continue; }
      const specimen = SPECIMEN_TYPES.includes(r.specimen ?? '') ? r.specimen! : 'Other';
      const organism = (r.organism || '').trim() || null;
      const label = (r.patient_name || '').trim();
      if (exists.get(date, specimen, organism ?? '', label)) { skipped++; continue; }
      const id = randomUUID();
      ins.run(id, unitFromWard(r.ward), date, specimen, organism, r.age_group || null, label || null, userId, nowLocal());
      (r.antibiotics || []).forEach(a => { if (a?.name && ['S', 'I', 'R'].includes(a.result)) insR.run(id, a.name, a.result); });
      imported++;
    }
    db.prepare("INSERT INTO audit_log(at, user_id, username, action, entity, entity_id, summary) VALUES (?,?,NULL,'import','culture',NULL,?)")
      .run(nowLocal(), userId, `Imported ${imported} legacy cultures (${skipped} skipped as duplicates or invalid)`);
  });
  return { imported, skipped, unknownOrganisms: [...new Set(records.map(r => r.organism).filter(o => o && !ORGANISMS.includes(o)))] };
}
