// Phone shell — bedside work only, over the hospital Wi-Fi. Research, exports, AI, settings and
// configuration stay on the PICU PC (the server enforces this too).
import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, BedDouble, FlaskConical, HeartPulse, LayoutDashboard, LogOut, Moon, Pill, Plus, ShieldCheck, Smartphone, Sun, UserRound } from 'lucide-react';
import { call, forgetDevice, getDevice, openEvents, pairDevice } from '@/lib/api';
import { go, useApi, useRoute } from '@/lib/hooks';
import { cx, fmt1, fmtPct, losLabel } from '@/lib/format';
import { Button, Chip, Empty, ErrorNote, Field, RespChip, RespSegment, useToast } from '@/components/ui';
import { AdmitModal } from '@/pages/Admit';
import { PatientPage } from '@/pages/Patient';
import { dxLabel, RESP_LABEL, type RespLevel } from '@shared/reference';
import { fmtAge } from '@shared/time';
import { ROLE_LABEL, type User } from '@shared/types';
import type { CensusRow } from '@/pages/types';

// ── Pairing (first visit from the QR code) ───────────────────

export function PairScreen({ onDone, Frame }: { onDone: () => void; Frame: React.FC<{ title: string; subtitle: string; children: React.ReactNode }> }) {
  const fromLink = window.location.hash.match(/^#\/pair\/([A-Za-z0-9-]+)/)?.[1] ?? '';
  const [code, setCode] = useState(fromLink);
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await pairDevice(code, name); window.location.hash = '/census'; onDone(); } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Frame title="Pair this phone" subtitle="Scan the QR code shown on the PICU PC (Settings → Phone access), or type its code. Pairing is done once per phone.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Pairing code"><input className="field tnum h-11 text-[16px] tracking-[0.2em] uppercase" value={code} onChange={e => setCode(e.target.value)} placeholder="XXXX-XXXX" autoCapitalize="characters" autoComplete="off" /></Field>
        <Field label="Name for this phone" hint="Shown in the audit trail, e.g. “Dr Khan's phone”."><input className="field h-11 text-[16px]" value={name} onChange={e => setName(e.target.value)} autoFocus={!!fromLink} /></Field>
        <ErrorNote text={err} />
        <Button variant="primary" type="submit" disabled={busy || code.length < 8 || name.trim().length < 2}>Pair phone</Button>
      </form>
      <ul className="mt-5 flex flex-col gap-1.5 text-[12px] text-ink-3">
        <li>• You still sign in with your own account every time.</li>
        <li>• Nothing about patients is stored on the phone; it locks after 5 minutes.</li>
        <li>• An administrator can unpair this phone at any time.</li>
      </ul>
    </Frame>
  );
}

// ── Shell ────────────────────────────────────────────────────

const TABS = [
  { id: 'census', label: 'Census', icon: BedDouble },
  { id: 'admit', label: 'Admit', icon: Plus, clinical: true },
  { id: 'summary', label: 'Summary', icon: LayoutDashboard },
  { id: 'me', label: 'Me', icon: UserRound },
] as const;

