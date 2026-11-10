import { describe, expect, it } from 'vitest';
import { pewsLevel, pewsStatus, pewsSuggest, parseThresholds, DEFAULT_PEWS_THRESHOLDS } from '../shared/pews';
import { DEFAULT_DRUG_TABLE, doseFromRate, emergencySheet, estimatedWeight, ettSize, infusionRate, makeUp, validateDrugTable } from '../shared/drugs';
import { doseDue, defaultInterval } from '../shared/doses';

describe('PEWS', () => {
  it('suggests the least sub-scores the numbers support, by age', () => {
    expect(pewsSuggest({ hr: 120, rr: 30 }, 36)).toMatchObject({ cardiovascular: 0, respiratory: 0 });
    // 3-year-old: normal HR 95–140, RR 25–30
    expect(pewsSuggest({ hr: 160 }, 36).cardiovascular).toBe(2);
    expect(pewsSuggest({ hr: 171 }, 36).cardiovascular).toBe(3);
    expect(pewsSuggest({ hr: 80 }, 36).cardiovascular).toBe(3);   // bradycardia for age
    expect(pewsSuggest({ hr: 175 }, 3).cardiovascular).toBe(0);   // infant: 110–160 + 20 = 180
    expect(pewsSuggest({ crt: 3 }, 36).cardiovascular).toBe(1);
    expect(pewsSuggest({ rr: 41 }, 36).respiratory).toBe(1);
    expect(pewsSuggest({ rr: 51 }, 36).respiratory).toBe(2);
    expect(pewsSuggest({ rr: 30, fio2: 45 }, 36).respiratory).toBe(2);
    expect(pewsSuggest({ fio2: 60 }, 36).respiratory).toBe(3);
    expect(pewsSuggest({ rr: 18 }, 36).reasons[0]).toMatch(/recession/);
  });
  it('levels, trend and overdue', () => {
    expect(pewsLevel(2)).toBe('routine'); expect(pewsLevel(3)).toBe('senior'); expect(pewsLevel(4)).toBe('doctor'); expect(pewsLevel(5)).toBe('urgent');
    expect(pewsLevel(3, DEFAULT_PEWS_THRESHOLDS, 3)).toBe('urgent');
    const now = new Date('2026-11-10T12:00').getTime();
    const s = pewsStatus([{ at: '2026-11-10T06:00', values: { pews: 2 } }, { at: '2026-11-10T10:00', values: { pews: 4, hr: 150 } }, { at: '2026-11-10T11:00', values: { hr: 140 } }], now);
    expect(s).toMatchObject({ score: 4, prev: 2, trend: 'up', level: 'doctor', overdue: false, hoursSince: 2 });
    expect(pewsStatus([{ at: '2026-11-10T07:00', values: { pews: 1 } }], now).overdue).toBe(true);
    expect(pewsStatus([], now)).toMatchObject({ score: null, overdue: true });
    expect(parseThresholds('{"senior":2,"doctor":3,"urgent":6,"overdueHours":2}').urgent).toBe(6);
    expect(parseThresholds('{"senior":5,"doctor":3,"urgent":6,"overdueHours":2}')).toEqual(DEFAULT_PEWS_THRESHOLDS);
  });
});

describe('emergency drugs (hand-checked)', () => {
  it('10 kg child', () => {
    const s = emergencySheet(10, 18)!;
    const l = Object.fromEntries(s.lines.map(x => [x.id, x]));
    expect(l.adrenaline).toMatchObject({ dose: 100, unit: 'mcg', volumeMl: 1, capped: false });
    expect(l.atropine).toMatchObject({ dose: 200, volumeMl: 0.33 });
    expect(l.amiodarone).toMatchObject({ dose: 50, unit: 'mg', volumeMl: 1 });
    expect(l.adenosine1).toMatchObject({ dose: 1, volumeMl: 0.33 });
    expect(l.bolus).toMatchObject({ dose: 100, unit: 'mL' });
    expect(l.dextrose.dose).toBe(20); expect(l.calcium.dose).toBe(5); expect(l.bicarbonate.dose).toBe(10);
    expect(l.lorazepam).toMatchObject({ dose: 1, volumeMl: 0.25 });
    expect(s.defibJ).toBe(40); expect(s.cardioversionJ).toEqual([10, 20]);
    expect(s.estimated).toBe(false);
  });
  it('caps at the maximum single dose', () => {
    const l = Object.fromEntries(emergencySheet(70, 180)!.lines.map(x => [x.id, x]));
    expect(l.adrenaline).toMatchObject({ dose: 700, capped: false, volumeMl: 7 });
    expect(Object.fromEntries(emergencySheet(110, 200)!.lines.map(x => [x.id, x])).adrenaline).toMatchObject({ dose: 1000, capped: true, volumeMl: 10 });
    expect(l.atropine).toMatchObject({ dose: 600, capped: true });
    expect(l.amiodarone.dose).toBe(300); expect(l.adenosine2.dose).toBe(12); expect(l.lorazepam.dose).toBe(4);
    expect(l.calcium.dose).toBe(20); expect(l.bolus.dose).toBe(500);
    expect(emergencySheet(70, 180)!.defibJ).toBe(200);
  });
  it('estimates weight only when none is recorded, and sizes tubes', () => {
    expect(estimatedWeight(6)).toBe(7); expect(estimatedWeight(36)).toBe(14); expect(estimatedWeight(96)).toBe(31);
    const s = emergencySheet(null, 36)!;
    expect(s).toMatchObject({ weightKg: 14, estimated: true });
    expect(emergencySheet(null, null)).toBeNull();
    expect(ettSize(48)).toEqual({ cuffed: 4.5, uncuffed: 5, lengthCm: 14 });
    expect(ettSize(96)).toEqual({ cuffed: 5.5, uncuffed: 6, lengthCm: 16 });
    expect(ettSize(0.5).uncuffed).toBe(3.5);
  });
});

