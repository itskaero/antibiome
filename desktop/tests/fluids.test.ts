import { describe, expect, it } from 'vitest';
import { summarizeFluids, type FluidEntry } from '../shared/fluids';
import { openDatabase } from '../server/db';
import { createApi } from '../server/api';
import { toLocal } from '../shared/time';

const NOW = new Date(2026, 10, 8, 12, 0).getTime();
const at = (h: number) => toLocal(new Date(NOW - h * 3_600_000));
const e = (h: number, dir: 'in' | 'out', category: string, ml: number): FluidEntry => ({ id: `${h}${category}`, admissionId: 'a', at: at(h), dir, category, ml, note: null });

describe('fluid balance', () => {
  it('sums the last 24 h, gives urine output in mL/kg/h and flags oliguria', () => {
    const entries = [e(30, 'in', 'IV fluids', 999), e(20, 'in', 'IV fluids', 600), e(10, 'in', 'Feeds', 300), e(18, 'out', 'Urine', 60), e(6, 'out', 'Urine', 48), e(2, 'out', 'Drain', 40)];
    const s = summarizeFluids(entries, { now: NOW, admitAt: at(48), weightKg: 12 });
    expect(s).toMatchObject({ hours: 24, in: 900, out: 148, balance: 752, urineMl: 108, urineRate: 0.4, oliguria: true });
    expect(s.byCategory[0]).toEqual({ dir: 'in', category: 'IV fluids', ml: 600 });
    expect(s.blocks).toHaveLength(4);
    expect(s.blocks.reduce((n, b) => n + b.in, 0)).toBe(900);
  });
  it('uses the time since admission when the stay is shorter than the window', () => {
    const s = summarizeFluids([e(3, 'out', 'Urine', 72)], { now: NOW, admitAt: at(4), weightKg: 9 });
    expect(s).toMatchObject({ hours: 4, urineRate: 2, oliguria: false });
    expect(summarizeFluids([e(3, 'out', 'Urine', 72)], { now: NOW, admitAt: at(4), weightKg: null }).urineRate).toBeNull();
  });
});

describe('fluids API', () => {
  it('validates, saves, summarises and audits entries', async () => {
    const db = openDatabase(':memory:'); const api = createApi(db);
    await api.call('auth.setup', { username: 'admin', displayName: 'A', password: 'correct horse', unitName: 'PICU', beds: 4 });
    const now = Date.now(), h = (x: number) => toLocal(new Date(now - x * 3_600_000));
    const { id } = await api.call('admission.create', { mrn: 'MR-55', name: 'Fluid Child', sex: 'M', ageMonths: 24, weightKg: 10, admitAt: h(12), source: 'ED', primaryDx: 'PNEUMONIA', arrivalSupport: 'RA' }) as any;
    await expect(api.call('fluids.add', { admissionId: id, dir: 'in', category: 'Urine', ml: 50 })).rejects.toThrow('Unknown fluid type');
    await expect(api.call('fluids.add', { admissionId: id, dir: 'out', category: 'Urine', ml: 0 })).rejects.toThrow('Volume');
    await expect(api.call('fluids.add', { admissionId: id, dir: 'out', category: 'Urine', ml: 20, at: h(20) })).rejects.toThrow('before admission');
    await api.call('fluids.add', { admissionId: id, dir: 'in', category: 'IV fluids', ml: 400, at: h(10) });
    const urine = await api.call('fluids.add', { admissionId: id, dir: 'out', category: 'Urine', ml: 120, at: h(4) });
    await api.call('fluids.add', { admissionId: id, dir: 'out', category: 'Urine', ml: 30, at: h(1) });
    await api.call('fluids.delete', { id: urine });
    const r = await api.call('fluids.forAdmission', { admissionId: id }) as any;
    expect(r.entries).toHaveLength(2);
    expect(r.summary).toMatchObject({ in: 400, out: 30, balance: 370, urineMl: 30 });
    expect(r.summary.urineRate).toBeGreaterThanOrEqual(0.2); expect(r.summary.urineRate).toBeLessThanOrEqual(0.3); // 30 mL / 10 kg / ~12 h
    const log = (db.prepare("SELECT summary FROM audit_log WHERE entity = 'fluids' ORDER BY id").all() as any[]).map(x => x.summary).join('\n');
    expect(log).toMatch(/intake IV fluids 400 mL/);
    expect(log).toMatch(/removed Urine 120 mL/);
  });
});
