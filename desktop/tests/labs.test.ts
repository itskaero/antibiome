import { describe, expect, it } from 'vitest';
import { derivedLabs, labFlag, parseLabText, rangeLabel } from '../shared/labs';
import { validateVitals } from '../shared/vitals';
import { openDatabase } from '../server/db';
import { createApi } from '../server/api';
import { toLocal } from '../shared/time';

describe('lab reference flags', () => {
  it('uses age bands and critical limits', () => {
    expect(labFlag('hb', 100, 6)).toBeNull();          // normal for an infant
    expect(labFlag('hb', 100, 180)).toBe('L');         // low for a teenager
    expect(labFlag('hb', 65, 180)).toBe('LL');
    expect(labFlag('k', 6.8, 24)).toBe('HH');
    expect(labFlag('na', 147, 24)).toBe('H');
    expect(labFlag('crp', 3, 24)).toBeNull();
    expect(labFlag('bili', 250, 0.5)).toBeNull();      // neonatal jaundice needs a nomogram, not a flag
    expect(rangeLabel('creat', 30)).toBe('18–42');
  });
  it('derives anion gap, P/F and eGFR', () => {
    const d = derivedLabs({ na: 138, cl: 104, hco3: 14, pao2: 80, fio2: 40, creat: 40 }, { heightCm: 100 });
    expect(Object.fromEntries(d.map(x => [x.id, x.value]))).toEqual({ ag: 20, pf: 200, egfr: 91 });
  });
  it('validates lab values through the shared vitals rules', () => {
    expect(validateVitals({ na: '138', k: 4.23, ph: 7.314 })).toEqual({ na: 138, k: 4.2, ph: 7.31 });
    expect(() => validateVitals({ na: 400 })).toThrow('Sodium');
  });
});

describe('pasting a lab report', () => {
  it('reads a typical report and converts conventional units to SI', () => {
    const report = [
      'COMPLETE BLOOD COUNT', 'Hb 11.2 g/dL  (11.5 - 15.5)', 'TLC 12,500 /cmm', 'Neutrophils 9,800', 'Platelets 2.1 lakh',
      'Urea 28 mg/dL', 'Creatinine 0.6 mg/dL', 'Na+ 134 mmol/L', 'K+ 3.2', 'Cl- 101', 'HCO3 14',
      'pH 7.31', 'pCO2 52 mmHg', 'BE -6.4', 'CRP 48 mg/L', 'Procalcitonin 2.35 ng/mL', 'SGPT 64 U/L', 'Albumin 3.1 g/dL',
    ].join('\n');
    const { values, unmatched } = parseLabText(report);
    const v = Object.fromEntries(values.map(x => [x.code, x.value]));
    expect(v).toEqual({ hb: 112, wbc: 12.5, neut: 9.8, platelets: 210, urea: 4.7, creat: 53, na: 134, k: 3.2, cl: 101, hco3: 14,
      ph: 7.31, pco2: 52, be: -6.4, crp: 48, pct: 2.35, alt: 64, alb: 31 });
    expect(values.find(x => x.code === 'hb')!.note).toBe('from g/dL');
    expect(values.find(x => x.code === 'platelets')!.note).toMatch(/lakh/);
    expect(unmatched).toEqual([]);
  });
  it('ignores values outside the plausible range instead of guessing', () => {
    const { values, unmatched } = parseLabText('Sodium 1340\nPotassium 4.1');
    expect(values.map(x => x.code)).toEqual(['k']);
    expect(unmatched).toEqual(['Sodium 1340']);
  });
});

describe('labs through the API', () => {
  it('saves a lab-only set without counting it as vital signs', async () => {
    const db = openDatabase(':memory:'); const api = createApi(db);
    await api.call('auth.setup', { username: 'admin', displayName: 'A', password: 'correct horse', unitName: 'PICU', beds: 4 });
    const { id } = await api.call('admission.create', { mrn: 'MR-77', name: 'Lab Child', sex: 'F', ageMonths: 30, weightKg: 12, admitAt: toLocal(new Date(Date.now() - 6 * 3_600_000)), source: 'ED', primaryDx: 'PNEUMONIA', arrivalSupport: 'RA' }) as any;
    await api.call('vitals.add', { admissionId: id, context: 'routine', values: { hb: 112, crp: 48, k: 3.2 } });
    const r = await api.call('vitals.forAdmission', { admissionId: id }) as any;
    expect(r.sets[0].values).toMatchObject({ hb: 112, crp: 48, k: 3.2 });
  });
});
