// Rounds & handover: one card per occupied bed with the last 24 h at a glance, and what changed
// since the last round. Prints one bed per page.
import { useState } from 'react';
import { motion } from 'motion/react';
import { CheckCheck, Droplets, FlaskConical, MonitorDot, Pill, Printer, ScrollText, Sparkles, TriangleAlert } from 'lucide-react';
import { call } from '@/lib/api';
import { go, useApi } from '@/lib/hooks';
import { cx, losLabel } from '@/lib/format';
import { Button, Chip, Empty, PageHeader, RespChip } from '@/components/ui';
import { MiniTrend } from '@/components/Labs';
import { DueChip, HandoverList, PewsChip } from '@/components/Bedside';
import { dxLabel } from '@shared/reference';
import { VITALS, type VitalCode } from '@shared/vitals';
import { fmtAge, nowLocal } from '@shared/time';
import type { LabFlag } from '@shared/labs';
import type { FluidSummary } from '@shared/fluids';
import type { CensusRow } from './types';

interface RoundRow extends CensusRow {
  vitals: { code: VitalCode; min: number; max: number; last: number; series: number[] }[];
  labs: { code: VitalCode; value: number; at: string; flag: LabFlag | null }[];
  fluids: FluidSummary | null;
  events: { at: string; label: string; type: string }[];
  pendingReadings: number;
  changes: string[];
  abxDays: { drug: string; day: number; intent: string | null }[];
}

const LAST_ROUND = 'antibiome-last-round';
const readLast = () => { try { return localStorage.getItem(LAST_ROUND); } catch { return null; } };
const fmtV = (c: VitalCode, v: number) => v.toFixed(VITALS[c].decimals);
const ago = (at: string) => { const h = (Date.now() - new Date(at).getTime()) / 3_600_000; return h < 1 ? `${Math.round(h * 60)} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} d ago`; };

export function Rounds({ canWrite = false }: { canWrite?: boolean }) {
  const [tab, setTab] = useState<'rounds' | 'handover'>('rounds');
  const [since, setSince] = useState<string | null>(readLast);
  const { data } = useApi<RoundRow[]>('rounds.list', since ? { since } : {});
  const markDone = () => { const t = nowLocal(); try { localStorage.setItem(LAST_ROUND, t); } catch { /* per-device convenience only */ } setSince(t); };
  if (!data) return null;
  const changed = data.filter(r => r.changes.length).length;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon={<ScrollText className="text-accent-ink" size={22} />} title="Rounds & handover"
        subtitle="Every occupied bed: the last 24 hours, current therapy, flagged results and what changed since your last round."
        chips={<>
          <Chip tone="accent">{data.length} patients</Chip>
          {since ? <Chip tone={changed ? 'warn' : 'good'} dot>{changed} changed since {since.slice(5).replace('T', ' ')}</Chip> : <Chip>No previous round on this device</Chip>}
          {data.some(r => r.pendingReadings) && <Chip tone="info" dot>{data.reduce((n, r) => n + r.pendingReadings, 0)} monitor readings to confirm</Chip>}
        </>}
        actions={<>
          <Button size="sm" variant="ghost" onClick={() => call('desktop.print')}><Printer size={15} />Print</Button>
          {tab === 'rounds' && <Button size="sm" variant="primary" onClick={markDone}><CheckCheck size={15} />Mark round done</Button>}
        </>} />
      <div className="no-print flex w-fit rounded-xl bg-panel-2 p-0.5 text-[13px]" role="tablist">
        {(['rounds', 'handover'] as const).map(x => <button key={x} role="tab" aria-selected={tab === x} onClick={() => setTab(x)} className={cx('rounded-lg px-4 py-1.5', tab === x ? 'bg-panel font-semibold shadow-sm' : 'text-ink-3')}>{x === 'rounds' ? 'Rounds' : 'Handover (SBAR)'}</button>)}
      </div>
      {!data.length && <Empty title="No patients in the unit" />}
      {tab === 'handover' ? <HandoverList canWrite={canWrite} /> : (
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
          {data.map((r, i) => <RoundCard key={r.admission.id} r={r} i={i} showChanges={!!since} />)}
        </div>
      )}
    </div>
  );
}