describe('infusions', () => {
  it('weight-based syringes give round numbers per mL/h', () => {
    const by = Object.fromEntries(DEFAULT_DRUG_TABLE.infusions.map(i => [i.id, i]));
    expect(makeUp(by.adrenaline, 10)).toMatchObject({ mg: 3, volumeMl: 50, oneMlPerH: 0.1 });
    expect(makeUp(by.dopamine, 10).oneMlPerH).toBe(10);
    expect(makeUp(by.milrinone, 7).oneMlPerH).toBe(0.5);
    expect(makeUp(by.morphine, 12).oneMlPerH).toBe(20);
    expect(makeUp(by.fentanyl, 20).oneMlPerH).toBe(1);
  });
  it('dose ↔ rate round trip', () => {
    // Noradrenaline 0.1 mcg/kg/min, 15 kg, 4 mg in 50 mL (80 mcg/mL) → 1.13 mL/h
    expect(infusionRate(0.1, 'mcg/kg/min', 15, 80)).toBe(1.13);
    expect(doseFromRate(1.125, 'mcg/kg/min', 15, 80)).toBe(0.1);
    expect(infusionRate(20, 'mcg/kg/h', 10, 200)).toBe(1);
    expect(infusionRate(0.1, 'mg/kg/h', 10, 1000)).toBe(1);
  });
  it('validates an edited table', () => {
    expect(validateDrugTable(DEFAULT_DRUG_TABLE)).toBe(DEFAULT_DRUG_TABLE);
    expect(() => validateDrugTable({ ...DEFAULT_DRUG_TABLE, emergency: [{ id: 'x', name: 'X', perKg: 'a', unit: 'mg' }] })).toThrow('dose per kg');
  });
});

describe('dose due', () => {
  const now = new Date('2026-11-10T12:00').getTime();
  it('schedules from doses given, flags overdue after 30 min grace', () => {
    expect(defaultInterval('Meropenem')).toBe(8);
    const ep = { startAt: '2026-11-09T22:00', endAt: null, intervalHours: 8 };
    expect(doseDue(ep, ['2026-11-10T06:00'], now)).toMatchObject({ nextDue: '2026-11-10T14:00', overdueMin: 0, dueInMin: 120, assumed: false });
    expect(doseDue(ep, ['2026-11-10T03:00'], now)).toMatchObject({ nextDue: '2026-11-10T11:00', overdueMin: 60 });
    expect(doseDue(ep, ['2026-11-10T03:45'], now).overdueMin).toBe(0); // 15 min late: within grace
  });
  it('assumes the schedule from the start until doses are recorded; nothing due once stopped', () => {
    expect(doseDue({ startAt: '2026-11-09T22:00', endAt: null, intervalHours: 8 }, [], now)).toMatchObject({ nextDue: '2026-11-10T14:00', overdueMin: 0, assumed: true });
    expect(doseDue({ startAt: '2026-11-10T11:45', endAt: null, intervalHours: 8 }, [], now).nextDue).toBe('2026-11-10T11:45');
    expect(doseDue({ startAt: '2026-11-09T22:00', endAt: '2026-11-10T09:00', intervalHours: 8 }, [], now).nextDue).toBeNull();
    expect(doseDue({ startAt: '2026-11-09T22:00', endAt: null, intervalHours: null }, [], now).nextDue).toBeNull();
  });
});

// ── API ──────────────────────────────────────────────────────
import { openDatabase } from '../server/db';
import { createApi } from '../server/api';
import { createPairingCode, redeemPairingCode } from '../server/mobile';
import { toLocal } from '../shared/time';

