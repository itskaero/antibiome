// ═══════════════════════════════════════════════════════════
//  Built-in Cloudflare Tunnel connector for "Access from home".
//
//  The installers ship cloudflared (resources/cloudflared/cloudflared.exe). This runs it as a child
//  process pointed at the phone server's loopback listener, watches its log for the connection state,
//  restarts it with a back-off if it exits, and stops it with the app.
//
//    quick  → `tunnel --url http://127.0.0.1:<port>`: a temporary *.trycloudflare.com address with no
//             Cloudflare account. For testing only — there is no Cloudflare Access in front of it.
//    token  → `tunnel run --token …`: the unit's own named tunnel, hostname and Access policy are set
//             up in the Cloudflare dashboard.
// ═══════════════════════════════════════════════════════════
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';

export type TunnelMode = 'quick' | 'token';
export type TunnelState = 'off' | 'starting' | 'connected' | 'reconnecting' | 'error';
export interface TunnelStatus { state: TunnelState; mode: TunnelMode | null; url: string | null; error: string | null; since: number | null; restarts: number; log: string[]; binary: string | null; version: string | null }

export interface TunnelOptions {
  /** Path to cloudflared; null = not bundled on this platform. */
  binary: string | null;
  version?: string | null;
  /** For tests: the command to run instead of `binary` (e.g. node + a fake script). */
  spawnOverride?: (args: string[]) => ChildProcess;
  now?: () => number;
}

const QUICK_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const CONNECTED = /Registered tunnel connection|Connection [0-9a-f-]+ registered/i;
/** Lines worth showing an administrator (tokens are never logged by cloudflared, but scrub anyway). */
const scrub = (l: string) => l.replace(/(--token\s+|token=)[A-Za-z0-9._-]+/g, '$1••••').slice(0, 300);

export class TunnelManager extends EventEmitter {
  private child: ChildProcess | null = null;
  private wanted: { mode: TunnelMode; port: number; token?: string } | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private s: TunnelStatus;
  private readonly now: () => number;

  constructor(private o: TunnelOptions) {
    super();
    this.now = o.now ?? Date.now;
    this.s = { state: 'off', mode: null, url: null, error: null, since: null, restarts: 0, log: [], binary: o.binary, version: o.version ?? null };
  }

  get available() { return !!this.o.spawnOverride || (!!this.o.binary && existsSync(this.o.binary)); }
  status(): TunnelStatus { return { ...this.s, log: [...this.s.log] }; }

  start(mode: TunnelMode, port: number, token?: string) {
    if (!this.available) throw new Error('The tunnel connector is not included in this build. Install cloudflared yourself, or use the Windows installer.');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Set a tunnel port first (Settings → Access from home).');
    if (mode === 'token' && !/^[A-Za-z0-9._=-]{40,}$/.test(token ?? '')) throw new Error('That does not look like a tunnel token — copy the long token from the Cloudflare dashboard.');
    this.stop();
    this.wanted = { mode, port, token };
    this.s = { ...this.s, state: 'starting', mode, url: null, error: null, since: this.now(), restarts: 0, log: [] };
    this.launch();
  }

  stop() {
    this.wanted = null;
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    const c = this.child; this.child = null;
    if (c && c.exitCode == null) c.kill();
    this.s = { ...this.s, state: 'off', url: null, since: null };
    this.emit('change', this.status());
  }

