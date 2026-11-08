// Settings → Access from home (Cloudflare Tunnel). The installers ship Cloudflare's connector, so an
// administrator can open a quick test link or connect the unit's own tunnel with one button. Cloudflare
// Access (email code) should guard the address before anyone reaches the sign-in page.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Globe, Link2, Play, ShieldCheck, Square, TerminalSquare } from 'lucide-react';
import { call } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { cx } from '@/lib/format';
import { Button, CardHeader, Chip, Field, useToast } from '@/components/ui';

type Remote = { publicHostname: string | null; connectorIp: string | null; loopbackPort: number | null; lastTunnelAt: number | null };
type Tunnel = { state: 'off' | 'starting' | 'connected' | 'reconnecting' | 'error'; mode: 'quick' | 'token' | null; url: string | null; error: string | null; since: number | null;
  restarts: number; log: string[]; version: string | null; available: boolean; hasToken: boolean; autostart: boolean };

const STATE: Record<Tunnel['state'], { label: string; tone: 'good' | 'warn' | 'crit' | 'neutral' | 'info' }> = {
  off: { label: 'Not connected', tone: 'neutral' }, starting: { label: 'Connecting…', tone: 'info' }, connected: { label: 'Connected', tone: 'good' },
  reconnecting: { label: 'Reconnecting…', tone: 'warn' }, error: { label: 'Error', tone: 'crit' },
};

