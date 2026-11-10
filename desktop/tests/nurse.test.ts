import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { request } from 'node:https';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MIGRATIONS, migrate, openDatabase } from '../server/db';
import { openSqlite } from '../server/sqlite';
import { createApi } from '../server/api';
import { createPairingCode, redeemPairingCode } from '../server/mobile';
import { PHONE_WAVE_STEP, startMobileServer, type MobileMonitorSource } from '../server/mobileServer';
import { generateCertificate } from '../server/tls';
import { toLocal } from '../shared/time';
import type { BedSnapshot, MonitorUpdate } from '../server/monitorGateway';

const hoursAgo = (h: number) => toLocal(new Date(Date.now() - h * 3_600_000));
const setup = async () => {
  const db = openDatabase(':memory:');
  const api = createApi(db);
  await api.call('auth.setup', { username: 'admin', displayName: 'Dr Admin', password: 'correct horse', unitName: 'PICU', beds: 10 });
  await api.call('users.create', { username: 'bina', displayName: 'Nurse Bina', role: 'nurse', password: 'password1' });
  await api.call('users.create', { username: 'sana', displayName: 'Nurse Sana', role: 'nurse', password: 'password1' });
  const { id } = await api.call('admission.create', { mrn: 'MR-77', name: 'Test Child', sex: 'F', ageMonths: 20, admitAt: hoursAgo(3), source: 'ED', primaryDx: 'PNEUMONIA', arrivalSupport: 'O2', weightKg: 10 }) as { id: string };
  await api.call('drug.toggle', { admissionId: id, kind: 'abx', drug: 'Ceftriaxone', on: true, intent: 'empiric' });
  const phone = (name: string) => { const { code } = createPairingCode(db, 1, Date.now()); const d = redeemPairingCode(db, code, name, Date.now()); return { dev: d, tok: api.openSession({ id: d.deviceId, name: d.name }) }; };
  return { db, api, admissionId: id, phone };
};

describe('nurse accounts', () => {
  it('chart vitals, intake/output and notes, but cannot prescribe, admit or discharge', async () => {
    const { api, admissionId, phone } = await setup();
    const { tok } = phone('Ward phone');
    await api.call('auth.login', { username: 'bina', password: 'password1' }, tok);
    expect(api.sessionFor(tok)?.user?.role).toBe('nurse');

    const fid = await api.call('fluids.add', { admissionId, dir: 'in', category: 'IV fluids', ml: 40 }, tok) as string;
    await api.call('fluids.add', { admissionId, dir: 'out', category: 'Urine', ml: 25 }, tok);
    await api.call('vitals.add', { admissionId, values: { hr: 132, spo2: 95 } }, tok);
    await api.call('event.add', { admissionId, type: 'note', label: 'Feeds held', note: 'Feeds held, informed doctor' }, tok);
    const fl = await api.call('fluids.forAdmission', { admissionId }, tok) as any;
    expect(fl.summary.in).toBe(40);

    await expect(api.call('event.add', { admissionId, type: 'procedure', label: 'CVC insertion' }, tok)).rejects.toThrow('Nurses can add notes');
    await expect(api.call('drug.toggle', { admissionId, kind: 'abx', drug: 'Ceftriaxone', on: false }, tok)).rejects.toThrow('role does not allow');
    await expect(api.call('resp.set', { admissionId, level: 'MV' }, tok)).rejects.toThrow('role does not allow');
    await expect(api.call('admission.discharge', { id: admissionId, disposition: 'ward' }, tok)).rejects.toThrow('role does not allow');
    await expect(api.call('admission.create', { mrn: 'MR-78', sex: 'M', ageMonths: 5, admitAt: hoursAgo(1), source: 'ED', primaryDx: 'SEPSIS', arrivalSupport: 'RA' }, tok)).rejects.toThrow('role does not allow');

    // Only the nurse who recorded an entry (or a clinician) removes it.
    const other = phone('Second phone');
    await api.call('auth.login', { username: 'sana', password: 'password1' }, other.tok);
    await expect(api.call('fluids.delete', { id: fid }, other.tok)).rejects.toThrow('Only the person who recorded this');
    await api.call('fluids.delete', { id: fid }, tok);
    expect(((await api.call('fluids.forAdmission', { admissionId }, tok)) as any).summary.in).toBe(0);
  });

  it('can be invited from a QR code', async () => {
    const { api } = await setup();
    const inv = await api.call('invites.create', { role: 'nurse', days: 7, maxUses: 3 }) as any;
    expect(inv.code).toBeTruthy();
  });
});