  private launch() {
    const w = this.wanted!;
    const args = w.mode === 'quick'
      ? ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${w.port}`]
      : ['tunnel', '--no-autoupdate', 'run', '--token', w.token!];
    const child = this.o.spawnOverride ? this.o.spawnOverride(args) : spawn(this.o.binary!, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    let buf = '';
    const onData = (d: Buffer) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/); buf = lines.pop() ?? '';
      for (const raw of lines) this.line(raw);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', e => this.fail(`Could not start the connector: ${e.message}`));
    child.on('exit', code => {
      if (this.child !== child) return;          // stopped or replaced
      this.child = null;
      if (!this.wanted) return;
      // Keep trying with a back-off (10 s → 5 min); a quick tunnel gets a new address each time.
      this.s.restarts++;
      this.s = { ...this.s, state: 'reconnecting', url: w.mode === 'quick' ? null : this.s.url, error: `The connector stopped (exit ${code ?? '?'}); retrying.` };
      this.emit('change', this.status());
      const delay = Math.min(300_000, 10_000 * 2 ** Math.min(5, this.s.restarts - 1));
      this.retry = setTimeout(() => { this.retry = null; if (this.wanted) this.launch(); }, delay);
    });
  }

  private line(raw: string) {
    const l = scrub(raw.trim());
    if (!l) return;
    this.s.log.push(l); if (this.s.log.length > 40) this.s.log.splice(0, this.s.log.length - 40);
    const url = l.match(QUICK_URL)?.[0];
    let changed = false;
    if (url && this.wanted?.mode === 'quick' && this.s.url !== url) { this.s.url = url; changed = true; }
    if (CONNECTED.test(l) && this.s.state !== 'connected') { this.s = { ...this.s, state: 'connected', error: null, since: this.now() }; changed = true; }
    if (/ERR .*(Unauthorized|invalid token|Provided Tunnel token is not valid)/i.test(l)) { this.s.error = 'Cloudflare refused the token — copy it again from the dashboard.'; changed = true; }
    else if (/ERR .*(unsupported|too old|deprecated)/i.test(l)) { this.s.error = 'Cloudflare reports this connector version is no longer supported.'; changed = true; }
    if (changed) this.emit('change', this.status());
  }

  private fail(msg: string) {
    this.s = { ...this.s, state: 'error', error: msg };
    this.wanted = null;
    this.emit('change', this.status());
  }
}

// ── "Test from the internet" ─────────────────────────────────
// Looks up the public (or quick-link) name and fetches /healthz through Cloudflare, so an administrator
// learns *why* phones can't open the address instead of just "it never loads".
export type SelfTestCode = 'ok' | 'access' | 'no-internet' | 'no-dns' | 'no-origin' | 'not-running' | 'other';
export interface SelfTestResult { code: SelfTestCode; ok: boolean; message: string; host: string | null; status?: number }
export interface SelfTestDeps {
  lookup: (host: string) => Promise<unknown>;
  fetch: (url: string) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;
}

export async function tunnelSelfTest(host: string | null, tunnelState: TunnelState, deps: SelfTestDeps): Promise<SelfTestResult> {
  const r = (code: SelfTestCode, message: string, status?: number): SelfTestResult => ({ code, ok: code === 'ok' || code === 'access', message, host, status });
  if (!host) return r('other', 'Enter the public address first, or start a quick test link.');
  // Is this PC online at all? (Cloudflare's own name always exists.)
  try { await deps.lookup('cloudflare.com'); } catch { return r('no-internet', 'This PC has no internet connection, so the tunnel cannot reach Cloudflare. Connect it (phone USB tethering or Wi-Fi) and try again.'); }
  if (tunnelState !== 'connected') return r('not-running', 'The connector is not connected yet — start it above and wait for "Connected".');
  try { await deps.lookup(host); } catch {
    return r('no-dns', `The name ${host} does not exist on the internet yet. In Cloudflare: check the domain's nameservers are Cloudflare's, and that the tunnel has a public hostname for ${host}.`);
  }
  let res;
  try { res = await deps.fetch(`https://${host}/healthz`); } catch (e: any) { return r('other', `Could not open https://${host}: ${e?.message ?? e}. Phones on mobile data may see the same.`); }
  const body = await res.text().catch(() => '');
  if (res.status === 200 && body.includes('antibiome')) return r('ok', `Working: https://${host} reaches this PC from the internet. Phones must pair once on this address (scan an invite QR).`, 200);
  // Cloudflare Access answers first with its sign-in page (a redirect or 401/403 from cloudflareaccess.com).
  const loc = res.headers.get('location') ?? '';
  if ((res.status >= 300 && res.status < 400 && /cloudflareaccess\.com/.test(loc)) || /cloudflareaccess|cf-access/i.test(body.slice(0, 4000)) || res.headers.get('cf-access-domain'))
    return r('access', `Working, with Cloudflare Access in front: https://${host} asks for the email code first, as it should.`, res.status);
  if (res.status === 502 || res.status === 530 || res.status === 503 || /error code: 10(16|33)|Bad gateway/i.test(body))
    return r('no-origin', `Cloudflare reached the tunnel but not the app (HTTP ${res.status}). In the tunnel's public hostname, set the service to http://localhost:8790 (http, not https).`, res.status);
  return r('other', `https://${host} answered HTTP ${res.status} — it may point to a different service.`, res.status);
}

/** A plain HTTPS GET with no redirects (works on Electron 22 / Node 16, which has no global fetch). */
export function httpsGet(url: string, timeoutMs = 15_000): ReturnType<SelfTestDeps['fetch']> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { method: 'GET', headers: { 'User-Agent': 'antibiome-selftest' } }, res => {
      let body = ''; res.setEncoding('utf8');
      res.on('data', (c: string) => { if (body.length < 20_000) body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: { get: (n: string) => { const v = res.headers[n.toLowerCase()]; return v == null ? null : String(v); } }, text: async () => body }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end();
  });
}
