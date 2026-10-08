import { describe, expect, it } from 'vitest';
import { pim3Logit, pim3Risk, smr, suggestRiskDx, validatePim3, type Pim3Input } from '../shared/pim3';
import { smrFor } from '../shared/analytics';
import { openDatabase } from '../server/db';
import { createApi } from '../server/api';
import { toLocal } from '../shared/time';

const base: Pim3Input = { pupilsFixed: false, elective: false, mvFirstHour: false, baseExcess: null, sbp: null, fio2: null, pao2: null, recovery: 'none', riskDx: 'none' };

describe('PIM3', () => {
  it('baseline (all defaults) gives the published constant-driven low risk', () => {
    // -1.7928 - 0.0431*120 + 0.1716*14.4 + 0.4214*0.23
    expect(pim3Logit(base)).toBeCloseTo(-4.3966, 3);
    expect(pim3Risk(base)).toBeCloseTo(0.0122, 3);
  });
  it('moves in the expected direction for each risk factor', () => {
    const r0 = pim3Risk(base);
    expect(pim3Risk({ ...base, pupilsFixed: true })).toBeGreaterThan(r0 * 10);
    expect(pim3Risk({ ...base, mvFirstHour: true })).toBeGreaterThan(r0);
    expect(pim3Risk({ ...base, riskDx: 'low' })).toBeLessThan(r0);
    expect(pim3Risk({ ...base, recovery: 'bypass_cardiac' })).toBeLessThan(r0);
    expect(pim3Risk({ ...base, sbp: 30 })).toBeGreaterThan(r0);
    expect(pim3Risk({ ...base, fio2: 1, pao2: 50 })).toBeGreaterThan(r0);
  });
  it('validates input and accepts FiO2 as a percentage', () => {
    expect(validatePim3({ fio2: 60, pao2: 80 }).fio2).toBe(0.6);
    expect(() => validatePim3({ sbp: 400 })).toThrow('Systolic BP');
    expect(suggestRiskDx('BRONCHIOLITIS')).toBe('low');
    expect(suggestRiskDx('CARDIAC_ARREST')).toBe('very_high');
  });
  it('SMR with Byar 95% CI', () => {
    const r = smr(10, 10)!;
    expect(r.smr).toBe(1);
    expect(r.lo).toBeCloseTo(0.48, 1);
    expect(r.hi).toBeCloseTo(1.84, 1);
    expect(smr(0, 2)!.lo).toBe(0);
    expect(smrFor([{ disposition: 'Died', pim3Risk: 0.5 }, { disposition: 'Ward', pim3Risk: 0.5 }, { disposition: 'Ward', pim3Risk: null }] as any))
      .toMatchObject({ observed: 1, expected: 1, n: 2 });
  });
  it('is stored with the admission and feeds SMR', async () => {
    const db = openDatabase(':memory:');
    const api = createApi(db);
    await api.call('auth.setup', { username: 'a', displayName: 'A', password: 'password1' });
    const at = toLocal(new Date(Date.now() - 50 * 3_600_000));
    const { id } = await api.call('admission.create', { mrn: 'P1', sex: 'F', ageMonths: 20, admitAt: at, source: 'ED', primaryDx: 'SEPSIS', arrivalSupport: 'MV',
      pim3: { mvFirstHour: true, sbp: 60, baseExcess: -10 } }) as any;
    const detail = await api.call('admission.get', { id }) as any;
    expect(detail.pim3.risk).toBeGreaterThan(0.05);
    expect(detail.pim3Suggestion.mvFirstHour).toBe(true);
    await api.call('admission.discharge', { id, at: toLocal(new Date(Date.now() - 3_600_000)), disposition: 'Died' });
    const dash = await api.call('dashboard.get', {}) as any;
    expect(dash.current.smr ?? dash.previous.smr).toMatchObject({ observed: 1, n: 1 });
    const { csv } = await api.call('export.deidentified', {}) as any;
    expect(csv.split('\n')[0]).toContain('pim3_risk');
  });
});
