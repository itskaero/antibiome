// Synthetic demonstration data — clearly flagged, never mixed silently with real data.
// Deterministic (seeded) so screenshots and tests are reproducible.
import { randomUUID } from 'node:crypto';
import { type DB, setSetting, tx } from './db';
import { DAY_MS, toLocal } from '../shared/time';
import type { RespLevel } from '../shared/reference';

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

interface Profile { dx: string; w: number; ageM: [number, number]; mv: number; niv: number; hfnc: number; vaso: number; los: [number, number]; die: number; abx: string[][]; cultureP: number }
const PROFILES: Profile[] = [
  { dx: 'PNEUMONIA', w: 14, ageM: [2, 60], mv: 0.15, niv: 0.25, hfnc: 0.35, vaso: 0.08, los: [2, 7], die: 0.04, abx: [['Ceftriaxone'], ['Ampicillin', 'Gentamicin'], ['Piperacillin-Tazobactam']], cultureP: 0.5 },
  { dx: 'SEVERE_PNEUMONIA', w: 9, ageM: [1, 48], mv: 0.45, niv: 0.3, hfnc: 0.2, vaso: 0.2, los: [4, 12], die: 0.1, abx: [['Ceftriaxone', 'Vancomycin'], ['Meropenem', 'Vancomycin'], ['Piperacillin-Tazobactam', 'Amikacin']], cultureP: 0.8 },
  { dx: 'SEPSIS', w: 10, ageM: [1, 144], mv: 0.35, niv: 0.15, hfnc: 0.15, vaso: 0.4, los: [3, 10], die: 0.12, abx: [['Ceftriaxone', 'Amikacin'], ['Meropenem', 'Vancomycin'], ['Piperacillin-Tazobactam', 'Amikacin']], cultureP: 0.95 },
  { dx: 'SEPTIC_SHOCK', w: 5, ageM: [1, 144], mv: 0.7, niv: 0.1, hfnc: 0.1, vaso: 0.95, los: [4, 14], die: 0.25, abx: [['Meropenem', 'Vancomycin'], ['Meropenem', 'Colistin'], ['Meropenem', 'Vancomycin', 'Amikacin']], cultureP: 1 },
  { dx: 'BRONCHIOLITIS', w: 9, ageM: [1, 18], mv: 0.08, niv: 0.3, hfnc: 0.55, vaso: 0.01, los: [2, 5], die: 0.005, abx: [[], [], ['Ceftriaxone']], cultureP: 0.15 },
  { dx: 'DKA', w: 5, ageM: [36, 192], mv: 0.03, niv: 0, hfnc: 0, vaso: 0.03, los: [1, 3], die: 0.01, abx: [[], [], ['Ceftriaxone']], cultureP: 0.2 },
  { dx: 'MENINGITIS', w: 4, ageM: [1, 120], mv: 0.3, niv: 0.05, hfnc: 0.1, vaso: 0.2, los: [5, 14], die: 0.08, abx: [['Ceftriaxone', 'Vancomycin'], ['Meropenem', 'Vancomycin']], cultureP: 1 },
  { dx: 'ENCEPHALITIS', w: 4, ageM: [6, 144], mv: 0.45, niv: 0.05, hfnc: 0.05, vaso: 0.15, los: [5, 16], die: 0.1, abx: [['Ceftriaxone'], ['Ceftriaxone', 'Vancomycin']], cultureP: 0.8 },
  { dx: 'STATUS_EPILEPTICUS', w: 6, ageM: [6, 144], mv: 0.35, niv: 0, hfnc: 0.05, vaso: 0.05, los: [1, 4], die: 0.02, abx: [[], ['Ceftriaxone']], cultureP: 0.3 },
  { dx: 'GBS', w: 2, ageM: [24, 180], mv: 0.3, niv: 0.1, hfnc: 0.05, vaso: 0.05, los: [6, 20], die: 0.03, abx: [[]], cultureP: 0.1 },
  { dx: 'DENGUE', w: 4, ageM: [24, 192], mv: 0.08, niv: 0.05, hfnc: 0.15, vaso: 0.35, los: [2, 5], die: 0.04, abx: [[], ['Ceftriaxone']], cultureP: 0.2 },
  { dx: 'ASTHMA', w: 3, ageM: [24, 180], mv: 0.08, niv: 0.3, hfnc: 0.3, vaso: 0.02, los: [1, 3], die: 0.005, abx: [[], ['Azithromycin']], cultureP: 0.05 },
  { dx: 'SHOCK_HYPOVOLAEMIC', w: 4, ageM: [2, 60], mv: 0.1, niv: 0.02, hfnc: 0.05, vaso: 0.3, los: [1, 4], die: 0.05, abx: [['Ceftriaxone'], []], cultureP: 0.4 },
  { dx: 'AKI', w: 2, ageM: [6, 180], mv: 0.15, niv: 0.05, hfnc: 0.05, vaso: 0.2, los: [4, 14], die: 0.08, abx: [['Ceftriaxone'], []], cultureP: 0.4 },
  { dx: 'POISONING', w: 3, ageM: [12, 120], mv: 0.25, niv: 0, hfnc: 0.1, vaso: 0.1, los: [1, 3], die: 0.03, abx: [[]], cultureP: 0.05 },
  { dx: 'TBI', w: 2, ageM: [12, 180], mv: 0.55, niv: 0, hfnc: 0.05, vaso: 0.2, los: [3, 12], die: 0.1, abx: [[], ['Ceftriaxone']], cultureP: 0.3 },
  { dx: 'POSTOP', w: 4, ageM: [3, 180], mv: 0.25, niv: 0.05, hfnc: 0.1, vaso: 0.1, los: [1, 3], die: 0.01, abx: [['Cefazolin'], ['Ceftriaxone', 'Metronidazole']], cultureP: 0.1 },
  { dx: 'ALF', w: 1, ageM: [12, 180], mv: 0.5, niv: 0.05, hfnc: 0.1, vaso: 0.4, los: [4, 14], die: 0.3, abx: [['Ceftriaxone'], ['Meropenem']], cultureP: 0.6 },
  { dx: 'HIE', w: 1, ageM: [6, 120], mv: 0.8, niv: 0, hfnc: 0.05, vaso: 0.5, los: [3, 12], die: 0.35, abx: [['Ceftriaxone']], cultureP: 0.4 },
];

