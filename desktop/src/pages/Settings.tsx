import { useState } from 'react';
import { DatabaseBackup, FileUp, FolderOpen, KeyRound, LineChart, Settings, UserPlus } from 'lucide-react';
import { call } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { Button, CardHeader, Chip, ErrorNote, Field, Modal, PageHeader, useToast } from '@/components/ui';
import { ROLE_LABEL, type Role, type User } from '@shared/types';

export function SettingsPage({ user }: { user: User }) {
  const isAdmin = user.role === 'admin';
  const settings = useApi<{ unitName: string; beds: number }>('settings.get');
  const info = useApi<{ dataDir: string; dbFile: string; version: string; demo: boolean }>('desktop.info');
  const users = useApi<any[]>(isAdmin ? 'users.list' : null);
  const [addUser, setAddUser] = useState(false);
  const [pw, setPw] = useState(false);
  const toast = useToast();
  const run = (fn: () => Promise<any>, msg: (r: any) => string | null) => async () => {
    try { const r = await fn(); const m = msg(r); if (m) toast(m); } catch (e: any) { toast(e.message, 'crit'); }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon={<Settings className="text-accent-ink" size={22} />} title="Settings" subtitle="Unit, people and the local database." />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {isAdmin && settings.data && <UnitCard s={settings.data} />}

        <div className="card p-5">
          <CardHeader title="Local database" info="SQLite file on this computer. A snapshot is taken automatically once a day (last 14 kept)." />
          <p className="font-mono text-[12px] break-all text-ink-2">{info.data?.dbFile}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Chip>Version {info.data?.version}</Chip>
            {info.data?.demo && <Chip tone="warn">Contains synthetic demo data</Chip>}
          </div>
          {isAdmin && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={run(() => call('desktop.backupNow'), p => (p ? `Backup saved to ${p}` : null))}><DatabaseBackup size={14} />Back up now…</Button>
              <Button size="sm" variant="ghost" onClick={run(() => call('desktop.openDataFolder'), () => null)}><FolderOpen size={14} />Open data folder</Button>
              <Button size="sm" variant="ghost" onClick={run(() => call('desktop.importLegacy'), r => (r ? `Imported ${r.imported} cultures (${r.skipped} skipped)${r.unknownOrganisms.length ? ` · ${r.unknownOrganisms.length} unrecognised organism names kept as typed` : ''}` : null))}><FileUp size={14} />Import Antibiome cultures…</Button>
              <Button size="sm" variant="ghost" onClick={run(() => call('desktop.loadDemo'), n => `Loaded ${n} synthetic admissions`)}><LineChart size={14} />Load demo data</Button>
            </div>
          )}
          <p className="mt-4 text-[12px] text-ink-3">Protect this PC with a Windows account per user, BitLocker disk encryption, and a backup copy kept off the machine (e.g. an encrypted USB drive in a locked cupboard).</p>
        </div>

        {isAdmin && (
          <div className="card p-5 xl:col-span-2">
            <CardHeader title="People & roles" right={<Button size="sm" variant="primary" onClick={() => setAddUser(true)}><UserPlus size={14} />Add user</Button>} />
            <table className="w-full text-[13px]">
              <thead className="text-left text-[11.5px] text-ink-3"><tr><th className="pb-2 font-medium">Name</th><th className="pb-2 font-medium">Username</th><th className="pb-2 font-medium">Role</th><th className="pb-2 font-medium">Status</th><th /></tr></thead>
              <tbody>
                {(users.data ?? []).map(u => (
                  <tr key={u.id} className="border-t border-line">
                    <td className="py-2.5 font-medium">{u.displayName}</td>
                    <td className="py-2.5 font-mono text-[12px] text-ink-2">{u.username}</td>
                    <td className="py-2.5">
                      <select className="field h-8 w-56 text-[12.5px]" value={u.role} disabled={u.id === user.id}
                        onChange={e => run(() => call('users.update', { id: u.id, role: e.target.value }), () => `${u.displayName} is now ${e.target.value}`)()}>
                        {(Object.keys(ROLE_LABEL) as Role[]).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    </td>
                    <td className="py-2.5">{u.active ? <Chip tone="good">Active</Chip> : <Chip>Deactivated</Chip>}</td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      {u.id !== user.id && <>
                        <Button size="sm" variant="ghost" onClick={() => { const p = prompt(`New password for ${u.displayName} (min 8 characters)`); if (p) run(() => call('users.update', { id: u.id, password: p }), () => 'Password reset')(); }}>Reset password</Button>
                        <Button size="sm" variant="ghost" onClick={run(() => call('users.update', { id: u.id, active: !u.active }), () => (u.active ? 'User deactivated' : 'User activated'))}>{u.active ? 'Deactivate' : 'Activate'}</Button>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[12px] text-ink-3">Clinicians enter data and see names/MRNs. Viewers see dashboards with pseudonymous IDs. Researchers see aggregate analytics and can export de-identified data only.</p>
          </div>
        )}

        <div className="card p-5">
          <CardHeader title="Your account" />
          <p className="text-[13px]">{user.displayName} <span className="text-ink-3">· {user.username} · {ROLE_LABEL[user.role]}</span></p>
          <Button size="sm" className="mt-3" onClick={() => setPw(true)}><KeyRound size={14} />Change password</Button>
        </div>
      </div>
      <AddUserModal open={addUser} onClose={() => setAddUser(false)} />
      <PasswordModal open={pw} onClose={() => setPw(false)} />
    </div>
  );
}

function UnitCard({ s }: { s: { unitName: string; beds: number } }) {
  const [f, setF] = useState({ unitName: s.unitName, beds: String(s.beds) });
  const toast = useToast();
  return (
    <div className="card p-5">
      <CardHeader title="Unit" />
      <div className="grid grid-cols-[1fr_110px] gap-3">
        <Field label="Unit name"><input className="field" value={f.unitName} onChange={e => setF({ ...f, unitName: e.target.value })} /></Field>
        <Field label="Beds" hint="Used for occupancy"><input className="field tnum" type="number" min={1} value={f.beds} onChange={e => setF({ ...f, beds: e.target.value })} /></Field>
      </div>
      <Button size="sm" className="mt-4" variant="primary" onClick={async () => { try { await call('settings.update', f); toast('Unit settings saved'); } catch (e: any) { toast(e.message, 'crit'); } }}>Save</Button>
    </div>
  );
}

function AddUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ displayName: '', username: '', role: 'clinician', password: '' });
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const save = async () => { try { await call('users.create', f); toast(`${f.displayName} added`); setF({ displayName: '', username: '', role: 'clinician', password: '' }); onClose(); } catch (e: any) { setErr(e.message); } };
  return (
    <Modal open={open} onClose={onClose} title="Add user" width={520} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Add user</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Name"><input className="field" value={f.displayName} onChange={e => setF({ ...f, displayName: e.target.value })} autoFocus /></Field>
        <Field label="Username"><input className="field" value={f.username} onChange={e => setF({ ...f, username: e.target.value })} /></Field>
        <Field label="Role"><select className="field" value={f.role} onChange={e => setF({ ...f, role: e.target.value })}>{(Object.keys(ROLE_LABEL) as Role[]).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
        <Field label="Temporary password" hint="At least 8 characters; ask them to change it."><input className="field" type="password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /></Field>
        <ErrorNote text={err} />
      </div>
    </Modal>
  );
}

function PasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setC] = useState(''); const [next, setN] = useState(''); const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const save = async () => { try { await call('auth.changePassword', { current, next }); toast('Password changed'); setC(''); setN(''); onClose(); } catch (e: any) { setErr(e.message); } };
  return (
    <Modal open={open} onClose={onClose} title="Change password" width={440} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Change</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Current password"><input className="field" type="password" value={current} onChange={e => setC(e.target.value)} /></Field>
        <Field label="New password"><input className="field" type="password" value={next} onChange={e => setN(e.target.value)} /></Field>
        <ErrorNote text={err} />
      </div>
    </Modal>
  );
}
