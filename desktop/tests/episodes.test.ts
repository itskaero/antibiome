import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../server/db';
import { createApi, loadDataset } from '../server/api';
import { toLocal } from '../shared/time';

const hoursAgo = (h: number) => toLocal(new Date(Date.now() - h * 3_600_000));

describe('editing therapy times (episode.update)', () => {
  let db: ReturnType<typeof openDatabase>, api: ReturnType<typeof createApi>, id: string;
  const eps = () => loadDataset(db).episodes.filter(e => e.admissionId === id);
  const abx = () => eps().find(e => e.kind === 'abx' && e.detail === 'Ceftriaxone')!;
  const lastAudit = () => (db.prepare("SELECT summary FROM audit_log WHERE entity = 'episode' ORDER BY id DESC").get() as any)?.summary as string;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    api = createApi(db);
    await api.call('auth.setup', { username: 'admin', displayName: 'Dr Admin', password: 'correct horse', unitName: 'PICU', beds: 10 });
    ({ id } = await api.call('admission.create', { mrn: 'MR-1', name: 'Test Child', sex: 'F', ageMonths: 30, weightKg: 12, admitAt: hoursAgo(48), source: 'ED',
      primaryDx: 'PNEUMONIA', arrivalSupport: 'HFNC', antimicrobials: ['Ceftriaxone'] }) as { id: string });
  });

  it('moves the start earlier, stops a course, changes intent, and audits old → new', async () => {
    const start = hoursAgo(50), stop = hoursAgo(2);
    expect(await api.call('episode.update', { id: abx().id, startAt: start, endAt: stop, intent: 'targeted' })).toBe(true);
    expect(abx()).toMatchObject({ startAt: start, endAt: stop, intent: 'targeted', endReason: 'stopped' });
    expect(lastAudit()).toMatch(/Ceftriaxone — start .* → .*; stop running → .*; intent empiric → targeted/);
    // Re-open (still running) is allowed while admitted.
    await api.call('episode.update', { id: abx().id, endAt: null });
    expect(abx().endAt).toBeNull();
    expect(await api.call('episode.update', { id: abx().id, endAt: null })).toBe(false); // nothing changed
  });

  it('keeps times inside the stay and out of the future', async () => {
    const e = abx().id;
    await expect(api.call('episode.update', { id: e, startAt: hoursAgo(60) })).rejects.toThrow('6 h before admission');
    await expect(api.call('episode.update', { id: e, endAt: hoursAgo(-5) })).rejects.toThrow('future');
    await expect(api.call('episode.update', { id: e, startAt: hoursAgo(10), endAt: hoursAgo(20) })).rejects.toThrow('before start');
    await expect(api.call('episode.update', { id: e, intent: 'magic' })).rejects.toThrow('Unknown intent');
    const resp = eps().find(x => x.kind === 'resp')!;
    await expect(api.call('episode.update', { id: resp.id, intent: 'targeted' })).rejects.toThrow('Only antimicrobials');
  });

  it('refuses overlapping respiratory periods and duplicate courses of one drug', async () => {
    await api.call('resp.set', { admissionId: id, level: 'MV', at: hoursAgo(24) });   // HFNC 48→24 h ago, MV from 24 h ago
    const hfnc = eps().find(x => x.kind === 'resp' && x.detail === 'HFNC')!;
    await expect(api.call('episode.update', { id: hfnc.id, endAt: hoursAgo(20) })).rejects.toThrow('cannot overlap');
    await api.call('episode.update', { id: hfnc.id, endAt: hoursAgo(26) });           // a gap is fine
    await api.call('drug.toggle', { admissionId: id, kind: 'abx', drug: 'Ceftriaxone', on: false, at: hoursAgo(30) });
    await api.call('drug.toggle', { admissionId: id, kind: 'abx', drug: 'Ceftriaxone', on: true, at: hoursAgo(10) });
    const [first] = eps().filter(x => x.detail === 'Ceftriaxone').sort((a, b) => a.startAt.localeCompare(b.startAt));
    await expect(api.call('episode.update', { id: first.id, endAt: hoursAgo(5) })).rejects.toThrow('Overlaps another Ceftriaxone course');
  });

  it('needs a stop time once the patient is discharged', async () => {
    await api.call('admission.discharge', { id, at: hoursAgo(1), disposition: 'Home' });
    await expect(api.call('episode.update', { id: abx().id, endAt: null })).rejects.toThrow('discharged');
    await expect(api.call('episode.update', { id: abx().id, endAt: hoursAgo(-0.5) })).rejects.toThrow(/after discharge|future/);
  });
});