describe('migration v9 (nurse role)', () => {
  it('rebuilds users and invites without losing rows or references', () => {
    const db = openSqlite(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    for (let v = 0; v < 8; v++) { db.exec(MIGRATIONS[v]); db.exec(`PRAGMA user_version = ${v + 1}`); }
    db.exec(`INSERT INTO users(username, display_name, role, pw_hash, pw_salt, created_at) VALUES ('a','A','admin','h','s','2026-01-01T00:00'), ('c','C','clinician','h','s','2026-01-01T00:00');
             INSERT INTO invites(id, code_hash, role, created_by, created_at, expires_at, max_uses) VALUES ('i1','x','viewer',1,'2026-01-01T00:00',1,1);`);
    expect(() => db.exec(`INSERT INTO users(username, display_name, role, pw_hash, pw_salt, created_at) VALUES ('n','N','nurse','h','s','x')`)).toThrow();
    migrate(db);
    expect((db.prepare('PRAGMA user_version').get() as any).user_version).toBe(MIGRATIONS.length);
    expect((db.prepare('SELECT username FROM users ORDER BY id').all() as any[]).map(r => r.username)).toEqual(['a', 'c']);
    db.exec(`INSERT INTO users(username, display_name, role, pw_hash, pw_salt, created_at) VALUES ('n','N','nurse','h','s','x')`);
    expect((db.prepare('SELECT created_by FROM invites').get() as any).created_by).toBe(1);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    // References from other tables still point at users and are still enforced.
    expect((db.prepare("SELECT sql FROM sqlite_master WHERE name = 'fluid_entries'").get() as any).sql).toContain('REFERENCES users(id)');
    expect((db.prepare('PRAGMA foreign_keys').get() as any).foreign_keys).toBe(1);
    expect(() => db.exec(`INSERT INTO invites(id, code_hash, role, created_by, created_at, expires_at, max_uses) VALUES ('i2','y','nurse',99,'x',1,1)`)).toThrow();
  });
});

// ── Live monitor on phones ───────────────────────────────────

const bed = (id: string, name: string): BedSnapshot => ({
  id, receiverId: 'r1', receiverName: 'Ward', bed: Number(id.split(':')[1]), source: 'network', remote: '192.168.10.4', connected: true, connectedAt: Date.now(), lastFrameAt: Date.now(), stale: false,
  patient: { name, patientId: 'P1', admitDate: null, birthDate: '2024-05-01' }, values: { spo2: { value: 97, confidence: 'verified' } as any }, probeOff: false, leadsOff: false, framesRejected: 0, recentEvents: 0,
});

describe('phone live monitor', () => {
  it('streams numbers for all beds, waves only for the bed on screen, and hides monitor names', async () => {
    const { db, api } = await setup();
    const feed = new EventEmitter();
    let showNames = false;
    const monitor: MobileMonitorSource = {
      snapshot: () => [], trend: () => ({ spo2: [{ t: 1, min: 95, max: 98, mean: 97 }] }), events: () => [],
      status: () => ({ running: true, demo: false, enabled: true, bedMap: {} }),
      subscribe: fn => { feed.on('u', fn); return () => { feed.off('u', fn); }; },
      showNames: () => showNames,
    };
    const dist = mkdtempSync(join(tmpdir(), 'abm-dist-')); writeFileSync(join(dist, 'index.html'), '<html></html>');
    const srv = await startMobileServer({ api, db, distDir: dist, tls: await generateCertificate(['127.0.0.1']), port: 0, host: '127.0.0.1', monitor });
    const req = (path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) => new Promise<{ status: number; body: string }>((resolve, reject) => {
      const r = request({ host: '127.0.0.1', port: srv.port, path, method: opts.method ?? 'GET', rejectUnauthorized: false, headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...opts.headers } }, res => {
        let b = ''; res.on('data', c => { b += c; }); res.on('end', () => resolve({ status: res.statusCode!, body: b }));
      });
      r.on('error', reject); if (opts.body) r.write(JSON.stringify(opts.body)); r.end();
    });
    try {
      expect(JSON.parse((await req('/healthz')).body)).toEqual({ ok: true, app: 'antibiome' });
      const { code } = createPairingCode(db, 1, Date.now());
      const paired = JSON.parse((await req('/pair', { method: 'POST', body: { code, name: 'Nurse phone' } })).body).data;
      const dev = { 'X-Device-Id': paired.deviceId, 'X-Device-Secret': paired.secret };
      const callApi = async (method: string, params?: unknown, session?: string) => JSON.parse((await req('/api', { method: 'POST', body: { method, params }, headers: { ...dev, ...(session ? { 'X-Session': session } : {}) } })).body);
      const st = await callApi('auth.status');
      expect((await callApi('desktop.monitorTrend', { id: 'r1:3' }, st.session)).error).toBe('SESSION_EXPIRED');
      const login = await callApi('auth.login', { username: 'bina', password: 'password1' }, st.session);
      expect((await callApi('desktop.monitorTrend', { id: 'r1:3' }, login.session)).data.spo2[0].mean).toBe(97);
      expect((await callApi('desktop.monitorStatus', {}, login.session)).data).toMatchObject({ running: true, receivers: [] });
      expect((await callApi('desktop.monitorConfigure', { enabled: false }, login.session)).ok).toBe(false);

      expect((await req('/monitor?t=nope')).status).toBe(401);
      const ticket = JSON.parse((await req('/events-ticket', { method: 'POST', headers: { ...dev, 'X-Session': login.session } })).body).data;
      const frames: any[] = [];
      const done = new Promise<void>((resolve, reject) => {
        const r = request({ host: '127.0.0.1', port: srv.port, path: `/monitor?t=${ticket}&bed=r1:3`, rejectUnauthorized: false }, res => {
          expect(res.headers['content-type']).toBe('text/event-stream');
          let buf = '';
          res.on('data', (c: Buffer) => {
            buf += c.toString();
            for (const m of buf.split('\n\n').slice(0, -1)) if (m.startsWith('data: ')) frames.push(JSON.parse(m.slice(6)));
            buf = buf.split('\n\n').pop()!;
            if (frames.length >= 2) { r.destroy(); resolve(); }
          });
        });
        r.on('error', e => { if (!String(e).includes('socket hang up')) reject(e); });
        r.end();
      });
      await new Promise(r => setTimeout(r, 100));
      const wave = Array.from({ length: 64 }, (_, i) => i);
      const u: MonitorUpdate = { at: 1, beds: [bed('r1:3', 'Real Name'), bed('r1:4', 'Other Name')], waves: { 'r1:3': { ecg: wave, pleth: wave, resp: wave.slice(0, 32) }, 'r1:4': { ecg: wave } }, rates: { ecg: 256, pleth: 256, resp: 128 } };
      feed.emit('u', u);
      feed.emit('u', { ...u, at: 2 }); // within 1 s: waves only, no numbers
      await done;
      expect(frames[0].beds).toHaveLength(2);
      expect(frames[0].beds.map((b: any) => b.patient.name)).toEqual([null, null]);
      expect(frames[0].beds[0].patient.birthDate).toBe('2024-05-01');
      expect(Object.keys(frames[0].waves)).toEqual(['r1:3']);
      expect(frames[0].waves['r1:3'].ecg).toHaveLength(64 / PHONE_WAVE_STEP.ecg);
      expect(frames[0].waves['r1:3'].pleth).toEqual([0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60]);
      expect(frames[0].rates).toEqual({ ecg: 128, pleth: 64, resp: 32 });
      expect(frames[1].beds).toBeUndefined();
      expect(frames[1].waves['r1:3'].ecg).toHaveLength(32);
      expect(feed.listenerCount('u')).toBeLessThanOrEqual(1);
      showNames = true; // names follow the unit setting (for clinical roles)
    } finally { await srv.close(); }
  });
});