function RoundCard({ r, i, showChanges }: { r: RoundRow; i: number; showChanges: boolean }) {
  const a = r.admission;
  const labsFlagged = r.labs.filter(l => l.flag);
  const labsOther = r.labs.filter(l => !l.flag);
  return (
    <motion.article initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.03 }}
      className="card flex flex-col gap-4 p-5 break-inside-avoid print:break-after-page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <button onClick={() => go(`patient/${a.id}`)} className="flex min-w-0 items-start gap-3 text-left">
          <span className={cx('tnum grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-[16px] font-semibold', r.resp.level === 'MV' ? 'bg-crit-soft text-crit-ink' : 'bg-accent-soft text-accent-ink')}>{a.bed ?? '–'}</span>
          <span className="min-w-0">
            <span className="block truncate text-[16px] font-semibold">{dxLabel(a.primaryDx)}</span>
            <span className="block truncate text-[12.5px] text-ink-3">{r.name ?? r.label} · {fmtAge(a.ageMonths)}{a.weightKg ? ` · ${a.weightKg} kg` : ''} · day {Math.floor(r.losDays) + 1} ({losLabel(r.losDays)})</span>
          </span>
        </button>
        <div className="flex flex-wrap gap-1.5">
          <RespChip level={r.resp.level} />
          <PewsChip p={r.pews} />
          {r.vaso.map(v => <Chip key={v.id} tone="crit">{v.agent}</Chip>)}
          {r.abx.filter(x => x.due?.overdueMin).map(x => <DueChip key={x.id} due={x.due} />)}
          {r.issues > 0 && <Chip tone="warn"><TriangleAlert size={11} />{r.issues} data issue{r.issues > 1 ? 's' : ''}</Chip>}
        </div>
      </header>

      {showChanges && r.changes.length > 0 && (
        <div className="rounded-xl border border-warn/30 bg-warn-soft px-3 py-2">
          <p className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold tracking-wide text-warn-ink uppercase"><Sparkles size={12} />Since last round</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-[12.5px] text-ink">{r.changes.slice(0, 10).map((c, k) => <li key={k}>• {c}</li>)}</ul>
        </div>
      )}

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {r.vitals.map(v => (
          <div key={v.code} className="min-w-0 rounded-2xl bg-panel-2 px-3 py-2">
            <div className="flex items-center justify-between text-[11px] text-ink-3"><span>{VITALS[v.code].short}</span><span>{VITALS[v.code].unit}</span></div>
            <div className="flex items-end justify-between gap-1">
              <span className="tnum text-[20px] leading-tight font-semibold">{fmtV(v.code, v.last)}</span>
              <MiniTrend values={v.series} width={48} />
            </div>
            <div className="tnum text-[10.5px] text-ink-3">{fmtV(v.code, v.min)}–{fmtV(v.code, v.max)} · 24 h</div>
          </div>
        ))}
        {!r.vitals.length && <p className="col-span-full text-[12.5px] text-ink-3">No vital signs in the last 24 h.</p>}
      </section>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label icon={<Pill size={12} />}>Antimicrobials</Label>
          {r.abxDays.length ? <div className="flex flex-wrap gap-1.5">{r.abxDays.map(x => <Chip key={x.drug} tone="info">{x.drug} · day {x.day}{x.intent ? ` · ${x.intent}` : ''}</Chip>)}</div> : <span className="text-[12.5px] text-ink-3">None</span>}
          {(r.culturesSent > r.culturesResulted) && <span className="text-[12px] text-warn-ink">{r.culturesSent - r.culturesResulted} culture result{r.culturesSent - r.culturesResulted > 1 ? 's' : ''} pending</span>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label icon={<Droplets size={12} />}>Fluids · 24 h</Label>
          {r.fluids ? (
            <span className="tnum text-[13px]">
              <b>{r.fluids.balance > 0 ? '+' : ''}{Math.round(r.fluids.balance)} mL</b> <span className="text-ink-3">(in {Math.round(r.fluids.in)} / out {Math.round(r.fluids.out)})</span>
              {r.fluids.urineRate != null && <span className={cx('ml-2', r.fluids.oliguria ? 'font-semibold text-crit-ink' : 'text-ink-2')}>UO {r.fluids.urineRate} mL/kg/h</span>}
            </span>
          ) : <span className="text-[12.5px] text-ink-3">Not recorded</span>}
        </div>
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <Label icon={<FlaskConical size={12} />}>Results (last 72 h)</Label>
          {r.labs.length ? (
            <div className="flex flex-wrap gap-1.5">
              {labsFlagged.map(l => <Chip key={l.code} tone={l.flag!.length === 2 ? 'crit' : 'warn'}>{VITALS[l.code].short} {fmtV(l.code, l.value)} {l.flag}</Chip>)}
              {labsOther.map(l => <Chip key={l.code}>{VITALS[l.code].short} {fmtV(l.code, l.value)}</Chip>)}
            </div>
          ) : <span className="text-[12.5px] text-ink-3">None</span>}
        </div>
      </section>

      {(r.events.length > 0 || r.pendingReadings > 0) && (
        <footer className="flex flex-col gap-1 border-t border-line pt-3 text-[12.5px]">
          {r.pendingReadings > 0 && <span className="flex items-center gap-1.5 text-info-ink"><MonitorDot size={13} />{r.pendingReadings} monitor reading{r.pendingReadings > 1 ? 's' : ''} waiting to be confirmed</span>}
          {r.events.slice(0, 4).map((e, k) => <span key={k} className="text-ink-2">{e.label} <span className="text-ink-3">· {ago(e.at)}</span></span>)}
        </footer>
      )}
    </motion.article>
  );
}

const Label = ({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) => (
  <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{icon}{children}</span>
);
