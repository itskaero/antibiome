import { describe, expect, it } from 'vitest';
import { admissionSet, ageBand, flags24, sfRatio, shockIndex, validateVitals, vitalFlags, worst24, type VitalSet } from '../shared/vitals';

const set = (at: string, values: VitalSet['values'], context: VitalSet['context'] = 'routine'): VitalSet => ({ id: at, admissionId: 'a', at, context, values });

describe('vital validation', () => {
  it('accepts plausible values, rounds, and derives MAP', () => {
    expect(validateVitals({ hr: '142', sbp: 90, dbp: 60, temp: 38.46 })).toEqual({ hr: 142, sbp: 90, dbp: 60, temp: 38.5, map: 70 });
  });
  it('rejects impossible values and DBP ≥ SBP', () => {
    expect(() => validateVitals({ hr: 400 })).toThrow('Heart rate');
    expect(() => validateVitals({ sbp: 60, dbp: 70 })).toThrow('lower than systolic');
    expect(() => validateVitals({})).toThrow('at least one');
  });
});

describe('age-specific flags (IPSCC 2005)', () => {
  it('uses the right age band', () => {
    expect(ageBand(0.1).label).toBe('0–7 days');
    expect(ageBand(6).label).toBe('1 month–1 year');
    expect(ageBand(18).label).toBe('1–5 years');
    expect(ageBand(100).label).toBe('6–12 years');
    expect(ageBand(200).label).toBe('13–18 years');
  });
  it('the same heart rate is normal for an infant and tachycardic for a teenager', () => {
    expect(vitalFlags({ hr: 150 }, 6)).toEqual([]);
    expect(vitalFlags({ hr: 150 }, 180)).toEqual(['tachycardia']);
    expect(vitalFlags({ sbp: 90, spo2: 88, temp: 39, gcs: 7, crt: 4 }, 30).sort()).toEqual(['coma', 'fever', 'hypotension', 'hypoxaemia', 'prolonged_crt']);
  });
  it('derived ratios', () => {
    expect(sfRatio({ spo2: 90, fio2: 60 })).toBe(150);
    expect(sfRatio({ spo2: 99, fio2: 60 })).toBeNull(); // S/F not valid above 97%
    expect(shockIndex({ hr: 180, sbp: 90 })).toBe(2);
  });
});

describe('key moments', () => {
  const admit = '2026-05-01T10:00';
  const sets = [
    set('2026-05-01T10:20', { hr: 160, sbp: 85, spo2: 91, fio2: 50, temp: 38.9 }),
    set('2026-05-01T18:00', { hr: 175, sbp: 78, spo2: 94, fio2: 40, temp: 36.8 }),
    set('2026-05-03T10:00', { hr: 110, sbp: 70 }), // after 24 h — ignored for worst24
  ];
  it('admission set is the first within an hour', () => {
    expect(admissionSet(sets, admit)?.values.hr).toBe(160);
    expect(admissionSet([set('2026-05-01T14:00', { hr: 1 + 99 }, 'admission')], admit)?.values.hr).toBe(100);
  });
  it('worst 24 h is direction-aware and ignores later sets', () => {
    const w = worst24(sets, admit)!;
    expect(w.values).toMatchObject({ hr: 175, sbp: 78, spo2: 91, tempMax: 38.9, tempMin: 36.8 });
    expect(w.sfMin).toBe(182);
    expect(w.sets).toBe(2);
    expect(flags24(sets, admit, 30)).toEqual(expect.arrayContaining(['tachycardia', 'hypotension', 'hypoxaemia', 'fever']));
  });
});

// ── Integration: API, Explorer, protocols, export, PIM3 pre-fill ──
import { openDatabase } from '../server/db';
import { createApi } from '../server/api';
import { seedDemo } from '../server/demo';
import { toLocal } from '../shared/time';
import { vitalFeatures } from '../shared/vitals';

const hoursAgo = (h: number) => toLocal(new Date(Date.now() - h * 3_600_000));
const setupApi = async () => {
  const db = openDatabase(':memory:');
  const api = createApi(db);
  await api.call('auth.setup', { username: 'admin', displayName: 'Dr Admin', password: 'correct horse', unitName: 'PICU', beds: 10 });
  return { db, api };
};

