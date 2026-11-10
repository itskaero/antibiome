// ═══════════════════════════════════════════════════════════
//  Weight-based emergency drugs and infusions.
//
//  Defaults follow APLS (6th ed.) / PALS 2020 and are meant to be checked and, where the unit differs,
//  edited by an administrator (setting `drugTable`); until an administrator marks the table reviewed,
//  every sheet says so. All arithmetic is here so it can be tested; the screens only display it.
// ═══════════════════════════════════════════════════════════

export type DoseUnit = 'mcg' | 'mg' | 'mL' | 'mmol' | 'J';
export interface EmergencyDrug {
  id: string; name: string; indication: string; route: string;
  /** Dose per kg, in `unit`. */
  perKg: number; unit: DoseUnit;
  /** Largest single dose, in `unit` (null = none). */
  max: number | null;
  /** Concentration in `unit` per mL (null when the dose is itself a volume or energy). */
  concPerMl: number | null;
  /** How the concentration is described on the ampoule / preparation. */
  preparation?: string;
  note?: string;
}
export type InfusionUnit = 'mcg/kg/min' | 'mcg/kg/h' | 'mg/kg/h';
export interface Infusion {
  id: string; name: string; unit: InfusionUnit; range: [number, number]; start: number;
  /** Weight-based make-up: `mgPerKg` mg/kg made up to `volumeMl` mL gives 1 mL/h = `oneMlH` (in `unit`). */
  makeUp: { mgPerKg: number; volumeMl: number; diluent: string };
  note?: string;
}
export interface DrugTable { emergency: EmergencyDrug[]; infusions: Infusion[]; defibJPerKg: number; defibMaxJ: number; cardioversionJPerKg: [number, number] }

export const DEFAULT_DRUG_TABLE: DrugTable = {
  emergency: [
    { id: 'adrenaline', name: 'Adrenaline', indication: 'Cardiac arrest', route: 'IV / IO', perKg: 10, unit: 'mcg', max: 1000, concPerMl: 100, preparation: '1:10 000 (100 mcg/mL)', note: 'Every 3–5 min' },
    { id: 'atropine', name: 'Atropine', indication: 'Vagal bradycardia', route: 'IV / IO', perKg: 20, unit: 'mcg', max: 600, concPerMl: 600, preparation: '600 mcg/mL' },
    { id: 'amiodarone', name: 'Amiodarone', indication: 'Shock-refractory VF / pVT', route: 'IV / IO', perKg: 5, unit: 'mg', max: 300, concPerMl: 50, preparation: '50 mg/mL (flush with 5% glucose)', note: 'After the 3rd and 5th shocks' },
    { id: 'adenosine1', name: 'Adenosine (1st)', indication: 'SVT', route: 'IV rapid push + flush', perKg: 0.1, unit: 'mg', max: 6, concPerMl: 3, preparation: '3 mg/mL' },
    { id: 'adenosine2', name: 'Adenosine (2nd)', indication: 'SVT', route: 'IV rapid push + flush', perKg: 0.2, unit: 'mg', max: 12, concPerMl: 3, preparation: '3 mg/mL' },
    { id: 'bolus', name: 'Fluid bolus', indication: 'Shock', route: 'IV / IO', perKg: 10, unit: 'mL', max: 500, concPerMl: null, preparation: '0.9% saline or balanced crystalloid', note: 'Reassess after each bolus' },
    { id: 'dextrose', name: 'Glucose 10%', indication: 'Hypoglycaemia', route: 'IV / IO', perKg: 2, unit: 'mL', max: 250, concPerMl: null, preparation: '10% dextrose' },
    { id: 'calcium', name: 'Calcium gluconate 10%', indication: 'Hypocalcaemia / hyperkalaemia', route: 'IV slowly', perKg: 0.5, unit: 'mL', max: 20, concPerMl: null, preparation: '10% (0.22 mmol/mL)' },
    { id: 'bicarbonate', name: 'Sodium bicarbonate 8.4%', indication: 'Prolonged arrest / hyperkalaemia', route: 'IV / IO', perKg: 1, unit: 'mL', max: 50, concPerMl: null, preparation: '8.4% (1 mmol/mL)', note: 'Dilute 1:1 in infants' },
    { id: 'lorazepam', name: 'Lorazepam', indication: 'Status epilepticus', route: 'IV / IO', perKg: 0.1, unit: 'mg', max: 4, concPerMl: 4, preparation: '4 mg/mL (dilute)' },
    { id: 'midazolam', name: 'Midazolam', indication: 'Status epilepticus', route: 'IV / IO', perKg: 0.15, unit: 'mg', max: 10, concPerMl: 5, preparation: '5 mg/mL' },
    { id: 'ketamine', name: 'Ketamine', indication: 'Induction', route: 'IV', perKg: 2, unit: 'mg', max: 150, concPerMl: 10, preparation: '10 mg/mL (diluted)' },
    { id: 'rocuronium', name: 'Rocuronium', indication: 'Intubation', route: 'IV', perKg: 1, unit: 'mg', max: 100, concPerMl: 10, preparation: '10 mg/mL' },
    { id: 'fentanyl', name: 'Fentanyl', indication: 'Analgesia / induction', route: 'IV', perKg: 1, unit: 'mcg', max: 100, concPerMl: 50, preparation: '50 mcg/mL' },
  ],
  infusions: [
    { id: 'adrenaline', name: 'Adrenaline', unit: 'mcg/kg/min', range: [0.05, 1], start: 0.1, makeUp: { mgPerKg: 0.3, volumeMl: 50, diluent: '5% glucose or 0.9% saline' } },
    { id: 'noradrenaline', name: 'Noradrenaline', unit: 'mcg/kg/min', range: [0.05, 1], start: 0.1, makeUp: { mgPerKg: 0.3, volumeMl: 50, diluent: '5% glucose' } },
    { id: 'dopamine', name: 'Dopamine', unit: 'mcg/kg/min', range: [5, 20], start: 10, makeUp: { mgPerKg: 30, volumeMl: 50, diluent: '5% glucose or 0.9% saline' } },
    { id: 'dobutamine', name: 'Dobutamine', unit: 'mcg/kg/min', range: [5, 20], start: 10, makeUp: { mgPerKg: 30, volumeMl: 50, diluent: '5% glucose or 0.9% saline' } },
    { id: 'milrinone', name: 'Milrinone', unit: 'mcg/kg/min', range: [0.25, 0.75], start: 0.5, makeUp: { mgPerKg: 1.5, volumeMl: 50, diluent: '5% glucose or 0.9% saline' } },
    { id: 'midazolam', name: 'Midazolam', unit: 'mcg/kg/min', range: [1, 4], start: 1, makeUp: { mgPerKg: 3, volumeMl: 50, diluent: '5% glucose or 0.9% saline' } },
    { id: 'morphine', name: 'Morphine', unit: 'mcg/kg/h', range: [10, 40], start: 20, makeUp: { mgPerKg: 1, volumeMl: 50, diluent: '5% glucose or 0.9% saline' } },
    { id: 'fentanyl', name: 'Fentanyl', unit: 'mcg/kg/h', range: [1, 4], start: 1, makeUp: { mgPerKg: 0.05, volumeMl: 50, diluent: '0.9% saline' } },
  ],
  defibJPerKg: 4, defibMaxJ: 200, cardioversionJPerKg: [1, 2],
};

