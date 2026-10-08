import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { request } from 'node:https';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../server/db';
import { createApi, MOBILE_IDLE_MS } from '../server/api';
import { createPairingCode, redeemPairingCode, verifyDevice } from '../server/mobile';
import { startMobileServer, type MobileServer } from '../server/mobileServer';
import { generateCertificate, serverFingerprint } from '../server/tls';
import { toLocal } from '../shared/time';

const hoursAgo = (h: number) => toLocal(new Date(Date.now() - h * 3_600_000));
const setup = async () => {
  const db = openDatabase(':memory:');
  const api = createApi(db);
  await api.call('auth.setup', { username: 'admin', displayName: 'Dr Admin', password: 'correct horse', unitName: 'PICU', beds: 10 });
  await api.call('users.create', { username: 'nurse', displayName: 'Nurse Bina', role: 'clinician', password: 'password1' });
  await api.call('users.create', { username: 'res', displayName: 'Researcher', role: 'researcher', password: 'password1' });
  const { id } = await api.call('admission.create', { mrn: 'MR-77', name: 'Zara Test', sex: 'F', ageMonths: 20, admitAt: hoursAgo(3), source: 'ED', primaryDx: 'PNEUMONIA', arrivalSupport: 'O2' }) as { id: string };
  return { db, api, admissionId: id };
};

describe('pairing', () => {
  it('codes are single use and expire', async () => {
    const { db } = await setup();
    const { code } = createPairingCode(db, 1, Date.now());
    const d = redeemPairingCode(db, code.toLowerCase(), "Dr Khan's phone", Date.now());
    expect(verifyDevice(db, d.deviceId, d.secret)?.name).toBe("Dr Khan's phone");
    expect(verifyDevice(db, d.deviceId, 'wrong')).toBeNull();
    expect(() => redeemPairingCode(db, code, 'Again', Date.now())).toThrow('invalid or has expired');
    const old = createPairingCode(db, 1, Date.now() - 11 * 60_000);
    expect(() => redeemPairingCode(db, old.code, 'Late', Date.now())).toThrow('expired');
  });
});

describe('per-device sessions', () => {
  it('PC and phone sign in independently; phones are restricted', async () => {
    const { db, api, admissionId } = await setup();
    const { code } = createPairingCode(db, 1, Date.now());
    const dev = redeemPairingCode(db, code, 'Ward phone', Date.now());
    const tok = api.openSession({ id: dev.deviceId, name: dev.name });
    await expect(api.call('census.list', {}, tok)).rejects.toThrow('SESSION_EXPIRED');
    await expect(api.call('auth.login', { username: 'res', password: 'password1' }, tok)).rejects.toThrow('PC only');
    await api.call('auth.login', { username: 'nurse', password: 'password1' }, tok);
    expect(api.session.user?.username).toBe('admin'); // PC unaffected
    expect(api.sessionFor(tok)?.user?.username).toBe('nurse');

    // Allow-list
    await expect(api.call('explorer.run', { spec: {} }, tok)).rejects.toThrow('PICU PC only');
    await expect(api.call('export.deidentified', {}, tok)).rejects.toThrow('PICU PC only');
    await expect(api.call('users.list', {}, tok)).rejects.toThrow('PICU PC only');

    // Names hidden on phones by default; shown on the PC
    const phoneCensus = await api.call('census.list', {}, tok) as any;
    expect(phoneCensus.showIdentifiers).toBe(false);
    expect(phoneCensus.rows[0].name).toBeNull();
    expect((await api.call('admission.get', { id: admissionId }, tok) as any).identifiers).toBeNull();
    expect((await api.call('census.list') as any).rows[0].name).toBe('Zara Test');
    await api.call('mobile.showNames', { on: true });
    expect((await api.call('census.list', {}, tok) as any).rows[0].name).toBe('Zara Test');

    // Device name in the audit trail
    await api.call('vitals.add', { admissionId, values: { hr: 130 } }, tok);
    const log = db.prepare("SELECT summary, username FROM audit_log WHERE entity = 'vitals' ORDER BY id DESC").get() as any;
    expect(log.username).toBe('Nurse Bina');
    expect(log.summary).toContain('via Ward phone');

    // Phone idle lock is shorter
    api.sessionFor(tok)!.lastActivity = Date.now() - MOBILE_IDLE_MS - 1000;
    await expect(api.call('census.list', {}, tok)).rejects.toThrow('SESSION_EXPIRED');
    expect(api.session.user).not.toBeNull();

    // Revoke ends the device's sessions
    await api.call('auth.login', { username: 'nurse', password: 'password1' }, tok);
    await api.call('mobile.revoke', { id: dev.deviceId });
    expect(api.sessionFor(tok)).toBeNull();
    expect(verifyDevice(db, dev.deviceId, dev.secret)).toBeNull();
  });
});

