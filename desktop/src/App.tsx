import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Activity, BedDouble, Biohazard, ClipboardCheck, FlaskRound, Layers, FileBarChart2, FlaskConical, Gauge, LayoutDashboard,
  ListChecks, Lock, LogOut, Moon, PanelLeftClose, PanelLeftOpen, Pill, Plus, Settings, ShieldCheck, Sun, UserRound, Wind,
} from 'lucide-react';
import { call } from '@/lib/api';
import { go, useApi, useHotkey, useRoute } from '@/lib/hooks';
import { cx, losLabel } from '@/lib/format';
import { Button, ErrorNote, Field, SegmentMeter, ToastProvider } from '@/components/ui';
import { CommandSearch, type CommandItem } from '@/vendor/watermelon/command-search';
import { dxLabel, RESP_LABEL } from '@shared/reference';
import { ROLE_LABEL, type User } from '@shared/types';
import { AdmitModal } from '@/pages/Admit';
import { Dashboard } from '@/pages/Dashboard';
import { Census } from '@/pages/Census';
import { PatientPage } from '@/pages/Patient';
import { Reconcile } from '@/pages/Reconcile';
import { Microbiology } from '@/pages/Microbiology';
import { Stewardship } from '@/pages/Stewardship';
import { Report } from '@/pages/Report';
import { Quality } from '@/pages/Quality';
import { ActivityPage } from '@/pages/ActivityPage';
import { SettingsPage } from '@/pages/Settings';
import { Research } from '@/pages/Research';
import { ModulesAdmin } from '@/pages/ModulesAdmin';
import type { CensusRow } from '@/pages/types';

export const Logo = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
    <circle cx="16" cy="16" r="13" fill="none" stroke="var(--accent)" strokeWidth="3" />
    <ellipse cx="16" cy="16" rx="15" ry="6" fill="none" stroke="var(--accent)" strokeWidth="2" transform="rotate(-28 16 16)" opacity="0.7" />
    <circle cx="16" cy="16" r="4.5" fill="var(--accent)" />
  </svg>
);

function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => { try { return (localStorage.getItem('antibiome-theme') as 'dark' | 'light') || 'dark'; } catch { return 'dark'; } });
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('antibiome-theme', theme); } catch { /* ignore */ } }, [theme]);
  return [theme, setTheme] as const;
}

export default function App() {
  const [status, setStatus] = useState<{ needsSetup: boolean; user: User | null; unitName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => call('auth.status').then(setStatus).catch(e => setError(e.message)), []);
  useEffect(() => { refresh(); const h = () => refresh(); window.addEventListener('antibiome:locked', h); return () => window.removeEventListener('antibiome:locked', h); }, [refresh]);

  if (error) return <div className="grid h-full place-items-center p-8"><ErrorNote text={error} /></div>;
  if (!status) return null;
  return (
    <ToastProvider>
      {status.needsSetup ? <Setup onDone={refresh} /> : !status.user ? <Login unitName={status.unitName} onDone={refresh} /> : <Shell user={status.user} onSignOut={refresh} />}
    </ToastProvider>
  );
}

// ── First run & sign-in ─────────────────────────────────────

function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center p-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card w-full max-w-[420px] p-8">
        <div className="mb-6 flex items-center gap-2.5"><Logo size={28} /><span className="text-[19px] font-semibold tracking-tight">Antibiome <span className="text-accent-ink">PICU</span></span></div>
        <h1 className="text-[20px] font-semibold">{title}</h1>
        <p className="mt-1 mb-6 text-[13px] text-ink-3">{subtitle}</p>
        {children}
        <p className="mt-6 flex items-center gap-1.5 text-[11.5px] text-ink-3"><ShieldCheck size={13} />Data stays on this computer in a local database.</p>
      </motion.div>
    </div>
  );
}