// ── Rounding ──
/** Volumes a syringe can measure: 0.01 mL under 1 mL, 0.1 mL under 10 mL, 0.5 mL under 50, else whole mL. */
export const roundMl = (ml: number) => ml < 1 ? Math.round(ml * 100) / 100 : ml < 10 ? Math.round(ml * 10) / 10 : ml < 50 ? Math.round(ml * 2) / 2 : Math.round(ml);
/** Doses to 2–3 significant figures. */
export const roundDose = (x: number) => x >= 100 ? Math.round(x) : x >= 10 ? Math.round(x * 10) / 10 : Math.round(x * 100) / 100;

// ── Weight and airway ──
/** APLS weight estimate (only when no weight is recorded — always shown as an estimate). */
export function estimatedWeight(ageMonths: number): number {
  const y = ageMonths / 12;
  if (ageMonths < 12) return Math.round((0.5 * ageMonths + 4) * 10) / 10;
  if (y < 6) return Math.round(2 * Math.floor(y) + 8);
  return Math.round(3 * Math.floor(Math.min(y, 12)) + 7);
}
/** Endotracheal tube internal diameter (mm) and oral length at the lips (cm). */
export function ettSize(ageMonths: number): { cuffed: number; uncuffed: number; lengthCm: number } {
  const y = ageMonths / 12;
  if (ageMonths < 1) return { cuffed: 3.0, uncuffed: 3.5, lengthCm: 9.5 };
  if (ageMonths < 12) return { cuffed: 3.5, uncuffed: 4.0, lengthCm: ageMonths < 6 ? 10.5 : 11.5 };
  const uncuffed = Math.round((Math.floor(y) / 4 + 4) * 2) / 2;
  const cuffed = Math.round((Math.floor(y) / 4 + 3.5) * 2) / 2;
  return { cuffed, uncuffed, lengthCm: Math.round(Math.floor(y) / 2 + 12) };
}

