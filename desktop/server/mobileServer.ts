// ═══════════════════════════════════════════════════════════
//  HTTPS server for phones on the hospital Wi-Fi. Runs inside the desktop app (the PC stays
//  the only data store) and is off until an administrator turns it on.
//
//  - TLS always (IT-issued PFX preferred, otherwise a generated self-signed certificate).
//  - Every /api request carries the paired device's credential; unpaired devices can only pair.
//  - Each phone tab gets its own session (token held in the phone's memory only).
//  - /events streams "changed" (no data) so open screens refresh when anyone records something.
// ═══════════════════════════════════════════════════════════
import { createServer, type Server, type ServerOptions } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { networkInterfaces } from 'node:os';
import type { DB } from './db';
import { ApiError, type createApi } from './api';
import { redeemPairingCode, touchDevice, verifyDevice } from './mobile';
import { QUIET_METHODS, isRead } from '../shared/apiMethods';

type Api = ReturnType<typeof createApi>;
export interface MobileServerOptions {
  api: Api; db: DB; distDir: string; tls: ServerOptions; port: number; host?: string;
  /** Called after a phone changes data, so the PC window can refresh. */
  onPhoneMutation?: () => void;
  now?: () => number;
}
export interface MobileServer { port: number; close(): Promise<void>; broadcast(): void; clients(): number }

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  // Nothing about patients is cached on the phone.
  'Cache-Control': 'no-store', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

/** Simple sliding-window limiter (in memory; resets when the app restarts). */
function limiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return {
    blocked: (key: string, now: number) => (hits.get(key) ?? []).filter(t => now - t < windowMs).length >= max,
    hit: (key: string, now: number) => { const l = (hits.get(key) ?? []).filter(t => now - t < windowMs); l.push(now); hits.set(key, l); },
    clear: (key: string) => hits.delete(key),
  };
}

export function lanAddresses(): string[] {
  return Object.values(networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i!.address);
}

export function startMobileServer(o: MobileServerOptions): Promise<MobileServer> {
  const now = o.now ?? Date.now;
  const loginFails = limiter(5, 10 * 60_000);
  const pairTries = limiter(10, 10 * 60_000);
  const streams = new Set<ServerResponse>();
  const lastTouch = new Map<string, number>();

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  const readJson = (req: IncomingMessage): Promise<any> => new Promise((resolve, reject) => {
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return reject(new ApiError('Expected JSON'));
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => { size += c.length; if (size > 2_000_000) { reject(new ApiError('Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new ApiError('Invalid JSON')); } });
    req.on('error', reject);
  });
  const deviceOf = (req: IncomingMessage) => {
    const id = String(req.headers['x-device-id'] ?? ''), secret = String(req.headers['x-device-secret'] ?? '');
    return id && secret ? verifyDevice(o.db, id, secret) : null;
  };
  const broadcast = () => { for (const s of streams) s.write('data: changed\n\n'); };

  async function handleApi(req: IncomingMessage, res: ServerResponse, ip: string) {
    const device = deviceOf(req);
    if (!device) return send(res, 401, { ok: false, error: 'DEVICE_NOT_PAIRED' });
    const body = await readJson(req);
    const method = String(body?.method ?? '');
    // Reuse the tab's session if it belongs to this device; otherwise start a fresh one.
    let token = String(req.headers['x-session'] ?? '');
    if (!token || o.api.sessionFor(token)?.deviceId !== device.id) token = o.api.openSession(device);
    const t = now();
    if (lastTouch.get(device.id) == null || t - lastTouch.get(device.id)! > 60_000) { touchDevice(o.db, device.id, null); lastTouch.set(device.id, t); }
    if (method === 'auth.login' && (loginFails.blocked(`ip:${ip}`, t) || loginFails.blocked(`dev:${device.id}`, t)))
      return send(res, 429, { ok: false, error: 'Too many sign-in attempts. Wait 10 minutes.', session: token });
    try {
      const data = await o.api.call(method, body?.params, token);
      if (method === 'auth.login') { loginFails.clear(`ip:${ip}`); loginFails.clear(`dev:${device.id}`); }
      if (!isRead(method) && !QUIET_METHODS.has(method)) { broadcast(); o.onPhoneMutation?.(); }
      send(res, 200, { ok: true, data, session: token });
    } catch (err) {
      if (method === 'auth.login') { loginFails.hit(`ip:${ip}`, t); loginFails.hit(`dev:${device.id}`, t); }
      const known = err instanceof ApiError;
      if (!known) console.error(`[mobile api] ${method}`, err);
      send(res, 200, { ok: false, error: known ? (err as Error).message : 'Something went wrong. The error has been logged.', session: token });
    }
  }

  async function handlePair(req: IncomingMessage, res: ServerResponse, ip: string) {
    const t = now();
    if (pairTries.blocked(ip, t)) return send(res, 429, { ok: false, error: 'Too many attempts. Wait 10 minutes.' });
    pairTries.hit(ip, t);
    const body = await readJson(req);
    try { send(res, 200, { ok: true, data: redeemPairingCode(o.db, body?.code, body?.name, t) }); } catch (e: any) { send(res, 200, { ok: false, error: e.message }); }
  }

  function handleEvents(req: IncomingMessage, res: ServerResponse, url: URL) {
    const s = o.api.sessionFor(url.searchParams.get('s') ?? '');
    if (!s || s.channel !== 'mobile' || !s.user) return send(res, 401, { ok: false, error: 'SESSION_EXPIRED' });
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
    res.write('retry: 5000\n\n');
    streams.add(res);
    const ping = setInterval(() => {
      // Revoked device or signed-out session: close the stream.
      if (!o.api.sessionFor(url.searchParams.get('s') ?? '')?.user) { res.end(); return; }
      res.write(': ping\n\n');
    }, 25_000);
    req.on('close', () => { clearInterval(ping); streams.delete(res); });
  }

  async function handleStatic(req: IncomingMessage, res: ServerResponse, url: URL) {
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = normalize(join(o.distDir, rel));
    if (!file.startsWith(normalize(o.distDir + sep))) return send(res, 404, { ok: false });
    try {
      const data = await readFile(file);
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { send(res, 404, { ok: false, error: 'Not found' }); }
  }

  const server: Server = createServer(o.tls, (req, res) => {
    const url = new URL(req.url ?? '/', 'https://local');
    const ip = req.socket.remoteAddress ?? '?';
    const route = `${req.method} ${url.pathname}`;
    const done = (p: Promise<void> | void) => Promise.resolve(p).catch(e => send(res, 400, { ok: false, error: e instanceof ApiError ? e.message : 'Bad request' }));
    if (route === 'POST /api') return done(handleApi(req, res, ip));
    if (route === 'POST /pair') return done(handlePair(req, res, ip));
    if (route === 'GET /events') return handleEvents(req, res, url);
    if (req.method === 'GET' || req.method === 'HEAD') return done(handleStatic(req, res, url));
    send(res, 405, { ok: false });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.port, o.host ?? '0.0.0.0', () => {
      const addr = server.address();
      resolve({
        port: typeof addr === 'object' && addr ? addr.port : o.port,
        broadcast,
        clients: () => streams.size,
        close: () => new Promise<void>(r => { for (const s of streams) s.end(); streams.clear(); server.close(() => r()); server.closeAllConnections?.(); }),
      });
    });
  });
}