const ORG_MIX: [string, number][] = [
  ['Klebsiella pneumoniae', 18], ['Escherichia coli', 12], ['Acinetobacter baumannii', 10], ['Pseudomonas aeruginosa', 8],
  ['Staphylococcus aureus', 10], ['Coagulase-negative Staphylococci (CoNS)', 9], ['Enterobacter cloacae', 5],
  ['Streptococcus pneumoniae', 5], ['Candida albicans', 3], ['Enterococcus faecium', 3], ['Salmonella spp.', 2],
];
const GN_PANEL = ['Ampicillin', 'Ceftriaxone', 'Cefepime', 'Piperacillin-Tazobactam', 'Meropenem', 'Amikacin', 'Gentamicin', 'Ciprofloxacin', 'Colistin', 'Trimethoprim-Sulfamethoxazole (Septran/Co-trimoxazole)'];
const GP_PANEL = ['Oxacillin', 'Vancomycin', 'Linezolid', 'Clindamycin', 'Erythromycin', 'Gentamicin', 'Ciprofloxacin', 'Trimethoprim-Sulfamethoxazole (Septran/Co-trimoxazole)'];
// Baseline %R for a "typical" South-Asian PICU; a time trend is added for carbapenems to show change detection.
const BASE_R: Record<string, Record<string, number>> = {
  'Klebsiella pneumoniae': { Ampicillin: 1, Ceftriaxone: 0.75, Cefepime: 0.65, 'Piperacillin-Tazobactam': 0.5, Meropenem: 0.35, Amikacin: 0.35, Gentamicin: 0.55, Ciprofloxacin: 0.6, Colistin: 0.05 },
  'Escherichia coli': { Ampicillin: 0.85, Ceftriaxone: 0.6, Cefepime: 0.5, 'Piperacillin-Tazobactam': 0.3, Meropenem: 0.15, Amikacin: 0.15, Gentamicin: 0.4, Ciprofloxacin: 0.6, Colistin: 0.02 },
  'Acinetobacter baumannii': { Ceftriaxone: 0.95, Cefepime: 0.85, 'Piperacillin-Tazobactam': 0.85, Meropenem: 0.75, Amikacin: 0.65, Gentamicin: 0.7, Ciprofloxacin: 0.8, Colistin: 0.05 },
  'Pseudomonas aeruginosa': { Cefepime: 0.35, 'Piperacillin-Tazobactam': 0.3, Meropenem: 0.3, Amikacin: 0.2, Gentamicin: 0.3, Ciprofloxacin: 0.35, Colistin: 0.03 },
  'Enterobacter cloacae': { Ampicillin: 1, Ceftriaxone: 0.6, Cefepime: 0.4, 'Piperacillin-Tazobactam': 0.4, Meropenem: 0.2, Amikacin: 0.2, Gentamicin: 0.35, Ciprofloxacin: 0.4, Colistin: 0.05 },
  'Staphylococcus aureus': { Oxacillin: 0.45, Vancomycin: 0, Linezolid: 0, Clindamycin: 0.3, Erythromycin: 0.5, Gentamicin: 0.2, Ciprofloxacin: 0.4 },
  'Coagulase-negative Staphylococci (CoNS)': { Oxacillin: 0.75, Vancomycin: 0.02, Linezolid: 0.01, Clindamycin: 0.45, Erythromycin: 0.7, Gentamicin: 0.4, Ciprofloxacin: 0.5 },
  'Enterococcus faecium': { Ampicillin: 0.8, Vancomycin: 0.2, Linezolid: 0.02, Gentamicin: 0.6 },
  'Streptococcus pneumoniae': { Erythromycin: 0.4, Clindamycin: 0.2, Vancomycin: 0, Ceftriaxone: 0.05 },
  'Salmonella spp.': { Ampicillin: 0.6, Ceftriaxone: 0.3, Ciprofloxacin: 0.7, Meropenem: 0.01 },
};

