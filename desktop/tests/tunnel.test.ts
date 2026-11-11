import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { TunnelManager, tunnelSelfTest, type SelfTestDeps, type TunnelStatus } from '../server/tunnel';

// A stand-in for cloudflared: prints the given lines (as cloudflared does, on stderr), then waits or exits.
const fake = (lines: string[], exitAfterMs?: number) => (args: string[]) => spawn(process.execPath, ['-e', `
  const lines = ${JSON.stringify(lines)};
  console.error('args: ' + ${JSON.stringify(JSON.stringify([]))}.length + ' ' + process.argv.slice(1).join(' '));
  lines.forEach((l, i) => setTimeout(() => console.error(l), 20 * (i + 1)));
  ${exitAfterMs != null ? `setTimeout(() => process.exit(1), ${exitAfterMs});` : 'setInterval(() => {}, 1000);'}
`, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
const until = (t: TunnelManager, pred: (s: TunnelStatus) => boolean) => new Promise<TunnelStatus>(resolve => {
  if (pred(t.status())) return resolve(t.status());
  const h = (s: TunnelStatus) => { if (pred(s)) { t.off('change', h); resolve(s); } };
  t.on('change', h);
});

describe('built-in Cloudflare connector', () => {
  let t: TunnelManager | null = null;
  afterEach(() => { t?.stop(); t = null; });

  it('starts a quick test link and reads its address and connection state', async () => {
    t = new TunnelManager({ binary: null, spawnOverride: fake([
      '2026-11-08T12:00:00Z INF Requesting new quick Tunnel on trycloudflare.com...',
      '2026-11-08T12:00:01Z INF |  https://calm-river-ward-picu.trycloudflare.com  |',
      '2026-11-08T12:00:02Z INF Registered tunnel connection connIndex=0 location=khi01 protocol=quic',
    ]) });
    t.start('quick', 8790);
    const s = await until(t, x => x.state === 'connected' && !!x.url);
    expect(s).toMatchObject({ mode: 'quick', url: 'https://calm-river-ward-picu.trycloudflare.com', error: null });
    expect(s.log.join('\n')).toContain('--url http://127.0.0.1:8790');
  });

  it('runs a named tunnel by token, never logs the token, and explains a refused token', async () => {
    const token = 'eyJhIjoiMTIzNDU2Nzg5MCIsInQiOiJhYmNkZWYtMTIzNDUiLCJzIjoiWlhoaGJYQnNaUT09In0';
    t = new TunnelManager({ binary: null, spawnOverride: fake(['2026-11-08T12:00:00Z ERR Provided Tunnel token is not valid']) });
    expect(() => t!.start('token', 8790, 'short')).toThrow('tunnel token');
    t.start('token', 8790, token);
    const s = await until(t, x => !!x.error);
    expect(s.error).toMatch(/refused the token/);
    expect(s.log.join('\n')).not.toContain(token);
    expect(s.log.join('\n')).toContain('--token ••••');
  });

  it('restarts a connector that exits, with a back-off', async () => {
    t = new TunnelManager({ binary: null, spawnOverride: fake(['2026-11-08T12:00:00Z INF Registered tunnel connection connIndex=0'], 150) });
    t.start('token', 8790, 'x'.repeat(60));
    await until(t, x => x.state === 'connected');
    const s = await until(t, x => x.state === 'reconnecting');
    expect(s.restarts).toBe(1);
    expect(s.error).toMatch(/retrying/);
    t.stop();
    expect(t.status().state).toBe('off');
  });

  it('says so when no connector is bundled', () => {
    t = new TunnelManager({ binary: null });
    expect(t.available).toBe(false);
    expect(() => t!.start('quick', 8790)).toThrow('not included');
  });
});

describe('test from the internet', () => {
  const res = (status: number, body = '', headers: Record<string, string> = {}) => async () => ({ status, headers: { get: (n: string) => headers[n] ?? null }, text: async () => body });
  const deps = (o: Partial<{ online: boolean; dns: boolean; fetch: SelfTestDeps['fetch'] }>): SelfTestDeps => ({
    lookup: async h => { if (h === 'cloudflare.com' ? o.online === false : o.dns === false) throw new Error('ENOTFOUND'); return {}; },
    fetch: o.fetch ?? res(200, '{"ok":true,"app":"antibiome"}'),
  });
  it('names the problem in plain words', async () => {
    const host = 'picu.example.org';
    expect((await tunnelSelfTest(host, 'connected', deps({}))).code).toBe('ok');
    expect((await tunnelSelfTest(host, 'connected', deps({ online: false }))).message).toMatch(/no internet/);
    expect((await tunnelSelfTest(host, 'reconnecting', deps({}))).code).toBe('not-running');
    expect((await tunnelSelfTest(host, 'connected', deps({ dns: false }))).message).toMatch(/nameservers/);
    expect((await tunnelSelfTest(host, 'connected', deps({ fetch: res(502, 'Bad gateway') }))).message).toMatch(/http:\/\/localhost:8790/);
    expect((await tunnelSelfTest(host, 'connected', deps({ fetch: res(530, 'error code: 1033') }))).code).toBe('no-origin');
    const access = await tunnelSelfTest(host, 'connected', deps({ fetch: res(302, '', { location: 'https://unit.cloudflareaccess.com/cdn-cgi/access/login' }) }));
    expect(access).toMatchObject({ code: 'access', ok: true });
    expect((await tunnelSelfTest(null, 'off', deps({}))).ok).toBe(false);
  });
});
