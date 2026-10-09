import { describe, expect, it } from 'vitest';
import { openDatabase } from '../server/db';
import { createApi } from '../server/api';
import { seedDemo } from '../server/demo';
import { monthSummary } from '../shared/analytics';
import { DX_BY_CODE, DX_CATALOGUE, DX_CATEGORIES, searchDx } from '../shared/reference';
import { suggestRiskDx } from '../shared/pim3';
import { emptyPews, phoenix, phoenix24, pewsTotal, worstPhoenix } from '../shared/scores';
import { toLocal } from '../shared/time';
import type { Dataset, Episode } from '../shared/types';
import type { VitalSet } from '../shared/vitals';

const hoursAgo = (h: number) => toLocal(new Date(Date.now() - h * 3_600_000));

describe('stewardship rate', () => {
  it('never exceeds 1,000 per 1,000 for one drug, even for a short stay', () => {
    // Admitted 16 h ago, meropenem since admission: 1 DOT over 1 day present (was 1 / 0.67 = 1,494).
    const now = new Date('2026-10-08T14:00').getTime();
    const ds: Dataset = {
      beds: 10, events: [], cultures: [],
      admissions: [{ id: 'a', patientId: 'p', bed: '1', admitAt: '2026-10-08T00:30', ageMonths: 24, sex: 'F', weightKg: 12, source: 'ED', admissionType: 'emergency', primaryDx: 'SEPSIS', secondaryDx: [], chronicCondition: false, malnutrition: false, arrivalSupport: 'RA', shockOnArrival: false, comaOnArrival: false, dischargeAt: null, disposition: null, notes: null }],
      episodes: [{ id: 'e', admissionId: 'a', kind: 'abx', detail: 'Meropenem', intent: 'empiric', startAt: '2026-10-08T01:00', endAt: null, endReason: null }],
    };
    const s = monthSummary(ds, '2026-10', now);
    expect(s.daysPresent).toBe(1);
    expect(s.dot.per1000).toBe(1000);
    expect(s.patientDays).toBeLessThan(1);
  });
});

describe('diagnosis catalogue', () => {
  it('has unique codes, known categories and ICD-10 codes', () => {
    const codes = DX_CATALOGUE.map(d => d.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.length).toBeGreaterThan(170);
    DX_CATALOGUE.forEach(d => {
      expect(DX_CATEGORIES as readonly string[]).toContain(d.category);
      expect(d.icd10).toMatch(/^[A-Z]\d{2}(\.\d{1,2})?$/);
    });
  });
  it('keeps every earlier code (stored admissions refer to them)', () => {
    ['SEPSIS', 'SEPTIC_SHOCK', 'PNEUMONIA', 'SEVERE_PNEUMONIA', 'BRONCHIOLITIS', 'DKA', 'GBS', 'POSTOP', 'POSTOP_CARDIAC', 'SAM', 'OTHER', 'MISC', 'HIE', 'ALF']
      .forEach(c => expect(DX_BY_CODE[c]).toBeTruthy());
  });
  it('finds by synonym and suggests the PIM3 group', () => {
    expect(searchDx('whooping')[0].code).toBe('PERTUSSIS');
    expect(searchDx('kerosene')[0].code).toBe('HYDROCARBON');
    expect(suggestRiskDx('HSCT')).toBe('very_high');
    expect(suggestRiskDx('HLHS')).toBe('high');
    expect(suggestRiskDx('OSA')).toBe('low');
    expect(suggestRiskDx('PNEUMONIA')).toBe('none');
  });
});

describe('patients archive', () => {
  it('searches current and past admissions; names only for clinical roles', async () => {
    const db = openDatabase(':memory:');
    const api = createApi(db);
    await api.call('auth.setup', { username: 'admin', displayName: 'A', password: 'password1' });
    seedDemo(db, { months: 3 });
    const all = await api.call('patients.search', {}) as any;
    expect(all.total).toBeGreaterThan(100);
    expect(all.rows).toHaveLength(50);
    const died = await api.call('patients.search', { status: 'died', limit: 200 }) as any;
    expect(died.rows.every((r: any) => r.admission.disposition === 'Died')).toBe(true);
    const name = all.rows[0].name.split(' ')[0];
    const byName = await api.call('patients.search', { q: name }) as any;
    expect(byName.rows.some((r: any) => r.name?.startsWith(name))).toBe(true);
    const byDx = await api.call('patients.search', { q: 'bronchiolitis', status: 'discharged' }) as any;
    expect(byDx.rows.every((r: any) => r.admission.primaryDx === 'BRONCHIOLITIS' || r.admission.secondaryDx.includes('BRONCHIOLITIS'))).toBe(true);

    await api.call('users.create', { username: 'v', displayName: 'V', role: 'viewer', password: 'password1' });
    await api.call('auth.login', { username: 'v', password: 'password1' });
    const viewer = await api.call('patients.search', { q: name }) as any;
    expect(viewer.showIdentifiers).toBe(false);
    expect(viewer.rows.every((r: any) => r.name === null)).toBe(true);
  });

  it('links other admissions of the same patient', async () => {
    const db = openDatabase(':memory:');
    const api = createApi(db);
    await api.call('auth.setup', { username: 'admin', displayName: 'A', password: 'password1' });
    const base = { mrn: 'MR-9', sex: 'M', ageMonths: 30, source: 'ED', arrivalSupport: 'RA' };
    const first = await api.call('admission.create', { ...base, admitAt: hoursAgo(200), primaryDx: 'ASTHMA' }) as { id: string };
    await api.call('admission.discharge', { id: first.id, at: hoursAgo(150), disposition: 'Ward' });
    const second = await api.call('admission.create', { ...base, admitAt: hoursAgo(5), primaryDx: 'PNEUMONIA' }) as { id: string };
    const d = await api.call('admission.get', { id: second.id }) as any;
    expect(d.previousAdmissions).toEqual([expect.objectContaining({ id: first.id, dx: 'Acute severe asthma', disposition: 'Ward' })]);
  });
});

