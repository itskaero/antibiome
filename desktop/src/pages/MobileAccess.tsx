// Settings → Phone access (admin, PC only): turn the HTTPS server on, pair phones by QR code,
// see and revoke devices, and the checklist for hospital IT.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, QrCode, ShieldCheck, Smartphone, TriangleAlert } from 'lucide-react';
import { call } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { Button, CardHeader, Chip, Field, Modal, Toggle, useToast } from '@/components/ui';

interface Status {
  enabled: boolean; running: boolean; error: string | null; port: number; addresses: string[]; urls: string[];
  fingerprint: string | null; certificate: 'hospital' | 'generated'; clients: number; secureStorage: boolean;
}
interface DeviceRow { id: string; name: string; pairedAt: string; lastSeen: string | null; lastUser: string | null; revokedAt: string | null; pairedBy: string | null }

export function MobileAccessCard() {
  const status = useApi<Status>('desktop.mobileStatus');
  const devices = useApi<{ devices: DeviceRow[]; showNames: boolean }>('mobile.devices');
  const [port, setPort] = useState('');
  const [pair, setPair] = useState(false);
  const [it, setIt] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const s = status.data;
  useEffect(() => { if (s && !port) setPort(String(s.port)); }, [s, port]);
  if (!s) return null;
  const run = async (fn: () => Promise<any>, msg?: string) => {
    setBusy(true);
    try { await fn(); if (msg) toast(msg); } catch (e: any) { toast(e.message, 'crit'); } finally { setBusy(false); status.reload(); devices.reload(); }
  };
  const active = (devices.data?.devices ?? []).filter(d => !d.revokedAt);
  const revoked = (devices.data?.devices ?? []).filter(d => d.revokedAt);

  return (
    <div className="card p-5 xl:col-span-2">
      <CardHeader title={<span className="flex items-center gap-2"><Smartphone size={15} className="text-accent-ink" />Phone access over the hospital Wi-Fi</span>}
        right={<Toggle checked={s.enabled} onChange={v => run(() => call('desktop.mobileEnable', { on: v, port: Number(port) || undefined }), v ? 'Phone access on' : 'Phone access off')} label={s.running ? 'On' : s.enabled ? 'Error' : 'Off'} />} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col gap-3 text-[12.5px]">
          <ul className="flex flex-col gap-1.5 text-ink-2">
            <li className="flex gap-2"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-good-ink" />Phones use the PC over encrypted HTTPS; this PC stays the only data store, and nothing is cached on phones.</li>
            <li className="flex gap-2"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-good-ink" />Each phone is paired once with a single-use QR code; every user still signs in, and phones lock after 5 minutes.</li>
            <li className="flex gap-2"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-good-ink" />Bedside work only: census, admission, support, therapy, vitals, events, modules, PIM3, cultures, discharge, and a summary. Research, exports, AI and settings stay here.</li>
          </ul>
          {s.error && <p className="flex items-center gap-2 rounded-xl bg-crit-soft px-3 py-2 text-crit-ink"><TriangleAlert size={14} />{s.error}</p>}
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Port" className="w-28"><input className="field tnum" inputMode="numeric" value={port} onChange={e => setPort(e.target.value)} /></Field>
            {s.enabled && String(s.port) !== port && <Button size="sm" disabled={busy} onClick={() => run(() => call('desktop.mobileEnable', { on: true, port: Number(port) }), 'Port changed')}>Apply port</Button>}
            <Button size="sm" variant="primary" disabled={!s.running || busy} onClick={() => setPair(true)}><QrCode size={14} />Pair a phone</Button>
            <Button size="sm" variant="ghost" onClick={() => setIt(true)}>Checklist for IT</Button>
          </div>
          <div className="inset flex flex-col gap-1.5 p-3">
            <p><span className="text-ink-3">Address{s.urls.length > 1 ? 'es' : ''}:</span> {s.urls.length ? s.urls.map(u => <span key={u} className="mr-2 font-mono">{u}</span>) : <span className="text-warn-ink">No network connection found</span>}</p>
            <p><span className="text-ink-3">Certificate:</span> {s.certificate === 'hospital' ? 'issued by hospital IT' : 'self-signed on this PC (phones show a one-time warning)'}</p>
            {s.fingerprint && <p className="break-all"><span className="text-ink-3">SHA-256 fingerprint:</span> <span className="font-mono text-[11px]">{s.fingerprint}</span></p>}
            <p><span className="text-ink-3">Phones connected now:</span> {s.clients}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => { const pass = prompt('Passphrase for the hospital certificate (leave empty if none)'); if (pass !== null) run(() => call('desktop.mobileLoadPfx', { passphrase: pass }), 'Certificate loaded'); }}>Load hospital certificate…</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => confirm('Replace the certificate? Phones will see a new warning and fingerprint.') && run(() => call('desktop.mobileResetCert'), 'New certificate created')}>Reset certificate</Button>
            </div>
          </div>
          <Toggle checked={!!devices.data?.showNames} onChange={v => run(() => call('mobile.showNames', { on: v }), v ? 'Names shown on phones' : 'Names hidden on phones')} label="Show patient names and MRNs on phones" />
          <p className="text-[11.5px] text-ink-3">Off by default for personal phones: phones then show bed, pseudonymous ID, diagnosis and age. Screenshots cannot be blocked on phones; your information-governance team should approve personal-phone use.</p>
        </div>

        <div>
          <p className="mb-2 text-[12.5px] font-semibold">Paired phones · {active.length}</p>
          <div className="flex flex-col divide-y divide-line">
            {active.map(d => (
              <div key={d.id} data-device={d.name} className="flex items-center gap-3 py-2 text-[12.5px]">
                <Smartphone size={15} className="shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{d.name}</span>
                  <span className="block truncate text-[11.5px] text-ink-3">Paired {d.pairedAt.slice(0, 10)}{d.pairedBy ? ` by ${d.pairedBy}` : ''} · last seen {d.lastSeen ? d.lastSeen.replace('T', ' ') : 'never'}{d.lastUser ? ` (${d.lastUser})` : ''}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => confirm(`Revoke "${d.name}"? It is signed out immediately and must be paired again.`) && run(() => call('mobile.revoke', { id: d.id }), 'Phone revoked')}>Revoke</Button>
              </div>
            ))}
            {!active.length && <p className="py-2 text-[12.5px] text-ink-3">No phones paired.</p>}
          </div>
          {!!revoked.length && <p className="mt-2 text-[11.5px] text-ink-3">{revoked.length} revoked phone{revoked.length > 1 ? 's' : ''} kept for the audit trail.</p>}
        </div>
      </div>
      <PairModal open={pair} onClose={() => { setPair(false); devices.reload(); }} urls={s.urls} fingerprint={s.fingerprint} />
      <ItModal open={it} onClose={() => setIt(false)} port={s.port} />
    </div>
  );
}

