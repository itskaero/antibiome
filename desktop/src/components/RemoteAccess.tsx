// Settings → Access from home (Cloudflare Tunnel). The app never opens the internet connection itself:
// a Cloudflare connector (cloudflared) on this network does, and Cloudflare Access checks staff email
// before anyone reaches the sign-in page.
import { useEffect, useState } from 'react';
import { Globe, ShieldCheck } from 'lucide-react';
import { call } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { Button, CardHeader, Chip, Field, useToast } from '@/components/ui';

type Remote = { publicHostname: string | null; connectorIp: string | null; loopbackPort: number | null; lastTunnelAt: number | null };

export function RemoteAccessCard() {
  const st = useApi<{ running: boolean; port: number; addresses: string[]; remote: Remote }>('desktop.mobileStatus');
  const toast = useToast();
  const [host, setHost] = useState(''); const [lp, setLp] = useState(''); const [conn, setConn] = useState('');
  const r = st.data?.remote;
  useEffect(() => { if (r) { setHost(r.publicHostname ?? ''); setLp(r.loopbackPort ? String(r.loopbackPort) : ''); setConn(r.connectorIp ?? ''); } }, [r?.publicHostname, r?.loopbackPort, r?.connectorIp]);
  if (!st.data || !r) return null;
  const save = async () => {
    try { await call('desktop.remoteConfigure', { publicHostname: host || null, loopbackPort: lp ? Number(lp) : null, connectorIp: conn || null }); toast(host ? 'Remote access saved' : 'Remote access off'); st.reload(); }
    catch (e: any) { toast(e.message, 'crit'); }
  };
  const lan = st.data.addresses[0] ?? 'this-PC-address';
  const target = lp ? `http://localhost:${lp}` : `https://${lan}:${st.data.port}  (No TLS Verify: on)`;
  return (
    <div className="card p-5 xl:col-span-2">
      <CardHeader title={<span className="flex items-center gap-2"><Globe size={15} className="text-accent-ink" />Access from home (Cloudflare Tunnel)</span>}
        right={r.publicHostname ? <Chip tone={r.lastTunnelAt && Date.now() - r.lastTunnelAt < 600_000 ? 'good' : 'neutral'} dot>{r.lastTunnelAt ? `Tunnel used ${new Date(r.lastTunnelAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'No tunnel traffic yet'}</Chip> : <Chip>Off</Chip>} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col gap-3">
          <Field label="Public address" hint="The name staff open at home, e.g. picu.yourhospital.org"><input id="remote-host" className="field" value={host} onChange={e => setHost(e.target.value)} placeholder="picu.example.org" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tunnel port on this PC" hint="Only if cloudflared runs on this PC"><input id="remote-lp" className="field tnum" inputMode="numeric" value={lp} onChange={e => setLp(e.target.value)} placeholder="8790" /></Field>
            <Field label="Connector on another PC" hint="Its address, if cloudflared runs elsewhere"><input id="remote-conn" className="field tnum" value={conn} onChange={e => setConn(e.target.value)} placeholder="192.168.0.20" /></Field>
          </div>
          <Button variant="primary" className="self-start" onClick={save}>Save</Button>
          <p className="flex gap-2 text-[12px] text-ink-2"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-good-ink" />Three locks: Cloudflare Access (email code) → phone pairing or invite → each person's password and role. Everything is in the audit trail.</p>
        </div>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-[12.5px] text-ink-2">
          <li>Make a free Cloudflare account and add your hospital's domain (or ask IT for a sub-domain).</li>
          <li>Zero Trust → Networks → Tunnels → <b>Create a tunnel</b>, and install the connector it shows on an always-on computer on this network. <span className="text-warn-ink">This PC runs Windows 7, which current cloudflared does not support — use a Windows 10/11 PC or a Raspberry Pi on the same network and enter its address above.</span></li>
          <li>Add a public hostname: your address → service <span className="font-mono text-[11.5px]">{target}</span>.</li>
          <li>Zero Trust → Access → Applications → <b>Self-hosted</b> for the same address; allow your staff's emails with a one-time PIN.</li>
          <li>Save the address here, then use <b>Invite staff</b> — the QR code will use the public address.</li>
        </ol>
      </div>
    </div>
  );
}