export interface SheetLine { id: string; name: string; indication: string; route: string; dose: number; unit: DoseUnit; capped: boolean; volumeMl: number | null; preparation?: string; note?: string }
export interface EmergencySheet { weightKg: number; estimated: boolean; lines: SheetLine[]; defibJ: number; cardioversionJ: [number, number]; ett: ReturnType<typeof ettSize> | null }

export function emergencySheet(weightKg: number | null, ageMonths: number | null, table: DrugTable = DEFAULT_DRUG_TABLE): EmergencySheet | null {
  const estimated = !(weightKg && weightKg > 0);
  const w = estimated ? (ageMonths != null ? estimatedWeight(ageMonths) : null) : weightKg!;
  if (!w) return null;
  const lines = table.emergency.map(d => {
    const raw = d.perKg * w;
    const capped = d.max != null && raw > d.max;
    const dose = roundDose(capped ? d.max! : raw);
    const volumeMl = d.unit === 'mL' ? roundMl(dose) : d.concPerMl ? roundMl(dose / d.concPerMl) : null;
    return { id: d.id, name: d.name, indication: d.indication, route: d.route, dose: d.unit === 'mL' ? roundMl(dose) : dose, unit: d.unit, capped, volumeMl, preparation: d.preparation, note: d.note };
  });
  const j = (perKg: number) => Math.min(table.defibMaxJ, Math.round(perKg * w));
  return { weightKg: w, estimated, lines, defibJ: j(table.defibJPerKg), cardioversionJ: [j(table.cardioversionJPerKg[0]), j(table.cardioversionJPerKg[1])], ett: ageMonths != null ? ettSize(ageMonths) : null };
}

// ── Infusions ──
/** Drug amount per mL of the syringe, in micrograms. */
export const concMcgPerMl = (mgInSyringe: number, volumeMl: number) => (mgInSyringe * 1000) / volumeMl;
const perHour = (unit: InfusionUnit) => unit === 'mcg/kg/min' ? 60 : 1;
const mcgFactor = (unit: InfusionUnit) => unit === 'mg/kg/h' ? 1000 : 1;

/** mL/h for a dose (in the infusion's unit), weight and syringe concentration (mcg/mL). */
export function infusionRate(dose: number, unit: InfusionUnit, weightKg: number, mcgPerMl: number): number {
  return Math.round(((dose * mcgFactor(unit) * weightKg * perHour(unit)) / mcgPerMl) * 100) / 100;
}
/** The dose (in the infusion's unit) delivered by a rate in mL/h. */
export function doseFromRate(mlPerH: number, unit: InfusionUnit, weightKg: number, mcgPerMl: number): number {
  return Math.round(((mlPerH * mcgPerMl) / (mcgFactor(unit) * weightKg * perHour(unit))) * 1000) / 1000;
}
/** Weight-based syringe: how much drug in how much diluent, and what 1 mL/h delivers. */
export function makeUp(inf: Infusion, weightKg: number) {
  const mg = roundDose(inf.makeUp.mgPerKg * weightKg);
  const mcgPerMl = concMcgPerMl(mg, inf.makeUp.volumeMl);
  return { mg, volumeMl: inf.makeUp.volumeMl, diluent: inf.makeUp.diluent, mcgPerMl, oneMlPerH: doseFromRate(1, inf.unit, weightKg, mcgPerMl) };
}

/** Validates an administrator-edited table; throws a readable message. */
export function validateDrugTable(t: any): DrugTable {
  const num = (x: unknown, what: string) => { if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) throw new Error(`${what} must be a number`); return x; };
  if (!t || !Array.isArray(t.emergency) || !Array.isArray(t.infusions)) throw new Error('The table needs "emergency" and "infusions" lists');
  for (const d of t.emergency) {
    if (!d.id || !d.name) throw new Error('Every drug needs an id and a name');
    num(d.perKg, `${d.name}: dose per kg`); if (d.max != null) num(d.max, `${d.name}: maximum`); if (d.concPerMl != null) num(d.concPerMl, `${d.name}: concentration`);
    if (!['mcg', 'mg', 'mL', 'mmol', 'J'].includes(d.unit)) throw new Error(`${d.name}: unknown unit`);
  }
  for (const i of t.infusions) {
    if (!['mcg/kg/min', 'mcg/kg/h', 'mg/kg/h'].includes(i.unit)) throw new Error(`${i.name}: unknown unit`);
    num(i.makeUp?.mgPerKg, `${i.name}: mg/kg`); num(i.makeUp?.volumeMl, `${i.name}: volume`);
  }
  num(t.defibJPerKg, 'Defibrillation J/kg'); num(t.defibMaxJ, 'Defibrillation maximum');
  return t as DrugTable;
}
