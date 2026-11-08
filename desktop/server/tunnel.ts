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
