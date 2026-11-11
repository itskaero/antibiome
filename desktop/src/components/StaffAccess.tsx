// Staff invites (QR / link) and the account requests they produce. Admins create invites on the PC
// and approve requests on the PC or on their own phone.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, UserPlus, X } from 'lucide-react';
import { call } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { Button, CardHeader, Chip, Field, Modal, useToast } from '@/components/ui';
import { ROLE_LABEL, type Role } from '@shared/types';

interface Request { id: string; username: string; displayName: string; role: Role; requestedAt: string; device: string | null }
interface Invite { id: string; role: Role; createdAt: string; expiresAt: number; maxUses: number; uses: number; revokedAt: string | null; by: string | null; active: boolean }

export function AccountRequests({ compact }: { compact?: boolean }) {
  const { data } = useApi<Request[]>('users.requests');
  const toast = useToast();
  const [roles, setRoles] = useState<Record<string, Role>>({});
  if (!data?.length) return null;
  const decide = async (r: Request, approve: boolean) => {
    try { await call('users.decideRequest', { id: r.id, approve, role: roles[r.id] ?? r.role }); toast(approve ? `${r.displayName} can now sign in` : `Declined ${r.displayName}`); }
    catch (e: any) { toast(e.message, 'crit'); }
  };
  return (
    <div className={compact ? 'card flex flex-col gap-2 p-4' : 'card p-5 xl:col-span-2'}>
      {!compact && <CardHeader title={<span className="flex items-center gap-2"><UserPlus size={15} className="text-accent-ink" />Account requests</span>} right={<Chip tone="warn" dot>{data.length} waiting</Chip>} />}
      {compact && <p className="text-[13px] font-semibold">Account requests · {data.length}</p>}
      <div className="flex flex-col divide-y divide-line">
        {data.map(r => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 py-2.5 text-[13px]">
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{r.displayName} <span className="font-normal text-ink-3">· {r.username}</span></span>
              <span className="block text-[11.5px] text-ink-3">Requested {r.requestedAt.replace('T', ' ')}{r.device ? ` from "${r.device}"` : ''}</span>
            </span>
            <select id={`req-role-${r.id}`} className="field h-8 w-auto py-0 text-[12.5px]" value={roles[r.id] ?? r.role} onChange={e => setRoles({ ...roles, [r.id]: e.target.value as Role })}>
              {(['clinician', 'nurse', 'viewer', 'researcher'] as Role[]).map(x => <option key={x} value={x}>{ROLE_LABEL[x]}</option>)}
            </select>
            <Button size="sm" variant="primary" onClick={() => decide(r, true)}><Check size={14} />Approve</Button>
            <Button size="sm" variant="ghost" onClick={() => decide(r, false)}><X size={14} />Decline</Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function InviteModal({ open, onClose, urls }: { open: boolean; onClose: () => void; urls: string[] }) {
  const toast = useToast();
  const invites = useApi<Invite[]>(open ? 'invites.list' : null);
  const [role, setRole] = useState<Role>('clinician');
  const [days, setDays] = useState('7');
  const [uses, setUses] = useState('10');
  const [url, setUrl] = useState(urls[0] ?? '');
  const [code, setCode] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const link = code && url ? `${url}/#/join/${code}` : null;
  useEffect(() => { if (!url && urls[0]) setUrl(urls[0]); }, [urls, url]);
  useEffect(() => { if (link) QRCode.toDataURL(link, { margin: 1, width: 240, errorCorrectionLevel: 'M' }).then(setQr); else setQr(null); }, [link]);
  useEffect(() => { if (!open) setCode(null); }, [open]);
  const create = async () => {
    try { const r = await call<{ code: string }>('invites.create', { role, days: Number(days), maxUses: Number(uses) }); setCode(r.code); invites.reload(); }
    catch (e: any) { toast(e.message, 'crit'); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link!); toast('Link copied'); } catch { toast('Select the link and copy it', 'crit'); } };
  return (
    <Modal open={open} onClose={onClose} title="Invite staff" subtitle="One QR code or link for several people. Each person creates their own account on their phone; you approve each request." width={640}>
      <div className="flex flex-col gap-4">
        {!code ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Role"><select id="inv-role" className="field" value={role} onChange={e => setRole(e.target.value as Role)}>{(['clinician', 'nurse', 'viewer', 'researcher'] as Role[]).map(x => <option key={x} value={x}>{ROLE_LABEL[x]}</option>)}</select></Field>
            <Field label="Valid for"><select id="inv-days" className="field" value={days} onChange={e => setDays(e.target.value)}><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option></select></Field>
            <Field label="People"><select id="inv-uses" className="field" value={uses} onChange={e => setUses(e.target.value)}><option value="1">1</option><option value="5">Up to 5</option><option value="10">Up to 10</option><option value="30">Up to 30</option></select></Field>
            <Button variant="primary" className="sm:col-span-3" onClick={create}><UserPlus size={15} />Create invite</Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            {urls.length > 1 && <Field label="Address on the invite" className="w-full"><select id="inv-url" className="field" value={url} onChange={e => setUrl(e.target.value)}>{urls.map(u => <option key={u}>{u}</option>)}</select></Field>}
            {qr && <img src={qr} alt="Invite QR code" className="h-[240px] w-[240px] rounded-xl bg-white p-2" />}
            <p className="w-full break-all rounded-xl bg-panel-2 px-3 py-2 font-mono text-[12px]">{link}</p>
            <div className="flex gap-2"><Button size="sm" onClick={copy}><Copy size={14} />Copy link</Button><Button size="sm" variant="ghost" onClick={() => setCode(null)}>New invite</Button></div>
            <p className="text-center text-[12px] text-ink-3">Shown once — the code is not stored. Phones must be able to reach this address (hospital Wi-Fi, or the remote address).</p>
          </div>
        )}
        {!!invites.data?.length && (
          <div>
            <p className="mb-1 text-[12.5px] font-semibold">Invites</p>
            <div className="flex flex-col divide-y divide-line text-[12.5px]">
              {invites.data.slice(0, 8).map(i => (
                <div key={i.id} className="flex items-center gap-3 py-1.5">
                  <span className="flex-1">{ROLE_LABEL[i.role]} · {i.uses}/{i.maxUses} used · {i.active ? `expires ${new Date(i.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : i.revokedAt ? 'revoked' : 'finished'}<span className="text-ink-3"> · by {i.by ?? '—'}</span></span>
                  {i.active && <Button size="sm" variant="ghost" onClick={async () => { await call('invites.revoke', { id: i.id }); invites.reload(); }}>Revoke</Button>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
