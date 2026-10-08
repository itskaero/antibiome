import { describe, expect, it } from 'vitest';
import { isMDR, relevantResistantClasses, getOrganismGroup } from '../shared/mdr';
import { buildAntibiogram } from '../shared/antibiogram';
import { fisherExact, medianIqr, poissonRateTest, wilson } from '../shared/stats';
import { calendarDaysTouched, monthBounds, ms } from '../shared/time';
import { monthSummary, detectChanges, dailyCensus } from '../shared/analytics';
import { runQualityChecks } from '../shared/quality';
import { searchDx } from '../shared/reference';
import type { Admission, Culture, Dataset, Episode } from '../shared/types';

const culture = (o: Partial<Culture>): Culture => ({
  id: Math.random().toString(36), admissionId: null, patientId: null, unit: 'PICU', collectedAt: '2026-05-01',
  specimen: 'Blood', organism: 'Klebsiella pneumoniae', ageGroup: null, antibiotics: [], source: 'picu', ...o,
});
const adm = (o: Partial<Admission>): Admission => ({
  id: Math.random().toString(36), patientId: Math.random().toString(36), bed: '1', admitAt: '2026-05-01T10:00', ageMonths: 24, sex: 'M',
  weightKg: 12, source: 'ED', admissionType: 'emergency', primaryDx: 'PNEUMONIA', secondaryDx: [], chronicCondition: false,
  malnutrition: false, arrivalSupport: 'RA', shockOnArrival: false, comaOnArrival: false, dischargeAt: null, disposition: null, notes: null, ...o,
});
const ep = (o: Partial<Episode>): Episode => ({ id: Math.random().toString(36), admissionId: '', kind: 'abx', detail: 'Meropenem', intent: 'empiric', startAt: '', endAt: null, endReason: null, ...o });

describe('MDR v1 (parity with original app.js)', () => {
  it('classifies organism groups exactly as before', () => {
    expect(getOrganismGroup('Klebsiella pneumoniae')).toBe('gram-negative');
    expect(getOrganismGroup('Coagulase-negative Staphylococci (CoNS)')).toBe('gram-positive');
    expect(getOrganismGroup('Candida auris')).toBe('fungal');
    expect(getOrganismGroup('Mystery bug')).toBe('unknown');
  });
  it('flags ≥3 relevant non-susceptible categories, counting I as non-susceptible', () => {
    const c = culture({ antibiotics: [{ name: 'Ceftriaxone', result: 'R' }, { name: 'Meropenem', result: 'I' }, { name: 'Amikacin', result: 'R' }, { name: 'Colistin', result: 'S' }] });
    expect(relevantResistantClasses(c).sort()).toEqual(['Aminoglycosides', 'Carbapenems', 'Cephalosporins']);
    expect(isMDR(c)).toBe(true);
  });
  it('ignores categories not relevant to the organism group', () => {
    // Glycopeptides are not a gram-negative category in v1.
    const c = culture({ antibiotics: [{ name: 'Ceftriaxone', result: 'R' }, { name: 'Vancomycin', result: 'R' }, { name: 'Amikacin', result: 'R' }] });
    expect(isMDR(c)).toBe(false);
  });
});

describe('antibiogram', () => {
  const cs = [
    culture({ patientId: 'p1', collectedAt: '2026-01-01', antibiotics: [{ name: 'Meropenem', result: 'S' }] }),
    culture({ patientId: 'p1', collectedAt: '2026-01-05', antibiotics: [{ name: 'Meropenem', result: 'R' }] }),
    culture({ patientId: 'p2', collectedAt: '2026-01-02', antibiotics: [{ name: 'Meropenem', result: 'I' }] }),
    culture({ organism: null }),
  ];
  it('computes %S = S/(S+I+R) and ignores no-growth cultures', () => {
    const ab = buildAntibiogram(cs);
    expect(ab.rows[0].cells.Meropenem).toMatchObject({ S: 1, I: 1, R: 1, n: 3, pctS: 33 });
  });
  it('first-isolate de-duplication keeps the earliest isolate per patient', () => {
    const ab = buildAntibiogram(cs, { firstIsolateOnly: true });
    expect(ab.rows[0].cells.Meropenem).toMatchObject({ S: 1, I: 1, R: 0, n: 2 });
    expect(ab.duplicatesRemoved).toBe(1);
  });
});