describe('Phoenix Sepsis Score', () => {
  const ctx = { ageMonths: 30, mv: true, support: true, vasoactives: 2 };
  it('scores each organ system', () => {
    const p = phoenix({ spo2: 88, fio2: 70, lactate: 6, map: 30, platelets: 80, inr: 1.6, gcs: 9 }, ctx);
    // resp: S/F 126 on MV → 3; cardio: 2 drugs + lactate 1 + MAP < 32 (2–5 y) → 2 = 5; coag 2; neuro 1
    expect(p).toMatchObject({ resp: 3, cardio: 5, coag: 2, neuro: 1, total: 11 });
    expect(phoenix({ pupils_fixed: 1, gcs: 3 }, ctx).neuro).toBe(2);
  });
  it('gives respiratory points only with support, and reports missing inputs', () => {
    const p = phoenix({ spo2: 90 }, { ageMonths: 30, mv: false, support: false, vasoactives: 0 });
    expect(p.resp).toBe(0); // room air, no support
    expect(p.missing).toEqual(expect.arrayContaining(['lactate', 'MAP', 'coagulation labs', 'GCS']));
    expect(phoenix({ spo2: 90, fio2: 40 }, { ageMonths: 30, mv: false, support: true, vasoactives: 0 }).resp).toBe(1);
  });
  it('uses age-specific MAP bands', () => {
    const c = (ageMonths: number, map: number) => phoenix({ map }, { ageMonths, mv: false, support: false, vasoactives: 0 }).parts.map;
    expect(c(0.5, 16)).toBe(2); expect(c(0.5, 30)).toBe(1); expect(c(0.5, 31)).toBe(0);
    expect(c(200, 37)).toBe(2); expect(c(200, 51)).toBe(1); expect(c(200, 52)).toBe(0);
  });
  it('takes the worst of each part over the first 24 h, including vasoactives between readings', () => {
    const t = (h: number) => toLocal(new Date(new Date('2026-10-01T08:00').getTime() + h * 3_600_000));
    const sets: VitalSet[] = [
      { id: '1', admissionId: 'a', at: t(0.2), context: 'admission', values: { lactate: 6, map: 60, gcs: 15 } },
      { id: '2', admissionId: 'a', at: t(10), context: 'event', values: { platelets: 50, map: 40, gcs: 14 } },
    ];
    const eps: Episode[] = [
      { id: 'v1', admissionId: 'a', kind: 'vaso', detail: 'Adrenaline', intent: null, startAt: t(2), endAt: t(20), endReason: null },
      { id: 'v2', admissionId: 'a', kind: 'vaso', detail: 'Noradrenaline', intent: null, startAt: t(4), endAt: t(8), endReason: null },
    ];
    const p = phoenix24(sets, eps, t(0), 30)!;
    expect(p.parts).toEqual({ vaso: 2, lactate: 1, map: 1 });
    expect(p.cardio).toBe(4);
    expect(p.coag).toBe(1);
    expect(worstPhoenix([])).toBeNull();
  });
});

describe('PEWS (Brighton)', () => {
  it('needs all three items and adds the extras', () => {
    expect(pewsTotal({ ...emptyPews(), behaviour: 2, cardiovascular: 1 })).toBeNull();
    expect(pewsTotal({ behaviour: 2, cardiovascular: 1, respiratory: 3, nebs: true, vomiting: false })).toBe(8);
  });
});

describe('scores reach research and the patient page', () => {
  it('Explorer has Phoenix and PEWS fields with values from the demo', async () => {
    const db = openDatabase(':memory:');
    const api = createApi(db);
    await api.call('auth.setup', { username: 'admin', displayName: 'A', password: 'password1' });
    seedDemo(db, { months: 3 });
    const res = await api.call('explorer.run', { spec: { include: [], exclude: [], outcomes: [], describe: ['phoenix_24h', 'phoenix_septic_shock', 'pews_admission', 'w24_lactate_max'] } }) as any;
    const n = (id: string) => res.describe.find((d: any) => d.field === id).n;
    expect(n('phoenix_24h')).toBeGreaterThan(50);
    expect(n('pews_admission')).toBeGreaterThan(20);
    expect(n('w24_lactate_max')).toBeGreaterThan(20);
    const exp = await api.call('export.deidentified', {}) as any;
    expect(exp.csv.split('\n')[0]).toContain('phoenix_24h');
  });
  it('vitals.forAdmission returns Phoenix per moment and for the first 24 h', async () => {
    const db = openDatabase(':memory:');
    const api = createApi(db);
    await api.call('auth.setup', { username: 'admin', displayName: 'A', password: 'password1' });
    const { id } = await api.call('admission.create', {
      mrn: 'MR-P', sex: 'F', ageMonths: 30, admitAt: hoursAgo(3), source: 'ED', primaryDx: 'SEPTIC_SHOCK', arrivalSupport: 'MV',
      vasoactives: ['Adrenaline'], shockOnArrival: true, antimicrobials: ['Meropenem'],
      vitals: { spo2: 90, fio2: 60, sbp: 60, dbp: 30, lactate: 7, platelets: 70, gcs: 9, pews: 9 },
    }) as { id: string };
    const v = await api.call('vitals.forAdmission', { admissionId: id }) as any;
    expect(v.sets[0].phoenix.total).toBeGreaterThanOrEqual(6);
    expect(v.phoenix24).toMatchObject({ sepsis: true, septicShock: true, infectionSuspected: true });
  });
});