function PairModal({ open, onClose, urls, fingerprint }: { open: boolean; onClose: () => void; urls: string[]; fingerprint: string | null }) {
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [url, setUrl] = useState(urls[0] ?? '');
  const [qr, setQr] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const toast = useToast();
  useEffect(() => { if (open) { setCode(null); call('mobile.pairingCode').then(setCode).catch(e => toast(e.message, 'crit')); } }, [open, toast]);
  useEffect(() => { if (!url && urls[0]) setUrl(urls[0]); }, [urls, url]);
  const link = code && url ? `${url}/#/pair/${code.code}` : '';
  useEffect(() => { if (link) QRCode.toDataURL(link, { margin: 1, width: 240, errorCorrectionLevel: 'M' }).then(setQr); else setQr(null); }, [link]);
  useEffect(() => { if (!code) return; const t = setInterval(() => setLeft(Math.max(0, Math.round((code.expiresAt - Date.now()) / 1000))), 500); return () => clearInterval(t); }, [code]);
  return (
    <Modal open={open} onClose={onClose} width={560} title="Pair a phone" subtitle="Scan with the phone's camera while it is on the hospital Wi-Fi. The code works once, for 10 minutes."
      footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <div className="grid h-[240px] w-[240px] shrink-0 place-items-center rounded-2xl bg-white p-2">{qr ? <img src={qr} alt="Pairing QR code" width={224} height={224} /> : <span className="text-[12px] text-neutral-500">…</span>}</div>
        <div className="flex min-w-0 flex-col gap-3 text-[12.5px]">
          <div>
            <p className="text-ink-3">Or type this code on the phone</p>
            <p className="tnum text-[26px] font-semibold tracking-[0.15em]">{code?.code ?? '…'}</p>
            <p className={left < 60 ? 'text-warn-ink' : 'text-ink-3'}>{left > 0 ? `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : code ? 'Expired — close and pair again' : ''}</p>
          </div>
          {urls.length > 1 && (
            <Field label="Network"><select className="field" value={url} onChange={e => setUrl(e.target.value)}>{urls.map(u => <option key={u}>{u}</option>)}</select></Field>
          )}
          <p className="break-all"><span className="text-ink-3">Address:</span> <span className="font-mono">{url}</span>
            <button className="ml-1 text-ink-3 hover:text-ink" title="Copy" onClick={() => navigator.clipboard?.writeText(link)}><Copy size={12} /></button></p>
          {fingerprint && <p className="text-[11.5px] text-ink-3">If the phone warns about the certificate, open its details and check the SHA-256 fingerprint starts with <span className="font-mono text-ink-2">{fingerprint.slice(0, 23)}</span> before continuing.</p>}
        </div>
      </div>
    </Modal>
  );
}

function ItModal({ open, onClose, port }: { open: boolean; onClose: () => void; port: number }) {
  const cmd = `netsh advfirewall firewall add rule name="Antibiome PICU phones" dir=in action=allow protocol=TCP localport=${port} profile=domain,private`;
  return (
    <Modal open={open} onClose={onClose} width={640} title="Checklist for hospital IT" subtitle="What the network needs so phones can reach this PC." footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
      <ol className="flex list-decimal flex-col gap-3 pl-5 text-[13px] text-ink-2">
        <li><b>Fixed address.</b> Give this PC a static IP or a DHCP reservation, so the phones' address does not change.</li>
        <li><b>Firewall.</b> Allow inbound TCP port {port} on this PC (domain/private networks only):
          <pre className="mt-1.5 overflow-x-auto rounded-xl bg-panel-2 p-3 text-[11.5px] whitespace-pre-wrap">{cmd}</pre></li>
        <li><b>Network path.</b> Phones on the staff Wi-Fi must be able to reach this PC (same VLAN, or a rule between the Wi-Fi and the PC's network). Guest Wi-Fi should not.</li>
        <li><b>Certificate (recommended).</b> Issue a certificate for this PC's address/hostname from the hospital CA and load it here as a PFX, so phones show no warning.</li>
        <li><b>Power.</b> The PC must stay on with the app running; the app keeps it from sleeping while phone access is on.</li>
        <li><b>Governance.</b> Personal phones on the clinical network need information-governance approval. Phones cannot prevent screenshots.</li>
      </ol>
      <p className="mt-4 flex items-center gap-1.5 text-[12px] text-ink-3"><Chip>Tip</Chip>Plain HTTP is never offered — patient data only travels encrypted.</p>
    </Modal>
  );
}