describe('stats', () => {
  it('Fisher exact matches the textbook tea-tasting value', () => {
    expect(fisherExact(3, 1, 1, 3)).toBeCloseTo(0.4857, 3);
  });
  it('Poisson rate test is non-significant for equal rates and significant for large differences', () => {
    expect(poissonRateTest(10, 30, 10, 30)).toBeCloseTo(1, 5);
    expect(poissonRateTest(60, 30, 20, 30)).toBeLessThan(0.001);
  });
  it('median/IQR and Wilson interval', () => {
    expect(medianIqr([1, 2, 3, 4, 100])).toMatchObject({ median: 3, q1: 2, q3: 4 });
    const [lo, hi] = wilson(5, 10);
    expect(lo).toBeCloseTo(0.237, 2); expect(hi).toBeCloseTo(0.763, 2);
  });
});

describe('time helpers', () => {
  it('counts calendar days of therapy inside a period', () => {
    const [p, q] = monthBounds('2026-05');
    expect(calendarDaysTouched(ms('2026-05-01T22:00'), ms('2026-05-03T01:00'), p, q)).toBe(3);
    expect(calendarDaysTouched(ms('2026-04-29T10:00'), ms('2026-05-02T10:00'), p, q)).toBe(2);
  });
});

describe('analytics', () => {
  const now = ms('2026-06-15T12:00');
  const a1 = adm({ id: 'a1', admitAt: '2026-05-01T10:00', dischargeAt: '2026-05-05T10:00', disposition: 'Ward', arrivalSupport: 'MV' });
  const a2 = adm({ id: 'a2', admitAt: '2026-05-10T10:00', dischargeAt: '2026-05-11T10:00', disposition: 'Died', primaryDx: 'SEPSIS' });
  const a3 = adm({ id: 'a3', admitAt: '2026-05-30T10:00', dischargeAt: null });
  const ds: Dataset = {
    admissions: [a1, a2, a3], beds: 10, events: [], cultures: [],
    episodes: [
      ep({ admissionId: 'a1', kind: 'resp', detail: 'MV', startAt: '2026-05-01T10:00', endAt: '2026-05-03T10:00' }),
      ep({ admissionId: 'a1', kind: 'abx', detail: 'Meropenem', startAt: '2026-05-01T11:00', endAt: '2026-05-04T09:00' }),
      ep({ admissionId: 'a2', kind: 'vaso', detail: 'Adrenaline', startAt: '2026-05-10T10:00', endAt: '2026-05-11T10:00' }),
      ep({ admissionId: 'a2', kind: 'vaso', detail: 'Noradrenaline', startAt: '2026-05-10T10:00', endAt: '2026-05-11T10:00' }),
    ],
  };
  const s = monthSummary(ds, '2026-05', now);
  it('counts admissions, deaths and mortality among discharges', () => {
    expect(s.admissions).toBe(3);
    expect(s.discharges).toBe(2);
    expect(s.deaths).toBe(1);
    expect(s.mortalityPct).toBe(50);
  });
  it('computes patient-days with partial overlap at month end', () => {
    // a1: 4 d, a2: 1 d, a3: May 30 10:00 → Jun 1 00:00 = 1.583 d
    expect(s.patientDays).toBeCloseTo(4 + 1 + 1 + 14 / 24, 2);
  });
  it('computes ventilation days, DOT, and counts concurrent vasoactives once', () => {
    expect(s.support.MV).toEqual({ patients: 1, days: 2 });
    expect(s.dot.byDrug.Meropenem).toBe(4);
    expect(s.vaso.days).toBeCloseTo(1, 5);
  });
  it('builds a morning census and refuses to project into the future', () => {
    const c = dailyCensus(ds, '2026-06', now);
    expect(c[0]).toBe(1); // a3 still admitted on 1 June
    expect(c[20]).toBeNull();
  });
  it('change detection stays quiet on tiny numbers', () => {
    expect(detectChanges(ds, '2026-06', now).notices).toHaveLength(0);
  });
});

describe('data quality', () => {
  it('flags impossible and implausible entries', () => {
    const bad = adm({ id: 'b', ageMonths: 300, admitAt: '2026-05-05T10:00', dischargeAt: '2026-05-04T10:00', weightKg: 90 });
    const ds: Dataset = { admissions: [bad], beds: 10, events: [], cultures: [], episodes: [
      ep({ admissionId: 'b', startAt: '2026-05-06T10:00', endAt: '2026-05-05T10:00' }),
    ] };
    const rules = runQualityChecks(ds, ms('2026-06-01T00:00')).map(i => i.rule);
    expect(rules).toEqual(expect.arrayContaining(['age', 'dischargeBeforeAdmit', 'episodeOrder']));
  });
});

describe('diagnosis search', () => {
  it('finds by synonym and ICD-10', () => {
    expect(searchDx('lrti')[0].code).toBe('PNEUMONIA');
    expect(searchDx('G61')[0].code).toBe('GBS');
    expect(searchDx('dka')[0].code).toBe('DKA');
  });
});
