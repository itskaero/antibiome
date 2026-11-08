import { describe, expect, it } from 'vitest';
import { openDatabase } from '../server/db';
import { createApi } from '../server/api';
import { MonitorGateway } from '../server/monitorGateway';
import { proposeFromMonitors } from '../server/monitorService';
import { driverById } from '../shared/monitor/drivers';
import { secondOfData } from '../shared/monitor/simulator';
import { toLocal } from '../shared/time';

describe('monitor → chart proposals', () => {
  it('proposes verified, sane values once per interval and confirms them into the chart', async () => {
    const db = openDatabase(':memory:'); const api = createApi(db);
    await api.call('auth.setup', { username: 'admin', displayName: 'A', password: 'correct horse', unitName: 'PICU', beds: 4 });
    const { id } = await api.call('admission.create', { mrn: 'MR-21', name: 'Monitored Child', sex: 'F', bed: '2', ageMonths: 40, weightKg: 14, admitAt: toLocal(new Date(Date.now() - 5 * 3_600_000)), source: 'ED', primaryDx: 'PNEUMONIA', arrivalSupport: 'O2' }) as any;
    const gw = new MonitorGateway();
    const feed = (bed: number, temp: number | null) => { const r = driverById('ddt')!.createReader(); for (const f of secondOfData({ bed, name: 'T', hr: 118, spo2: 94, temp }, 0)) gw.ingestEvents({ id: 'r1', name: 'Ward' }, bed, r.push(f).events, 'network', '10.0.0.2'); };
    feed(2, 37.6);
    feed(3, 30.3); // bed 3: nobody admitted there, and its temperature probe is off the patient

    expect(proposeFromMonitors(db, gw, Date.now(), 60)).toBe(1);
    expect(proposeFromMonitors(db, gw, Date.now() + 5 * 60_000, 60)).toBe(0);   // not again within the hour
    const pending = await api.call('vitals.pending', { admissionId: id }) as any[];
    expect(pending).toHaveLength(1);
    // HR from ECG is unverified, so the pulse rate is charted as heart rate.
    expect(pending[0]).toMatchObject({ source: 'Ward bed 2', values: { spo2: 94, hr: 118, temp: 37.6 } });

    expect(await api.call('vitals.resolvePending', { ids: [pending[0].id], decision: 'confirmed' })).toBe(1);
    expect(await api.call('vitals.pending', { admissionId: id })).toEqual([]);
    const v = await api.call('vitals.forAdmission', { admissionId: id }) as any;
    expect(v.sets[0].values).toMatchObject({ spo2: 94, hr: 118, temp: 37.6 });
    expect((db.prepare("SELECT summary FROM audit_log WHERE action = 'confirm'").get() as any).summary).toMatch(/confirmed monitor reading from Ward bed 2/);
    await gw.dispose();
  });

  it('never proposes a room-temperature probe', async () => {
    const db = openDatabase(':memory:'); const api = createApi(db);
    await api.call('auth.setup', { username: 'admin', displayName: 'A', password: 'correct horse', unitName: 'PICU', beds: 4 });
    await api.call('admission.create', { mrn: 'MR-31', name: 'Probe Child', sex: 'M', bed: '3', ageMonths: 30, weightKg: 12, admitAt: toLocal(new Date(Date.now() - 3_600_000)), source: 'ED', primaryDx: 'PNEUMONIA', arrivalSupport: 'RA' });
    const gw = new MonitorGateway();
    const r = driverById('ddt')!.createReader();
    for (const f of secondOfData({ bed: 3, name: 'T', hr: 100, spo2: 99, temp: 30.3 }, 0)) gw.ingestEvents({ id: 'r1', name: 'W' }, 3, r.push(f).events, 'network', null);
    proposeFromMonitors(db, gw, Date.now(), 60);
    const row = db.prepare('SELECT values_json FROM pending_vitals').get() as any;
    expect(JSON.parse(row.values_json)).toEqual({ spo2: 99, hr: 100 });
    return gw.dispose();
  });
});
