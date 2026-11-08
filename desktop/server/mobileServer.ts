// ═══════════════════════════════════════════════════════════
//  HTTPS server for phones on the hospital Wi-Fi. Runs inside the desktop app (the PC stays
//  the only data store) and is off until an administrator turns it on.
//
//  - TLS always (IT-issued PFX preferred, otherwise a generated self-signed certificate).
//  - Every /api request carries the paired device's credential; unpaired devices can only pair.
//  - Each phone tab gets its own session (token held in the phone's memory only).
//  - /events streams "changed" (no data) so open screens refresh when anyone records something.
//  - /join redeems a staff invite: pairs the phone and files an account request for an admin.
//
//  Remote access (Cloudflare Tunnel): cloudflared connects to an optional plain-HTTP listener bound to
//  127.0.0.1 only. For connections from the loopback the real visitor address comes from
//  CF-Connecting-IP / X-Forwarded-For (so rate limits apply per person); no other connection may set
//  it. With a public hostname configured, requests for any other Host are refused.
// ═══════════════════════════════════════════════════════════
import { createServer, type Server, type ServerOptions } from 'node:https';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { networkInterfaces } from 'node:os';
import type { DB } from './db';
import { ApiError, type createApi } from './api';
import { joinWithInvite, redeemPairingCode, touchDevice, verifyDevice } from './mobile';
import { QUIET_METHODS, isRead } from '../shared/apiMethods';

type Api = ReturnType<typeof createApi>;
export interface MobileServerOptions {
  api: Api; db: DB; distDir: string; tls: ServerOptions; port: number; host?: string;
  /** Called after a phone changes data, so the PC window can refresh. */
  onPhoneMutation?: () => void;
  now?: () => number;
  /** Host names this server answers to; null/undefined = any (LAN-only use). */
  allowedHosts?: () => string[] | null;
  /** Plain-HTTP listener on 127.0.0.1 for a tunnel connector (cloudflared). 0/undefined = off. */
  loopbackPort?: number;
  /** Addresses of a tunnel connector running on another machine (e.g. when this PC is Windows 7); their forwarded headers are trusted too. */
  trustedProxies?: () => string[];
}
export interface MobileServer { port: number; loopbackPort: number | null; close(): Promise<void>; broadcast(): void; clients(): number; lastTunnelAt(): number | null }

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
/** The visitor's address: from the tunnel's header only when the connection itself is local. */
export function clientIp(req: IncomingMessage, trusted: string[] = []): { ip: string; viaTunnel: boolean } {
  const sock = req.socket.remoteAddress ?? '?';
  if (LOOPBACK.has(sock) || trusted.includes(sock.replace(/^::ffff:/, ''))) {
    const fwd = String(req.headers['cf-connecting-ip'] ?? '').trim() || String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (fwd && /^[\d.:a-fA-F]{2,45}$/.test(fwd)) return { ip: fwd, viaTunnel: true };
  }
  return { ip: sock, viaTunnel: false };
}
export const hostOf = (req: IncomingMessage) => String(req.headers.host ?? '').toLowerCase().replace(/^\[([^\]]+)\](:\d+)?$/, '$1').replace(/:\d+$/, '');

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
  const joinTries = limiter(5, 10 * 60_000);
  /** One-time tickets for the event stream, so session tokens never appear in a URL (or a tunnel's logs). */
  const tickets = new Map<string, { token: string; exp: number }>();
  let lastTunnel: number | null = null;
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

  async function handleJoin(req: IncomingMessage, res: ServerResponse, ip: string) {
    const t = now();
    if (joinTries.blocked(ip, t)) return send(res, 429, { ok: false, error: 'Too many attempts. Wait 10 minutes.' });
    joinTries.hit(ip, t);
    const body = await readJson(req);
    try { const r = joinWithInvite(o.db, body ?? {}, t); o.onPhoneMutation?.(); send(res, 200, { ok: true, data: r }); }
    catch (e: any) { send(res, 200, { ok: false, error: e.message }); }
  }

  function handleTicket(req: IncomingMessage, res: ServerResponse) {
    const device = deviceOf(req);
    const token = String(req.headers['x-session'] ?? '');
    const s = device ? o.api.sessionFor(token) : null;
    if (!device || !s || s.deviceId !== device.id || !s.user) return send(res, 401, { ok: false, error: 'SESSION_EXPIRED' });
    const t = now();
    for (const [k, v] of tickets) if (v.exp < t) tickets.delete(k);
    const ticket = randomBytes(24).toString('base64url');
    tickets.set(ticket, { token, exp: t + 60_000 });
    send(res, 200, { ok: true, data: ticket });
  }

  function handleEvents(req: IncomingMessage, res: ServerResponse, url: URL) {
    const tk = tickets.get(url.searchParams.get('t') ?? '');
    if (tk) tickets.delete(url.searchParams.get('t')!);
    const token = tk && tk.exp >= now() ? tk.token : '';
    const s = o.api.sessionFor(token);
    if (!s || s.channel !== 'mobile' || !s.user) return send(res, 401, { ok: false, error: 'SESSION_EXPIRED' });
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
    res.write('retry: 5000\n\n');
    streams.add(res);
    const ping = setInterval(() => {
      // Revoked device or signed-out session: close the stream.
      if (!o.api.sessionFor(token)?.user) { res.end(); return; }
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

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'https://local');
    const { ip, viaTunnel } = clientIp(req, o.trustedProxies?.() ?? []);
    if (viaTunnel) lastTunnel = now();
    const hosts = o.allowedHosts?.();
    if (hosts && !hosts.includes(hostOf(req))) return send(res, 421, { ok: false, error: 'Unknown host' });
    const route = `${req.method} ${url.pathname}`;
    const done = (p: Promise<void> | void) => Promise.resolve(p).catch(e => send(res, 400, { ok: false, error: e instanceof ApiError ? e.message : 'Bad request' }));
    if (route === 'POST /api') return done(handleApi(req, res, ip));
    if (route === 'POST /pair') return done(handlePair(req, res, ip));
    if (route === 'POST /join') return done(handleJoin(req, res, ip));
    if (route === 'POST /events-ticket') return handleTicket(req, res);
    if (route === 'GET /events') return handleEvents(req, res, url);
    if (req.method === 'GET' || req.method === 'HEAD') return done(handleStatic(req, res, url));
    send(res, 405, { ok: false });
  };
  const server: Server = createServer(o.tls, handler);
  const plain = o.loopbackPort ? createHttpServer(handler) : null;

  const listen = (srv: { once: Server['once']; listen: Server['listen']; address: Server['address'] }, port: number, host: string) => new Promise<number>((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(port, host, () => { const a = srv.address(); resolve(typeof a === 'object' && a ? a.port : port); });
  });
  return (async () => {
    const port = await listen(server, o.port, o.host ?? '0.0.0.0');
    let loopbackPort: number | null = null;
    // Loopback only: a tunnel connector on this PC is the only thing that can reach it.
    if (plain) { try { loopbackPort = await listen(plain as any, o.loopbackPort!, '127.0.0.1'); } catch (e) { server.close(); throw e; } }
    return {
      port, loopbackPort, broadcast,
      clients: () => streams.size,
      lastTunnelAt: () => lastTunnel,
      close: () => new Promise<void>(r => {
        for (const s of streams) s.end(); streams.clear();
        let n = plain ? 2 : 1; const one = () => { if (--n === 0) r(); };
        server.close(one); server.closeAllConnections?.();
        if (plain) { plain.close(one); plain.closeAllConnections?.(); }
      }),
    };
  })();
}