describe('HTTPS phone server', () => {
  let srv: MobileServer; let ctx: Awaited<ReturnType<typeof setup>>; let changed = 0;
  beforeAll(async () => {
    ctx = await setup();
    const dist = mkdtempSync(join(tmpdir(), 'ab-dist-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Antibiome</title>');
    const tls = await generateCertificate(['127.0.0.1']);
    srv = await startMobileServer({ api: ctx.api, db: ctx.db, distDir: dist, tls, port: 0, host: '127.0.0.1', onPhoneMutation: () => { changed++; } });
  }, 30_000);
  afterAll(async () => { await srv?.close(); });

  const req = (path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) => new Promise<{ status: number; body: string; headers: any }>((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port: srv.port, path, method: opts.method ?? 'GET', rejectUnauthorized: false, headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...opts.headers } }, res => {
      let b = ''; res.on('data', c => { b += c; }); res.on('end', () => resolve({ status: res.statusCode!, body: b, headers: res.headers }));
    });
    r.on('error', reject);
    if (opts.body) r.write(JSON.stringify(opts.body));
    r.end();
  });

  it('serves the UI over TLS with no-store and a fingerprint', async () => {
    const r = await req('/');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['content-security-policy']).toContain("default-src 'self'");
    expect((await req('/../../etc/passwd')).status).toBe(404);
    expect(await serverFingerprint(srv.port)).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });

  it('refuses unpaired devices, then pair → login → census → live events', async () => {
    const unpaired = await req('/api', { method: 'POST', body: { method: 'auth.status' } });
    expect(unpaired.status).toBe(401);

    const { code } = await ctx.api.call('mobile.pairingCode') as { code: string };
    const paired = JSON.parse((await req('/pair', { method: 'POST', body: { code, name: 'Bed-side phone' } })).body);
    expect(paired.ok).toBe(true);
    const dev = { 'X-Device-Id': paired.data.deviceId, 'X-Device-Secret': paired.data.secret };
    const callApi = async (method: string, params?: unknown, session?: string) =>
      JSON.parse((await req('/api', { method: 'POST', body: { method, params }, headers: { ...dev, ...(session ? { 'X-Session': session } : {}) } })).body);

    const status = await callApi('auth.status');
    expect(status.data.channel).toBe('mobile');
    const bad = await callApi('auth.login', { username: 'nurse', password: 'nope' }, status.session);
    expect(bad.ok).toBe(false);
    const login = await callApi('auth.login', { username: 'nurse', password: 'password1' }, status.session);
    expect(login.ok).toBe(true);
    const census = await callApi('census.list', {}, login.session);
    expect(census.data.rows).toHaveLength(1);
    expect((await callApi('ai.status', {}, login.session)).error).toContain('PC only');

    // Live updates: an SSE client receives "changed" after a phone mutation.
    const got = new Promise<string>((resolve, reject) => {
      const r = request({ host: '127.0.0.1', port: srv.port, path: `/events?s=${login.session}`, rejectUnauthorized: false }, res => {
        res.on('data', (c: Buffer) => { if (c.toString().includes('changed')) { resolve(c.toString()); r.destroy(); } });
      });
      r.on('error', e => { if (!String(e).includes('socket hang up')) reject(e); });
      r.end();
    });
    await new Promise(r => setTimeout(r, 100));
    expect(srv.clients()).toBe(1);
    const before = changed;
    await callApi('resp.set', { admissionId: ctx.admissionId, level: 'HFNC' }, login.session);
    expect(await got).toContain('data: changed');
    expect(changed).toBe(before + 1);
    expect((await req('/events?s=bogus')).status).toBe(401);
  });

  it('rate-limits repeated failed sign-ins', async () => {
    const { code } = await ctx.api.call('mobile.pairingCode') as { code: string };
    const p = JSON.parse((await req('/pair', { method: 'POST', body: { code, name: 'Another phone' } })).body).data;
    const h = { 'X-Device-Id': p.deviceId, 'X-Device-Secret': p.secret };
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await req('/api', { method: 'POST', body: { method: 'auth.login', params: { username: 'nurse', password: 'x' } }, headers: h })).status;
    expect(last).toBe(429);
  });
});
