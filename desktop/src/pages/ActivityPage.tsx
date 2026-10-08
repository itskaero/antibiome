// Activity — the append-only audit trail, laid out after the "Activity" reference:
// a year/month rail on the left, day-grouped cards on the right.
import { useMemo, useRef } from 'react';
import { Activity, DoorOpen, Download, FlaskConical, HeartPulse, KeyRound, LogIn, Pencil, Pill, Plus, Shield, Trash2, Wind } from 'lucide-react';
import { call } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { cx } from '@/lib/format';
import { Button, Chip, Empty, PageHeader, useToast } from '@/components/ui';
import { parse } from '@shared/time';

interface Row { id: number; at: string; username: string | null; action: string; entity: string; summary: string }

const ICON: Record<string, [React.ReactNode, string]> = {
  admit: [<LogIn size={14} />, 'text-accent-ink'], discharge: [<DoorOpen size={14} />, 'text-good-ink'], start: [<Pill size={14} />, 'text-info-ink'],
  stop: [<Pill size={14} />, 'text-ink-3'], update: [<Pencil size={14} />, 'text-ink-2'], delete: [<Trash2 size={14} />, 'text-crit-ink'],
  add: [<Plus size={14} />, 'text-info-ink'], login: [<KeyRound size={14} />, 'text-ink-3'], logout: [<KeyRound size={14} />, 'text-ink-3'],
  'login-failed': [<Shield size={14} />, 'text-crit-ink'], lock: [<Shield size={14} />, 'text-warn-ink'], export: [<Download size={14} />, 'text-warn-ink'],
  view: [<Activity size={14} />, 'text-ink-3'], reconcile: [<Wind size={14} />, 'text-accent-ink'], import: [<FlaskConical size={14} />, 'text-info-ink'],
};
const iconFor = (r: Row) => (r.entity === 'respiratory' ? [<Wind size={14} />, 'text-info-ink'] : r.entity === 'vasoactive' ? [<HeartPulse size={14} />, 'text-accent-ink'] : ICON[r.action] ?? [<Activity size={14} />, 'text-ink-3']) as [React.ReactNode, string];

export function ActivityPage() {
  const { data } = useApi<Row[]>('activity.list', { limit: 500 });
  const me = useApi<{ user: { role: string } }>('auth.status');
  const toast = useToast();
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const days = useMemo(() => {
    const g: { day: string; rows: Row[] }[] = [];
    (data ?? []).forEach(r => { const d = r.at.slice(0, 10); if (g[g.length - 1]?.day !== d) g.push({ day: d, rows: [] }); g[g.length - 1].rows.push(r); });
    return g;
  }, [data]);
  const rail = useMemo(() => {
    const years: Record<string, string[]> = {};
    days.forEach(d => { const y = d.day.slice(0, 4), m = d.day.slice(0, 7); (years[y] ??= []).includes(m) || years[y].push(m); });
    return Object.entries(years);
  }, [days]);
  const today = new Date().toISOString().slice(0, 10);

  const exportCsv = async () => {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = ['time,user,action,entity,summary', ...(data ?? []).map(r => [r.at, r.username ?? '', r.action, r.entity, r.summary].map(x => esc(String(x))).join(','))].join('\n');
    try { const p = await call('desktop.saveCsv', { csv, name: 'antibiome-activity.csv' }); if (p) toast('Activity exported'); } catch (e: any) { toast(e.message, 'crit'); }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon={<Activity className="text-accent-ink" size={22} />} title="Activity"
        subtitle="Every admission, therapy change, culture, export and sign-in — append-only, cannot be edited or deleted."
        chips={<Chip>{data?.length ?? 0} most recent entries</Chip>}
        actions={me.data?.user?.role === 'admin' && <Button size="sm" variant="subtle" onClick={exportCsv}>Export CSV</Button>} />
      {!days.length ? <div className="card"><Empty title="No activity yet" /></div> : (
        <div className="grid grid-cols-[96px_1fr] gap-6">
          <nav className="sticky top-0 flex h-fit flex-col gap-4 pt-2">
            {rail.map(([y, months]) => (
              <div key={y}>
                <p className="mb-1.5 text-[12.5px] font-semibold">{y}</p>
                {months.map(m => (
                  <button key={m} onClick={() => refs.current[m]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    className="flex w-full items-center gap-2 py-0.5 text-[12px] text-ink-3 hover:text-ink">
                    {parse(`${m}-01`).toLocaleDateString('en-GB', { month: 'short' })}
                    <span className="h-px flex-1 bg-line-2" />
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="flex max-w-[860px] flex-col gap-3">
            {days.map((d, i) => (
              <div key={d.day} ref={el => { if (!days[i - 1] || days[i - 1].day.slice(0, 7) !== d.day.slice(0, 7)) refs.current[d.day.slice(0, 7)] = el; }}
                className="rounded-2xl border border-line bg-panel-2/50">
                <div className="px-4 py-2.5 text-[12px] font-medium text-ink-2">
                  {d.day === today ? 'Today · ' : ''}{parse(d.day).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
                <div className="mx-1.5 mb-1.5 rounded-xl bg-panel">
                  {d.rows.map(r => {
                    const [icon, tone] = iconFor(r);
                    return (
                      <div key={r.id} className="flex items-center gap-3 border-b border-line px-3 py-2.5 text-[13px] last:border-0">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-panel-3 text-[10px] font-semibold text-ink-2">
                          {(r.username ?? 'S').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1 truncate"><b className="font-semibold">{r.username ?? 'System'}</b> <span className="text-ink-3">{r.action.replace('-', ' ')}</span> <span className="text-ink-2">{r.summary}</span></span>
                        <span className="tnum shrink-0 text-[11.5px] text-ink-3">{r.at.slice(11, 16)}</span>
                        <span className={cx('shrink-0', tone)}>{icon}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