export function MobileShell({ user, unitName, theme, setTheme, onSignOut }: { user: User; unitName: string; theme: string; setTheme: (t: 'dark' | 'light') => void; onSignOut: () => void }) {
  const [route, args] = useRoute();
  const [admitOpen, setAdmitOpen] = useState(false);
  const clinical = user.role === 'admin' || user.role === 'clinician';
  useEffect(() => { openEvents(); }, []);
  const active = route === 'patient' ? 'census' : TABS.some(t => t.id === route) ? route : 'census';

  const page = route === 'patient' ? <PatientPage id={args[0]} canEdit={clinical} isAdmin={false} />
    : route === 'summary' ? <MobileSummary />
    : route === 'me' ? <MeTab user={user} theme={theme} setTheme={setTheme} onSignOut={onSignOut} />
    : <MobileCensus canEdit={clinical} onAdmit={() => setAdmitOpen(true)} />;

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-line bg-panel px-4 pt-[max(env(safe-area-inset-top),10px)] pb-2.5">
        <span className="flex items-center gap-2 text-[15px] font-semibold"><Smartphone size={16} className="text-accent-ink" />{unitName}</span>
        <span className="flex items-center gap-1.5 text-[11.5px] text-ink-3"><span className="h-1.5 w-1.5 rounded-full bg-good" />Connected to PICU PC</span>
      </header>
      <main className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3.5 pt-4 pb-6">{page}</main>
      <nav className="grid shrink-0 grid-cols-4 border-t border-line bg-panel pb-[env(safe-area-inset-bottom)]" aria-label="Main">
        {TABS.filter(t => !('clinical' in t) || clinical).map(t => (
          <button key={t.id} onClick={() => (t.id === 'admit' ? setAdmitOpen(true) : go(t.id))}
            className={cx('flex flex-col items-center gap-0.5 py-2.5 text-[11px]', active === t.id ? 'text-accent-ink' : 'text-ink-3')}>
            <t.icon size={20} />{t.label}
          </button>
        ))}
      </nav>
      <AdmitModal open={admitOpen} onClose={() => setAdmitOpen(false)} />
    </div>
  );
}

// ── Census: one card per bed, one-tap support change ──────────

function MobileCensus({ canEdit, onAdmit }: { canEdit: boolean; onAdmit: () => void }) {
  const { data } = useApi<{ rows: CensusRow[]; beds: number; showIdentifiers: boolean }>('census.list');
  const toast = useToast();
  if (!data) return null;
  const setResp = async (r: CensusRow, level: RespLevel) => {
    if (level === r.resp.level || !confirm(`Bed ${r.admission.bed ?? '—'}: change ${RESP_LABEL[r.resp.level]} → ${RESP_LABEL[level]}?`)) return;
    try { await call('resp.set', { admissionId: r.admission.id, level }); toast(`${RESP_LABEL[r.resp.level]} → ${RESP_LABEL[level]}`); } catch (e: any) { toast(e.message, 'crit'); }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">Census</h1>
          <p className="text-[12px] text-ink-3">{data.rows.length} of {data.beds} beds · {data.rows.filter(r => r.resp.level === 'MV').length} ventilated</p>
        </div>
        {canEdit && <Button variant="primary" onClick={onAdmit}><Plus size={15} />Admit</Button>}
      </div>
      {!data.showIdentifiers && <p className="flex items-center gap-1.5 text-[11.5px] text-ink-3"><ShieldCheck size={13} />Names are hidden on phones.</p>}
      {data.rows.map((r, i) => {
        const a = r.admission;
        const critical = r.resp.level === 'MV' || r.vaso.length > 0;
        return (
          <motion.div key={a.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * 0.02 }}
            className={cx('card p-3.5', critical && 'ring-1 ring-crit/25')}>
            <button className="flex w-full items-start gap-3 text-left" onClick={() => go(`patient/${a.id}`)}>
              <span className={cx('tnum grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[14px] font-semibold', critical ? 'bg-crit-soft text-crit-ink' : 'bg-panel-3 text-ink-2')}>{a.bed ?? '–'}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">{dxLabel(a.primaryDx)}</span>
                <span className="block truncate text-[12px] text-ink-3">{r.name ?? r.label} · {fmtAge(a.ageMonths)} · {a.sex} · {losLabel(r.losDays)}</span>
              </span>
              {r.issues > 0 && <AlertTriangle size={15} className="mt-1 shrink-0 text-warn-ink" />}
              {r.culturesSent > r.culturesResulted && <FlaskConical size={15} className="mt-1 shrink-0 text-info-ink" />}
            </button>
            {(r.vaso.length > 0 || r.abx.length > 0) && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {r.vaso.map(v => <Chip key={v.id} tone="accent"><HeartPulse size={11} />{v.agent}</Chip>)}
                {r.abx.map(x => <Chip key={x.id}><Pill size={11} />{x.drug}</Chip>)}
              </div>
            )}
            <div className="mt-3">{canEdit ? <RespSegment value={r.resp.level} onChange={l => setResp(r, l)} /> : <RespChip level={r.resp.level} />}</div>
          </motion.div>
        );
      })}
      {!data.rows.length && <Empty icon={<BedDouble size={18} />} title="No patients in the unit" />}
    </div>
  );
}