describe('research features', () => {
  it('missing flags stay missing when the vital was not measured', () => {
    const f = vitalFeatures([set('2026-01-01T10:20', { hr: 190, spo2: 88, fio2: 50 })], '2026-01-01T10:00', 30);
    expect(f.vit_adm_hr).toBe(190);
    expect(f.vit_adm_flags).toEqual(expect.arrayContaining(['tachycardia', 'hypoxaemia']));
    expect(f.w24_tachycardia).toBe(true);
    expect(f.w24_hypotension).toBeUndefined(); // SBP never measured
    expect(f.vit_adm_sf).toBe(176);
    expect(f.vit_hours_to_first).toBe(0.3);
    expect(vitalFeatures([], '2026-01-01T10:00', 30)).toEqual({});
  });
});

describe('vitals API', () => {
  it('records, flags, derives and feeds PIM3, Explorer, protocols and export', async () => {
    const { api } = await setupApi();
    const admitAt = hoursAgo(5);
    const { id } = await api.call('admission.create', {
      mrn: 'MR-V', sex: 'M', ageMonths: 24, weightKg: 12, admitAt, source: 'ED', primaryDx: 'SEPSIS', arrivalSupport: 'O2',
      vitals: { hr: 170, rr: 40, spo2: 91, fio2: 40, sbp: 70, dbp: 40, temp: 39.2 },
    }) as { id: string };
    await expect(api.call('vitals.add', { admissionId: id, at: hoursAgo(9), values: { hr: 120 } })).rejects.toThrow('before admission');
    await expect(api.call('vitals.add', { admissionId: id, values: { hr: 999 } })).rejects.toThrow('Heart rate');
    await api.call('vitals.add', { admissionId: id, at: hoursAgo(2), context: 'event', values: { hr: 180, sbp: 65, dbp: 35, gcs: 8 } });

    const v = await api.call('vitals.forAdmission', { admissionId: id }) as any;
    expect(v.sets).toHaveLength(2);
    expect(v.sets[1].context).toBe('admission');
    expect(v.sets[1].values.map).toBe(50);
    expect(v.sets[0].flags).toEqual(expect.arrayContaining(['tachycardia', 'hypotension', 'coma']));
    expect(v.worst24.values.hr).toBe(180);
    expect(v.worst24.values.sbp).toBe(65);

    const detail = await api.call('admission.get', { id }) as any;
    expect(detail.pim3Suggestion.sbp).toBe(70);
    expect(detail.pim3Suggestion.fio2).toBe(0.4);

    const fields = await api.call('explorer.fields') as any;
    const vf = (fields.fields ?? fields).filter((f: any) => f.group.startsWith('Vitals'));
    expect(vf.map((f: any) => f.id)).toEqual(expect.arrayContaining(['vit_adm_hr', 'w24_sbp_min', 'w24_hypotension', 'vit_adm_flags']));
    const res = await api.call('explorer.run', { spec: { include: [{ field: 'w24_sbp_min', op: 'lte', value: 70 }], exclude: [], outcomes: [], describe: ['w24_hr_max'] } }) as any;
    expect(res.result?.n ?? res.n).toBe(1);

    const protocols = await api.call('protocols.list') as any;
    const adm = (protocols.protocols ?? protocols).find((p: any) => p.id === 'admission_vitals');
    expect(adm).toBeTruthy();

    const exp = await api.call('export.deidentified', {}) as any;
    const [head, row] = exp.csv.split('\n');
    const cols = head.split(',');
    expect(row.split(',')[cols.indexOf('vit_adm_sbp')]).toBe('70');
    expect(row.split(',')[cols.indexOf('w24_hypotension')]).toBe('1');
    expect(exp.dictionary).toContain('w24_sf_min');

    await api.call('vitals.delete', { id: v.sets[0].id });
    expect((await api.call('vitals.forAdmission', { admissionId: id }) as any).sets).toHaveLength(1);
  });

  it('demo data carries vitals; most admissions have an admission set', async () => {
    const { db, api } = await setupApi();
    seedDemo(db, { months: 3 });
    const sets = db.prepare('SELECT COUNT(*) n FROM vital_sets').get() as any;
    const adm = db.prepare('SELECT COUNT(*) n FROM admissions').get() as any;
    expect(sets.n).toBeGreaterThan(adm.n * 1.5);
    const issues = await api.call('quality.list') as any;
    expect((issues.issues ?? issues).filter((i: any) => i.rule === 'vitalsOutside')).toHaveLength(0);
  });
});