const ago = (h: number) => toLocal(new Date(Date.now() - h * 3_600_000));
async function unit() {
  const db = openDatabase(':memory:');
  const api = createApi(db, Date.now, { monitorSummary: bed => bed === '4' ? { desats: 2, lowestSpo2: 84, disconnects: 1, outside: 0 } : null });
  await api.call('auth.setup', { username: 'admin', displayName: 'Dr Admin', password: 'correct horse', unitName: 'PICU', beds: 10 });
  await api.call('users.create', { username: 'bina', displayName: 'Nurse Bina', role: 'nurse', password: 'password1' });
  const { id } = await api.call('admission.create', { mrn: 'MR-90', name: 'Secret Name', bed: '4', sex: 'M', ageMonths: 30, weightKg: 13, admitAt: ago(30), source: 'ED', primaryDx: 'PNEUMONIA', arrivalSupport: 'O2' }) as { id: string };
  const { code } = createPairingCode(db, 1, Date.now());
  const d = redeemPairingCode(db, code, 'Phone', Date.now());
  const tok = api.openSession({ id: d.deviceId, name: d.name });
  await api.call('auth.login', { username: 'bina', password: 'password1' }, tok);
  return { db, api, id, tok };
}

describe('doses, PEWS and handover through the API', () => {
  it('starts with the usual interval, records doses given by a nurse, and shows what is due', async () => {
    const { api, id, tok } = await unit();
    await api.call('drug.toggle', { admissionId: id, kind: 'abx', drug: 'Meropenem', on: true, at: ago(10), dose: '40 mg/kg' });
    let row = ((await api.call('census.list')) as any).rows[0];
    expect(row.abx[0]).toMatchObject({ drug: 'Meropenem', intervalHours: 8, dose: '40 mg/kg' });
    expect(row.abx[0].due.assumed).toBe(true);
    await api.call('dose.given', { episodeId: row.abx[0].id, at: ago(9) }, tok);
    await expect(api.call('dose.given', { episodeId: row.abx[0].id, at: ago(8.8) }, tok)).rejects.toThrow('already recorded');
    row = ((await api.call('census.list')) as any).rows[0];
    expect(row.abx[0].due.overdueMin).toBeGreaterThan(55); // 9 h ago + 8 h interval = 1 h overdue
    await expect(api.call('episode.update', { id: row.abx[0].id, intervalHours: 6 }, tok)).rejects.toThrow('role does not allow');
    await api.call('episode.update', { id: row.abx[0].id, intervalHours: 12 });
    row = ((await api.call('census.list')) as any).rows[0];
    expect(row.abx[0].due.overdueMin).toBe(0);
    await expect(api.call('episode.update', { id: row.abx[0].id, intervalHours: 100 })).rejects.toThrow('1–72');
  });

  it('PEWS status on the census, and an SBAR handover with no name in it', async () => {
    const { api, id, tok } = await unit();
    await api.call('vitals.add', { admissionId: id, at: ago(6), values: { pews: 1, hr: 120 } }, tok);
    await api.call('vitals.add', { admissionId: id, at: ago(5), values: { pews: 4, hr: 165, rr: 45 } }, tok);
    await api.call('fluids.add', { admissionId: id, dir: 'in', category: 'IV fluids', ml: 60 }, tok);
    await api.call('event.add', { admissionId: id, type: 'note', label: 'Handover', note: 'Chase CXR; recheck glucose at 02:00' }, tok);
    const row = ((await api.call('census.list', {}, tok)) as any).rows[0];
    expect(row.pews).toMatchObject({ score: 4, prev: 1, trend: 'up', level: 'doctor', overdue: true });
    const [h] = await api.call('handover.list', { admissionId: id }, tok) as any[];
    expect(h.text).toContain('Bed 4');
    expect(h.text).toContain('PEWS 4 ↑');
    expect(h.text).toContain('Monitor 12 h: 2 desaturations (lowest 84%)');
    expect(h.text).toContain('This shift: in 60');
    expect(h.text).toContain('To do: Chase CXR');
    expect(h.text).toContain('PEWS due');
    expect(h.text).not.toContain('Secret Name');
    expect(h.name).toBeNull(); // phone, names off
  });

  it('drug table: defaults, validated edits, review by an administrator', async () => {
    const { api, tok } = await unit();
    expect(((await api.call('drugs.table', {}, tok)) as any)).toMatchObject({ custom: false, reviewed: null });
    await expect(api.call('drugs.saveTable', { table: '{"emergency":[]}' })).rejects.toThrow('infusions');
    await api.call('drugs.markReviewed');
    expect(((await api.call('drugs.table')) as any).reviewed.by).toBe('Dr Admin');
    await expect(api.call('pews.saveThresholds', { senior: 4, doctor: 3, urgent: 5, overdueHours: 4 })).rejects.toThrow('rise');
    await api.call('pews.saveThresholds', { senior: 3, doctor: 5, urgent: 7, overdueHours: 2 });
    expect(await api.call('pews.thresholds')).toEqual({ senior: 3, doctor: 5, urgent: 7, overdueHours: 2 });
  });
});