function Setup({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ displayName: '', username: '', password: '', unitName: 'PICU', beds: '12' });
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await call('auth.setup', f); onDone(); } catch (x: any) { setErr(x.message); }
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <AuthFrame title="Set up this unit" subtitle="Create the administrator account. You can add clinicians, viewers and researchers afterwards.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-[1fr_96px] gap-3">
          <Field label="Unit name"><input className="field" value={f.unitName} onChange={set('unitName')} /></Field>
          <Field label="Beds"><input className="field tnum" type="number" min={1} value={f.beds} onChange={set('beds')} /></Field>
        </div>
        <Field label="Your name"><input className="field" value={f.displayName} onChange={set('displayName')} placeholder="Dr A. Khan" autoFocus /></Field>
        <Field label="Username"><input className="field" value={f.username} onChange={set('username')} autoComplete="username" /></Field>
        <Field label="Password" hint="At least 8 characters."><input className="field" type="password" value={f.password} onChange={set('password')} autoComplete="new-password" /></Field>
        <ErrorNote text={err} />
        <Button variant="primary" type="submit">Create unit</Button>
      </form>
    </AuthFrame>
  );
}

function Login({ unitName, onDone }: { unitName: string; onDone: () => void }) {
  const [username, setU] = useState(''); const [password, setP] = useState(''); const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); try { await call('auth.login', { username, password }); onDone(); } catch (x: any) { setErr(x.message); } };
  return (
    <AuthFrame title={`Sign in to ${unitName}`} subtitle="The session locks after 15 minutes without activity.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Username"><input className="field" value={username} onChange={e => setU(e.target.value)} autoFocus autoComplete="username" /></Field>
        <Field label="Password"><input className="field" type="password" value={password} onChange={e => setP(e.target.value)} autoComplete="current-password" /></Field>
        <ErrorNote text={err} />
        <Button variant="primary" type="submit">Sign in</Button>
      </form>
    </AuthFrame>
  );
}

// ── Shell ───────────────────────────────────────────────────

const NAV = [
  { id: 'home', label: 'Command centre', icon: LayoutDashboard, roles: ['admin', 'clinician', 'viewer', 'researcher'] },
  { id: 'census', label: 'Census board', icon: BedDouble, roles: ['admin', 'clinician', 'viewer'], key: 'B' },
  { id: 'reconcile', label: 'Daily reconcile', icon: ListChecks, roles: ['admin', 'clinician'], key: 'R' },
  { id: 'micro', label: 'Microbiology', icon: FlaskConical, roles: ['admin', 'clinician', 'viewer', 'researcher'] },
  { id: 'stewardship', label: 'Stewardship', icon: Pill, roles: ['admin', 'clinician', 'viewer', 'researcher'] },
  { id: 'report', label: 'Monthly report', icon: FileBarChart2, roles: ['admin', 'clinician', 'viewer', 'researcher'] },
  { id: 'research', label: 'Research', icon: FlaskRound, roles: ['admin', 'clinician', 'viewer', 'researcher'] },
  { id: 'modules', label: 'Modules & fields', icon: Layers, roles: ['admin', 'clinician', 'viewer'] },
  { id: 'quality', label: 'Data quality', icon: ClipboardCheck, roles: ['admin', 'clinician', 'viewer'] },
  { id: 'activity', label: 'Activity', icon: Activity, roles: ['admin', 'clinician', 'viewer'] },
] as const;