// ── Summary: read-only snapshot of the command centre ─────────

function MobileSummary() {
  const { data: d } = useApi<any>('dashboard.get');
  if (!d) return null;
  const c = d.current;
  const tiles: [string, string, string?][] = [
    ['In the unit', `${d.census.now} / ${d.census.beds}`, `${d.census.ventilatedNow} ventilated · ${d.census.vasoNow} on vasoactives`],
    ['Admissions this month', String(c.admissions), `${c.emergency} emergency`],
    ['Mortality', fmtPct(c.mortalityPct, 1), d.smr12 ? `12-month SMR ${d.smr12.smr.toFixed(2)} (95% CI ${d.smr12.lo.toFixed(2)}–${d.smr12.hi.toFixed(2)})` : `${c.deaths} of ${c.discharges} discharges`],
    ['Median stay', c.los ? `${fmt1(c.los.median)} d` : '—', c.los ? `IQR ${fmt1(c.los.q1)}–${fmt1(c.los.q3)} d` : undefined],
    ['Antimicrobial use', c.dot.per1000 != null ? `${Math.round(c.dot.per1000)}` : '—', 'DOT per 1,000 patient-days'],
    ['Cultures', `${c.micro.positives} / ${c.micro.cultures}`, `positive · ${c.micro.mdr} MDR`],
    ['Data completeness', `${c.completeness.pct}%`, 'this month'],
  ];
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight">Unit summary</h1>
        <p className="text-[12px] text-ink-3">Read-only. Charts, research and reports are on the PICU PC.</p>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {tiles.map(([label, value, sub]) => (
          <div key={label} className="card p-3.5">
            <p className="text-[11.5px] text-ink-3">{label}</p>
            <p className="tnum mt-0.5 text-[22px] font-semibold">{value}</p>
            {sub && <p className="mt-0.5 text-[11px] leading-snug text-ink-3">{sub}</p>}
          </div>
        ))}
      </div>
      {!!d.changes?.notices?.length && (
        <div className="card p-3.5">
          <p className="mb-1.5 text-[12.5px] font-semibold">Antibiome noticed</p>
          {d.changes.notices.slice(0, 4).map((n: any) => <p key={n.id} className="py-0.5 text-[12.5px] text-ink-2">• {n.title}</p>)}
          <p className="mt-1.5 text-[11px] text-ink-3">Associations, not causes.</p>
        </div>
      )}
    </div>
  );
}

function MeTab({ user, theme, setTheme, onSignOut }: { user: User; theme: string; setTheme: (t: 'dark' | 'light') => void; onSignOut: () => void }) {
  const dev = getDevice();
  const signOut = async () => { await call('auth.logout').catch(() => {}); onSignOut(); };
  return (
    <div className="flex flex-col gap-3">
      <div className="card flex items-center gap-3 p-4">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-accent-soft text-[14px] font-semibold text-accent-ink">{user.displayName.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}</span>
        <span><span className="block text-[15px] font-semibold">{user.displayName}</span><span className="block text-[12px] text-ink-3">{ROLE_LABEL[user.role]}</span></span>
      </div>
      <div className="card flex flex-col gap-2 p-4 text-[13px]">
        <p className="flex items-center gap-2"><Smartphone size={15} className="text-ink-3" />This phone: <b>{dev?.name}</b></p>
        <p className="text-[12px] text-ink-3">Locks after 5 minutes without activity. Closing the tab signs you out. Nothing about patients is stored on the phone.</p>
      </div>
      <Button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}{theme === 'dark' ? 'Light theme' : 'Dark theme'}</Button>
      <Button variant="primary" onClick={signOut}><LogOut size={15} />Sign out</Button>
      <button className="mt-2 text-[12px] text-ink-3 underline" onClick={() => { if (confirm('Unpair this phone? You will need a new code from the PC to use it again.')) { call('auth.unpairDevice').catch(() => {}).finally(() => { forgetDevice(); location.reload(); }); } }}>Unpair this phone</button>
    </div>
  );
}