export function seedDemo(db: DB, opts: { months?: number; now?: number } = {}) {
  const r = rng(20261008);
  const now = opts.now ?? Date.now();
  const months = opts.months ?? 15;
  const start = new Date(now); start.setMonth(start.getMonth() - months, 1); start.setHours(0, 0, 0, 0);
  const beds = 14;
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const between = (a: number, b: number) => a + r() * (b - a);
  const totalW = PROFILES.reduce((s, p) => s + p.w, 0);
  const choose = () => { let x = r() * totalW; for (const p of PROFILES) { x -= p.w; if (x <= 0) return p; } return PROFILES[0]; };
  const orgW = ORG_MIX.reduce((s, o) => s + o[1], 0);
  const chooseOrg = () => { let x = r() * orgW; for (const [o, w] of ORG_MIX) { x -= w; if (x <= 0) return o; } return ORG_MIX[0][0]; };
  const L = (t: number) => toLocal(new Date(t));

  const insPatient = db.prepare('INSERT INTO patients(id, sex, created_at) VALUES (?,?,?)');
  const insIdent = db.prepare('INSERT INTO patient_identifiers(patient_id, mrn, name, dob) VALUES (?,?,?,?)');
  const insAdm = db.prepare(`INSERT INTO admissions(id, patient_id, bed, admit_at, age_months, weight_kg, source, admission_type, chronic_condition, malnutrition,
    arrival_support, shock_on_arrival, coma_on_arrival, discharge_at, disposition, notes, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insDx = db.prepare('INSERT INTO diagnoses(admission_id, code, role) VALUES (?,?,?)');
  const insEp = db.prepare('INSERT INTO episodes(id, admission_id, kind, detail, intent, start_at, end_at, end_reason, created_at) VALUES (?,?,?,?,?,?,?,?,?)');
  const insEv = db.prepare('INSERT INTO clinical_events(id, admission_id, type, label, at, note, created_at) VALUES (?,?,?,?,?,?,?)');
  const insCult = db.prepare('INSERT INTO cultures(id, admission_id, patient_id, unit, collected_at, specimen, organism, source, created_at) VALUES (?,?,?,?,?,?,?,?,?)');
  const insRes = db.prepare('INSERT INTO susceptibility_results(culture_id, drug, result) VALUES (?,?,?)');

  const FIRST = ['Ayaan', 'Fatima', 'Zara', 'Hamza', 'Aisha', 'Omar', 'Hira', 'Bilal', 'Inaya', 'Musa', 'Eman', 'Rayyan', 'Sana', 'Ali', 'Maryam', 'Ibrahim'];
  const bedFree: number[] = Array(beds).fill(0);
  let mrnSeq = 100200;
  let count = 0;

  tx(db, () => {
    setSetting(db, 'beds', String(beds));
    setSetting(db, 'demoData', '1');
    for (let t = start.getTime(); t < now; t += DAY_MS) {
      const d = new Date(t);
      const winter = [11, 0, 1].includes(d.getMonth()) ? 1.35 : [6, 7, 8].includes(d.getMonth()) ? 1.1 : 1;
      const progress = (t - start.getTime()) / (now - start.getTime());
      const expected = 3.7 * winter * (0.9 + 0.2 * progress);
      let k = 0; const L0 = Math.exp(-expected); let pr = 1; do { k++; pr *= r(); } while (pr > L0); k -= 1;
      for (let i = 0; i < k; i++) {
        const admitT = t + between(0.5, 23.5) * 3_600_000;
        const bed = bedFree.findIndex(f => f <= admitT);
        if (bed === -1) continue; // unit full — real units would divert
        const p = choose();
        const ageM = Math.round(between(p.ageM[0], p.ageM[1]));
        const sex = r() < 0.56 ? 'M' : 'F';
        const weight = Math.round((ageM < 12 ? 3.2 + ageM * 0.55 : 9 + (ageM - 12) * 0.2) * between(0.75, 1.15) * 10) / 10;
        const isMV = r() < p.mv, isNIV = !isMV && r() < p.niv, isHF = !isMV && !isNIV && r() < p.hfnc;
        const isVaso = r() < p.vaso;
        let los = between(p.los[0], p.los[1]) * (isMV ? 1.6 : 1) * (r() < 0.08 ? 2.5 : 1);
        const died = r() < p.die * (isMV ? 2 : 0.6) * (isVaso ? 1.5 : 1);
        if (died) los *= between(0.2, 0.9);
        let dischargeT: number | null = admitT + los * DAY_MS;
        if (dischargeT > now) dischargeT = null;
        bedFree[bed] = (dischargeT ?? now + 30 * DAY_MS) + 2 * 3_600_000;

        const pid = randomUUID(), aid = randomUUID();
        insPatient.run(pid, sex, L(admitT));
        insIdent.run(pid, `MR-${mrnSeq++}`, `${pick(FIRST)} (demo)`, null);
        const source = p.dx === 'POSTOP' ? 'OT' : pick(['ED', 'ED', 'ED', 'Ward', 'Other hospital', 'Ward']);
        const arrival: RespLevel = isMV ? (r() < 0.5 ? 'MV' : 'NIV') : isNIV ? (r() < 0.5 ? 'NIV' : 'O2') : isHF ? 'HFNC' : r() < 0.4 ? 'O2' : 'RA';
        const disposition = dischargeT ? (died ? 'Died' : r() < 0.04 ? 'LAMA' : r() < 0.05 ? 'Transfer' : 'Ward') : null;
        insAdm.run(aid, pid, String(bed + 1), L(admitT), ageM, r() < 0.06 ? null : weight, source, p.dx === 'POSTOP' && r() < 0.7 ? 'elective' : 'emergency',
          r() < 0.15 ? 1 : 0, r() < 0.12 ? 1 : 0, arrival, isVaso && r() < 0.6 ? 1 : 0, (p.dx === 'STATUS_EPILEPTICUS' || p.dx === 'ENCEPHALITIS' || p.dx === 'TBI') && r() < 0.5 ? 1 : 0,
          dischargeT ? L(dischargeT) : null, disposition, null, null, L(admitT), L(admitT));
        insDx.run(aid, p.dx, 'primary');
        if (r() < 0.25) insDx.run(aid, pick(['SAM', 'AKI', 'SEVERE_ANAEMIA', 'CHD', 'SEPSIS'].filter(c => c !== p.dx)), 'secondary');

        const endT = dischargeT ?? null;
        // Respiratory course: arrival level → (escalate to MV) → step down → room air.
        const resp: [RespLevel, number][] = [];
        if (arrival !== 'RA') resp.push([arrival, admitT]);
        if (isMV && arrival !== 'MV') resp.push(['MV', admitT + between(0.1, 0.4) * los * DAY_MS]);
        if (isMV) resp.push(['NIV', admitT + between(0.55, 0.75) * los * DAY_MS]);
        if (resp.length) resp.push(['O2', admitT + between(0.8, 0.9) * los * DAY_MS]);
        resp.forEach(([lvl, s], idx) => {
          const e = resp[idx + 1]?.[1] ?? (endT ? Math.min(endT, admitT + 0.95 * los * DAY_MS) : null);
          if (s >= now) return;
          const eClamped = e && e > now ? null : e;
          insEp.run(randomUUID(), aid, 'resp', lvl, null, L(s), eClamped ? L(eClamped) : died && !resp[idx + 1] ? L(endT!) : null, eClamped ? 'changed' : null, L(s));
        });
        if (isVaso) {
          const s = admitT + between(0, 0.2) * DAY_MS, e = s + between(0.15, 0.5) * los * DAY_MS;
          insEp.run(randomUUID(), aid, 'vaso', r() < 0.6 ? 'Adrenaline' : 'Noradrenaline', null, L(s), e < now ? L(e) : null, e < now ? 'stopped' : null, L(s));
          if (r() < 0.3 && e < now) insEp.run(randomUUID(), aid, 'vaso', 'Dobutamine', null, L(s + 0.2 * DAY_MS), L(e), 'stopped', L(s));
        }
        // Antimicrobials — meropenem and colistin usage drifts upward in the final quarter to show change detection.
        let regimen = pick(p.abx);
        if (progress > 0.8 && regimen.includes('Piperacillin-Tazobactam') && r() < 0.6) regimen = regimen.map(x => (x === 'Piperacillin-Tazobactam' ? 'Meropenem' : x));
        const culture = r() < p.cultureP;
        const abxEnd = admitT + Math.min(los, between(4, 10)) * DAY_MS;
        regimen.forEach(drug => {
          const s = admitT + between(0.02, 0.15) * DAY_MS;
          const e = Math.min(abxEnd, endT ?? Infinity);
          insEp.run(randomUUID(), aid, 'abx', drug, 'empiric', L(s), e < now ? L(e) : null, e < now ? (died ? 'death' : 'completed') : null, L(s));
        });
        if (culture) {
          const cT = admitT + between(0, 0.1) * DAY_MS;
          if (cT < now) {
            insEv.run(randomUUID(), aid, 'culture_sent', 'Blood culture sent', L(cT), null, L(cT));
            const positive = r() < 0.32;
            const cid = randomUUID();
            const specimen = p.dx.includes('PNEUMONIA') && r() < 0.4 ? 'ETT' : p.dx === 'MENINGITIS' && r() < 0.5 ? 'CSF' : r() < 0.15 ? 'Urine' : 'Blood';
            const org = positive ? chooseOrg() : null;
            insCult.run(cid, aid, pid, 'PICU', L(cT).slice(0, 10), specimen, org, 'picu', L(cT));
            if (org && BASE_R[org]) {
              const panel = Object.keys(BASE_R[org]).length ? Object.keys(BASE_R[org]) : (org.includes('Staph') ? GP_PANEL : GN_PANEL);
              const carbaDrift = progress > 0.75 ? 0.15 : 0;
              panel.forEach(drug => {
                const base = BASE_R[org][drug] ?? 0.3;
                const pr = Math.min(0.98, base + (drug === 'Meropenem' ? carbaDrift : 0));
                const x = r();
                insRes.run(cid, drug, x < pr ? 'R' : x < pr + 0.05 ? 'I' : 'S');
              });
              // Culture-directed change: escalate to a reserve agent if the isolate is meropenem-resistant.
              const resultT = cT + between(2, 3) * DAY_MS;
              const merR = BASE_R[org].Meropenem !== undefined && r() < (BASE_R[org].Meropenem + carbaDrift);
              if (merR && resultT < (endT ?? now) && resultT < now) {
                const e = Math.min(resultT + between(5, 10) * DAY_MS, endT ?? Infinity);
                insEp.run(randomUUID(), aid, 'abx', 'Colistin', 'targeted', L(resultT), e < now ? L(e) : null, e < now ? 'completed' : null, L(resultT));
              }
            }
          }
        }
        if (isMV && r() < 0.06 && endT) insEv.run(randomUUID(), aid, 'complication', 'VAP', L(admitT + 0.5 * los * DAY_MS), null, L(admitT));
        if (isMV && r() < 0.04 && endT) insEv.run(randomUUID(), aid, 'complication', 'Unplanned extubation', L(admitT + 0.4 * los * DAY_MS), null, L(admitT));
        if (r() < 0.2) insEv.run(randomUUID(), aid, 'procedure', 'Central line', L(admitT + 0.1 * DAY_MS), null, L(admitT));
        count++;
      }
    }
    db.prepare("INSERT INTO audit_log(at, user_id, username, action, entity, entity_id, summary) VALUES (?, NULL, 'system', 'demo', 'system', NULL, ?)")
      .run(toLocal(new Date(now)), `Loaded ${count} synthetic demo admissions`);
  });
  return count;
}