export function RemoteAccessCard() {
  const st = useApi<{ running: boolean; port: number; addresses: string[]; remote: Remote }>('desktop.mobileStatus');
  const tun = useApi<Tunnel>('desktop.tunnelStatus');
  const toast = useToast();
  const [host, setHost] = useState(''); const [lp, setLp] = useState(''); const [conn, setConn] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const r = st.data?.remote, t = tun.data;
  useEffect(() => { if (r) { setHost(r.publicHostname ?? ''); setLp(r.loopbackPort ? String(r.loopbackPort) : ''); setConn(r.connectorIp ?? ''); } }, [r?.publicHostname, r?.loopbackPort, r?.connectorIp]);
  useEffect(() => { const i = setInterval(tun.reload, 3000); return () => clearInterval(i); }, [tun.reload]);
  useEffect(() => { if (t?.mode === 'quick' && t.url) QRCode.toDataURL(t.url, { margin: 1, width: 180 }).then(setQr); else setQr(null); }, [t?.mode, t?.url]);
  if (!st.data || !r || !t) return null;
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try { await fn(); toast(msg); setToken(''); } catch (e: any) { toast(e.message, 'crit'); } finally { setBusy(false); tun.reload(); st.reload(); }
  };
  const save = () => run(() => call('desktop.remoteConfigure', { publicHostname: host || null, loopbackPort: lp ? Number(lp) : null, connectorIp: conn || null }), 'Saved');
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Select the address and copy it', 'crit'); } };
  const running = t.state !== 'off';
  const port = r.loopbackPort ?? 8790;

  return (
    <div className="card p-5 xl:col-span-2">
      <CardHeader title={<span className="flex items-center gap-2"><Globe size={15} className="text-accent-ink" />Access from home (Cloudflare Tunnel)</span>}
        right={<Chip tone={STATE[t.state].tone} dot>{STATE[t.state].label}{t.state === 'connected' && t.mode === 'token' && r.publicHostname ? ` · ${r.publicHostname}` : ''}</Chip>} />

      {t.available ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className={cx('inset flex flex-col gap-3 p-4', t.mode === 'quick' && running && 'border-accent')}>
            <span className="text-[13.5px] font-semibold">Quick test link</span>
            <span className="text-[12.5px] text-ink-3">A temporary address from Cloudflare, no account needed — to check that home access works from this PC. <b className="text-warn-ink">Anyone with the link reaches the sign-in page; stop it when you're done.</b></span>
            {t.mode === 'quick' && t.url ? (
              <div className="flex items-center gap-3">
                {qr && <img src={qr} alt="Quick link QR code" className="h-[110px] w-[110px] rounded-lg bg-white p-1" />}
                <div className="flex min-w-0 flex-col gap-2">
                  <span className="break-all font-mono text-[12px]">{t.url}</span>
                  <div className="flex gap-2"><Button size="sm" onClick={() => copy(t.url!)}><Copy size={13} />Copy</Button><Button size="sm" variant="danger" disabled={busy} onClick={() => run(() => call('desktop.tunnelStop', {}), 'Test link closed')}><Square size={13} />Stop</Button></div>
                </div>
              </div>
            ) : (
              <Button className="self-start" disabled={busy || (running && t.mode === 'token')} onClick={() => run(() => call('desktop.tunnelStart', { mode: 'quick' }), 'Opening a test link…')}><Play size={14} />{t.mode === 'quick' && running ? 'Waiting for the address…' : 'Start quick test'}</Button>
            )}
          </div>

          <div className={cx('inset flex flex-col gap-3 p-4', t.mode === 'token' && running && 'border-accent')}>
            <span className="text-[13.5px] font-semibold">Your unit's tunnel</span>
            <span className="text-[12.5px] text-ink-3">Permanent address with Cloudflare Access in front. Paste the token from Zero Trust → Networks → Tunnels; it is stored encrypted and reconnects whenever the app starts.</span>
            {t.mode === 'token' && running ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="danger" disabled={busy} onClick={() => run(() => call('desktop.tunnelStop', {}), 'Tunnel stopped')}><Square size={13} />Stop</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => call('desktop.tunnelStop', { forget: true }), 'Tunnel stopped and token removed')}>Stop and forget token</Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <input id="tunnel-token" type="password" className="field font-mono text-[12px]" placeholder={t.hasToken ? 'Saved — paste a new token to replace it' : 'eyJhIjoi…'} value={token} onChange={e => setToken(e.target.value)} autoComplete="off" />
                <Button className="self-start" variant="primary" disabled={busy || (!token && !t.hasToken) || (running && t.mode === 'quick')} onClick={() => run(() => call('desktop.tunnelStart', { mode: 'token', token: token || undefined }), 'Connecting your tunnel…')}><Link2 size={14} />Connect</Button>
              </div>
            )}
          </div>
          {(t.error || t.log.length > 0) && (
            <div className="flex flex-col gap-2 lg:col-span-2">
              {t.error && <p className="rounded-xl border border-crit/30 bg-crit-soft px-3 py-2 text-[12.5px] text-crit-ink">{t.error}</p>}
              <button className="flex items-center gap-1.5 self-start text-[12px] text-ink-3 hover:text-ink" onClick={() => setShowLog(!showLog)}><TerminalSquare size={13} />{showLog ? 'Hide' : 'Show'} connector log{t.version ? ` · cloudflared ${t.version}` : ''}</button>
              {showLog && <pre className="scroll-thin max-h-48 overflow-auto rounded-xl bg-panel-2 p-3 font-mono text-[11px] leading-relaxed text-ink-2">{t.log.slice(-12).join('\n')}</pre>}
            </div>
          )}
        </div>
      ) : (
        <p className="rounded-xl bg-panel-2 px-3 py-2 text-[12.5px] text-ink-3">The tunnel connector is not included in this build. Install cloudflared and point it at <span className="font-mono">http://localhost:{port}</span>, or run it on another always-on device and enter that device's address below.</p>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 border-t border-line pt-4 lg:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col gap-3">
          <Field label="Public address" hint="The name staff open at home, e.g. picu.yourhospital.org. Invite QR codes use it."><input id="remote-host" className="field" value={host} onChange={e => setHost(e.target.value)} placeholder="picu.example.org" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tunnel port on this PC" hint={`Default ${8790}`}><input id="remote-lp" className="field tnum" inputMode="numeric" value={lp} onChange={e => setLp(e.target.value)} placeholder="8790" /></Field>
            <Field label="Connector on another PC" hint="Only if cloudflared runs elsewhere"><input id="remote-conn" className="field tnum" value={conn} onChange={e => setConn(e.target.value)} placeholder="192.168.0.20" /></Field>
          </div>
          <Button className="self-start" onClick={save} disabled={busy}>Save address</Button>
          <p className="flex gap-2 text-[12px] text-ink-2"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-good-ink" />Three locks: Cloudflare Access (email code) → phone invite or pairing → each person's password and role. Everything is in the audit trail.</p>
        </div>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-[12.5px] text-ink-2">
          <li>Add your hospital's domain to a free Cloudflare account (or ask IT for a sub-domain).</li>
          <li>Zero Trust → Networks → Tunnels → <b>Create a tunnel</b> (cloudflared). Copy its token and press <b>Connect</b> above.</li>
          <li>In the tunnel, add a public hostname: your address → service <span className="font-mono text-[11.5px]">http://localhost:{port}</span>.</li>
          <li>Zero Trust → Access → Applications → <b>Self-hosted</b> for the same address; allow your staff's emails with a one-time PIN.</li>
          <li>Enter the address above, then use <b>Invite staff</b> — the QR code will use it.</li>
          {t.version === '2023.10.0' && <li className="text-warn-ink">This Windows 7 edition ships cloudflared 2023.10.0, the last release for Windows 7. Cloudflare only guarantees connectors up to a year old — if the tunnel stops connecting, the log says so; then run a current connector on another device.</li>}
        </ol>
      </div>
    </div>
  );
}