function Shell({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [route, args] = useRoute();
  const [theme, setTheme] = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [admitOpen, setAdmitOpen] = useState(false);
  const clinical = user.role === 'admin' || user.role === 'clinician';
  const canCensus = user.role !== 'researcher';
  const census = useApi<{ rows: CensusRow[]; beds: number }>(canCensus ? 'census.list' : null);
  const recent = useApi<{ id: string; label: string; dx: string; disposition: string }[]>(canCensus ? 'recent.list' : null);
  const dash = useApi<any>('dashboard.get');
  const completeness = dash.data?.current?.completeness?.pct ?? null;

  const signOut = useCallback(async () => { await call('auth.logout').catch(() => {}); onSignOut(); }, [onSignOut]);
  useHotkey('a', () => clinical && setAdmitOpen(true));
  useHotkey('b', () => canCensus && go('census'));
  useHotkey('r', () => clinical && go('reconcile'));
  useHotkey('l', signOut, { ctrl: true });

  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];
    if (clinical) {
      items.push({ id: 'admit', title: 'Admit a patient', section: 'Actions', icon: <Plus size={15} />, shortcut: 'A', keywords: 'new admission', action: () => setAdmitOpen(true) });
      items.push({ id: 'rec', title: 'Daily reconcile', section: 'Actions', icon: <ListChecks size={15} />, shortcut: 'R', keywords: 'ventilator oxygen antibiotics grid', action: () => go('reconcile') });
      items.push({ id: 'cult', title: 'Add culture result', section: 'Actions', icon: <FlaskConical size={15} />, keywords: 'microbiology organism susceptibility', action: () => go('micro/new') });
    }
    NAV.filter(n => (n.roles as readonly string[]).includes(user.role)).forEach(n => items.push({ id: `nav-${n.id}`, title: n.label, section: 'Go to', icon: <n.icon size={15} />, action: () => go(n.id) }));
    if (user.role === 'admin') items.push({ id: 'nav-settings', title: 'Settings & users', section: 'Go to', icon: <Settings size={15} />, action: () => go('settings') });
    items.push({ id: 'theme', title: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`, section: 'Preferences', icon: theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />, action: () => setTheme(theme === 'dark' ? 'light' : 'dark') });
    items.push({ id: 'lock', title: 'Lock / sign out', section: 'Preferences', icon: <Lock size={15} />, shortcut: 'Ctrl L', action: signOut });
    (census.data?.rows ?? []).forEach(r => items.push({
      id: `pt-${r.admission.id}`, section: 'Patients', icon: <BedDouble size={15} />,
      title: `${r.admission.bed ? `Bed ${r.admission.bed} · ` : ''}${r.name ?? r.label}`,
      hint: `${dxLabel(r.admission.primaryDx)} · ${RESP_LABEL[r.resp.level]}`,
      keywords: `${r.mrn ?? ''} ${r.label}`, action: () => go(`patient/${r.admission.id}`),
    }));
    return items;
  }, [clinical, user.role, theme, setTheme, signOut, census.data]);

  const page = (() => {
    switch (route) {
      case 'census': return <Census onAdmit={() => setAdmitOpen(true)} canEdit={clinical} />;
      case 'patient': return <PatientPage id={args[0]} canEdit={clinical} isAdmin={user.role === 'admin'} />;
      case 'reconcile': return <Reconcile canEdit={clinical} />;
      case 'micro': return <Microbiology canEdit={clinical} openNew={args[0] === 'new'} />;
      case 'stewardship': return <Stewardship />;
      case 'report': return <Report />;
      case 'quality': return <Quality />;
      case 'activity': return <ActivityPage />;
      case 'settings': return <SettingsPage user={user} />;
      case 'research': return <Research key={args[0] ?? ''} canExport={user.role === 'admin' || user.role === 'researcher'} initialModule={args[0]} />;
      case 'modules': return <ModulesAdmin isAdmin={user.role === 'admin'} />;
      default: return <Dashboard user={user} onAdmit={() => setAdmitOpen(true)} />;
    }
  })();

  const rows = census.data?.rows ?? [];
  return (
    <div className="flex h-full gap-3 p-3">
      {/* Sidebar */}
      <aside className={cx('no-print card scroll-thin flex shrink-0 flex-col overflow-x-hidden overflow-y-auto transition-all duration-300', collapsed ? 'w-[68px] p-2.5' : 'w-[268px] p-4')}>
        <div className={cx('mb-5 flex items-center', collapsed ? 'flex-col gap-3' : 'justify-between')}>
          <button onClick={() => go('home')} className="flex items-center gap-2"><Logo />{!collapsed && <span className="text-[17px] font-semibold tracking-tight">Antibiome</span>}</button>
          <button onClick={() => setCollapsed(!collapsed)} className="rounded-lg p-1.5 text-ink-3 hover:bg-panel-2 hover:text-ink" title="Collapse sidebar">
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>

        {clinical && (
          <div className="mb-4 flex flex-col gap-1">
            <SideItem icon={Plus} label="New admission" hint="A" onClick={() => setAdmitOpen(true)} collapsed={collapsed} />
            <SideItem icon={Wind} label="Daily reconcile" hint="R" onClick={() => go('reconcile')} collapsed={collapsed} active={route === 'reconcile'} />
            <SideItem icon={Biohazard} label="Add culture" onClick={() => go('micro/new')} collapsed={collapsed} />
          </div>
        )}
        <div className="mb-4 border-t border-line" />
        <nav className="flex flex-col gap-1">
          {NAV.filter(n => n.id !== 'reconcile' && (n.roles as readonly string[]).includes(user.role)).map(n => (
            <SideItem key={n.id} icon={n.icon} label={n.label} onClick={() => go(n.id)} collapsed={collapsed}
              active={route === n.id || (n.id === 'census' && route === 'patient') || (n.id === 'home' && !NAV.some(x => x.id === route) && !['patient', 'settings'].includes(route))}
              badge={n.id === 'quality' && dash.data?.quality.issues ? dash.data.quality.issues : undefined} />
          ))}
        </nav>

        {!collapsed && canCensus && (
          <>
            <SectionLabel>In the unit · {rows.length}</SectionLabel>
            <div className="flex flex-col gap-0.5">
              {rows.slice(0, 9).map(r => (
                <button key={r.admission.id} onClick={() => go(`patient/${r.admission.id}`)}
                  className={cx('group flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left hover:bg-panel-2', route === 'patient' && args[0] === r.admission.id && 'bg-panel-2')}>
                  <span className="tnum grid h-6 w-6 shrink-0 place-items-center rounded-md bg-panel-3 text-[10.5px] font-semibold text-ink-2">{r.admission.bed ?? '–'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">{dxLabel(r.admission.primaryDx)}</span>
                    <span className="block truncate text-[11px] text-ink-3">{r.name ?? r.label} · {losLabel(r.losDays)}</span>
                  </span>
                  {r.resp.level === 'MV' && <span className="h-2 w-2 shrink-0 rounded-full bg-crit" title="Ventilated" />}
                  {r.vaso.length > 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" title="On vasoactives" />}
                </button>
              ))}
              {rows.length > 9 && <button onClick={() => go('census')} className="px-2.5 py-1 text-left text-[12px] text-ink-3 hover:text-ink">+ {rows.length - 9} more on the census board</button>}
              {!rows.length && <p className="px-2.5 text-[12px] text-ink-3">No patients admitted.</p>}
            </div>
            {!!recent.data?.length && (
              <>
                <SectionLabel>Recently discharged</SectionLabel>
                <div className="flex flex-col gap-0.5">
                  {recent.data.slice(0, 4).map(r => (
                    <button key={r.id} onClick={() => go(`patient/${r.id}`)} className="flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left hover:bg-panel-2">
                      <UserRound size={14} className="shrink-0 text-ink-3" />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{r.dx}</span>
                      <span className={cx('text-[11px]', r.disposition === 'Died' ? 'text-crit-ink' : 'text-ink-3')}>{r.disposition}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        <div className="mt-auto pt-5">
          {!collapsed && completeness != null && (
            <div className="inset mb-3 p-3.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-[13px] font-medium"><Gauge size={15} className="text-ink-3" />Data completeness</span>
                <span className="flex items-center gap-2"><SegmentMeter pct={completeness} tone={completeness >= 90 ? 'good' : completeness >= 75 ? 'warn' : 'crit'} /><span className="tnum text-[12px] font-semibold">{completeness}%</span></span>
              </div>
              <p className="mt-1.5 text-[11.5px] text-ink-3">This month's admissions. <button className="underline hover:text-ink" onClick={() => go('quality')}>Review gaps</button></p>
            </div>
          )}
          <div className={cx('flex items-center gap-2.5 rounded-2xl border border-line p-2.5', collapsed && 'flex-col')}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent-ink">
              {user.displayName.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}
            </span>
            {!collapsed && (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{user.displayName}</span>
                <span className="block truncate text-[11px] text-ink-3">{ROLE_LABEL[user.role]}</span>
              </span>
            )}
            <div className={cx('flex', collapsed ? 'flex-col' : '')}>
              <IconBtn title={theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}</IconBtn>
              {user.role === 'admin' && <IconBtn title="Settings" onClick={() => go('settings')}><Settings size={15} /></IconBtn>}
              <IconBtn title="Lock (Ctrl+L)" onClick={signOut}><LogOut size={15} /></IconBtn>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="card print-area relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="no-print flex items-center justify-between gap-4 border-b border-line px-7 py-3.5">
          <CommandSearch items={commands} open={paletteOpen} onOpenChange={setPaletteOpen} />
          <div className="flex items-center gap-3 text-[12px] text-ink-3">
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-good" />Local database</span>
            <span className="hidden xl:inline">{new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
          </div>
        </header>
        <div className="scroll-thin flex-1 overflow-y-auto px-7 pt-6 pb-28">{page}</div>
        {clinical && (
          <motion.button initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} onClick={() => setPaletteOpen(true)}
            className="no-print absolute right-7 bottom-5 flex h-12 w-[min(520px,60%)] items-center gap-3 rounded-full border border-line-2 bg-panel/95 pr-4 pl-1.5 text-left text-[13.5px] text-ink-3 shadow-[0_20px_40px_-20px_rgba(0,0,0,0.6)] backdrop-blur hover:text-ink-2">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-panel-3 text-ink"><Plus size={17} /></span>
            Admit a patient, find a bed, or record a change…
            <span className="kbd ml-auto">Ctrl K</span>
          </motion.button>
        )}
      </main>

      <AdmitModal open={admitOpen} onClose={() => setAdmitOpen(false)} />
    </div>
  );
}

function SideItem({ icon: Icon, label, onClick, active, collapsed, hint, badge }: { icon: any; label: string; onClick: () => void; active?: boolean; collapsed?: boolean; hint?: string; badge?: number }) {
  return (
    <button onClick={onClick} title={collapsed ? label : undefined}
      className={cx('relative flex items-center gap-3 rounded-xl text-[13.5px] transition', collapsed ? 'h-10 justify-center' : 'h-9 px-2.5',
        active ? 'bg-panel-3 text-ink font-medium' : 'text-ink-2 hover:bg-panel-2 hover:text-ink')}>
      <Icon size={17} className={active ? 'text-accent-ink' : 'text-ink-3'} />
      {!collapsed && <span className="flex-1 text-left">{label}</span>}
      {!collapsed && hint && <span className="kbd">{hint}</span>}
      {!!badge && <span className={cx('tnum rounded-full bg-warn-soft px-1.5 text-[10.5px] font-semibold text-warn-ink', collapsed && 'absolute -top-1 -right-1')}>{badge}</span>}
    </button>
  );
}
const SectionLabel = ({ children }: { children: React.ReactNode }) => <div className="mt-5 mb-2 flex items-center justify-between px-2.5 text-[12.5px] font-semibold text-ink-2">{children}</div>;
const IconBtn = ({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) => (
  <button title={title} onClick={onClick} className="rounded-lg p-1.5 text-ink-3 hover:bg-panel-2 hover:text-ink">{children}</button>
);

