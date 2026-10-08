import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowDownRight, ArrowUpRight, BedDouble, CalendarClock, Database, FileUp, HeartPulse, Info, LineChart, Plus, Sparkles, Target, Wind } from 'lucide-react';
import { useApi, go } from '@/lib/hooks';
import { call } from '@/lib/api';
import { cx, delta, fmt1, fmtInt, fmtPct } from '@/lib/format';
import { Button, CardHeader, Chip, Empty, PageHeader, useToast } from '@/components/ui';
import { Columns, CompareArea, HBars, Legend, Sparkline, StackBar, TrendLine } from '@/components/charts';
import SpotlightCard from '@/vendor/reactbits/SpotlightCard';
import CountUp from '@/vendor/reactbits/CountUp';
import { ContinuousTabs } from '@/vendor/watermelon/continuous-tabs';
import { DX_BY_CODE, RESP_LABEL } from '@shared/reference';
import { fmtMonth, shiftMonth, toLocal } from '@shared/time';
import type { User } from '@shared/types';
import type { MonthSummary, Notice, SeriesPoint } from '@shared/analytics';

interface Dash {
  month: string; current: MonthSummary; previous: MonthSummary; projection: number | null;
  census: { now: number; beds: number; ventilatedNow: number; vasoNow: number; abxNow: number };
  censusSeries: { current: (number | null)[]; previous: (number | null)[] };
  series: SeriesPoint[]; changes: { notices: Notice[]; noise: Notice[]; prevMonth: string };
  quality: { issues: number }; unitName: string; hasData: boolean;
}

export function Dashboard({ user, onAdmit }: { user: User; onAdmit: () => void }) {
  const thisMonth = toLocal(new Date()).slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const { data: d } = useApi<Dash>('dashboard.get', { month });
  const info = useApi<{ demo: boolean }>('desktop.info');
  const [showNoise, setShowNoise] = useState(false);
  const [dxCat, setDxCat] = useState('All');

  const censusData = useMemo(() => {
    if (!d) return [];
    const n = Math.max(d.censusSeries.current.length, d.censusSeries.previous.length);
    return Array.from({ length: n }, (_, i) => ({ x: String(i + 1), current: d.censusSeries.current[i] ?? null, previous: d.censusSeries.previous[i] ?? null }));
  }, [d]);

  if (!d) return <div className="h-96" />;
  if (!d.hasData) return <Welcome user={user} onAdmit={onAdmit} />;

  const c = d.current, p = d.previous;
  const isCurrent = month === thisMonth;
  const occupancy = d.census.beds ? (d.census.now / d.census.beds) * 100 : 0;
  const dxCats = ['All', ...new Set(c.topDx.map(x => DX_BY_CODE[x.code]?.category ?? 'Other'))].slice(0, 5);
  const dxRows = c.topDx.filter(x => dxCat === 'All' || (DX_BY_CODE[x.code]?.category ?? 'Other') === dxCat).slice(0, 8);
  const topDrugs = Object.entries(c.dot.byDrug).sort((a, b) => b[1] - a[1]).slice(0, 7);
  const topOrgs = Object.entries(c.micro.organisms).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        icon={<span className="text-[22px]">🫀</span>}
        title={`${d.unitName} intelligence`}
        subtitle="What is happening in the unit — admissions, severity, treatment, microbiology and outcomes."
        chips={<>
          <Chip tone="accent" dot>{isCurrent ? 'Live' : 'Closed month'}</Chip>
          <Chip><Database size={12} />Local database</Chip>
          <Chip><CalendarClock size={12} />Morning census 08:00</Chip>
          {info.data?.demo && <Chip tone="warn">Synthetic demo data</Chip>}
        </>}
        actions={
          <select className="field h-9 w-60" value={month} onChange={e => setMonth(e.target.value)} aria-label="Month">
            {Array.from({ length: 13 }, (_, i) => shiftMonth(thisMonth, -i)).map(m => <option key={m} value={m}>{fmtMonth(m, true)}{m === thisMonth ? ' (to date)' : ''}</option>)}
          </select>
        }
      />

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
        <Tile label="In the unit now" value={d.census.now} suffix={` / ${d.census.beds}`} onClick={() => go('census')}
          foot={<div className="mt-3"><div className="h-1.5 overflow-hidden rounded-full bg-panel-3"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, occupancy)}%` }} /></div>
            <p className="mt-2 text-[12px] text-ink-3">{fmtPct(occupancy)} occupied · {d.census.ventilatedNow} ventilated · {d.census.vasoNow} on vasoactives</p></div>} />
        <Tile label={isCurrent ? 'Admissions this month' : 'Admissions'} value={c.admissions} delta={delta(c.admissions / Math.max(1, c.elapsedDays), p.admissions / Math.max(1, p.elapsedDays))} deltaNote="vs last month (per day)"
          spark={d.series.map(s => s.admissions)} sub={`${c.emergency} emergency · ${c.admissions - c.emergency} elective`} />
        <Tile label="Ventilated patients" value={c.support.MV.patients} sub={`${fmt1(c.support.MV.days)} ventilator-days · ${fmtPct(c.patientsManaged ? (c.support.MV.patients / c.patientsManaged) * 100 : null)} of patients`}
          delta={delta(c.support.MV.patients / Math.max(1, c.patientsManaged), p.support.MV.patients / Math.max(1, p.patientsManaged))} deltaNote="vs last month" upIsBad />
        <Tile label="Mortality" value={c.mortalityPct ?? 0} decimals={1} suffix="%" sub={c.smr ? `SMR ${c.smr.smr.toFixed(2)} (95% CI ${c.smr.lo.toFixed(2)}–${c.smr.hi.toFixed(2)}) · PIM3 in ${Math.round(c.smr.coverage)}%` : `${c.deaths} deaths of ${c.discharges} discharges · crude (no PIM3 yet)`}
          delta={c.mortalityPct != null && p.mortalityPct != null ? c.mortalityPct - p.mortalityPct : null} deltaNote="vs last month" deltaIsPoints upIsBad />
        <Tile label="Median length of stay" value={c.los?.median ?? 0} decimals={1} suffix=" d" sub={c.los ? `IQR ${fmt1(c.los.q1)}–${fmt1(c.los.q3)} d · ${c.los.n} discharges` : 'No discharges yet'}
          delta={delta(c.los?.median, p.los?.median)} deltaNote="vs last month" upIsBad />
      </div>

      {/* Census chart + notices */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.65fr_1fr]">
        <div className="card p-5">
          <CardHeader title="Census over the month" info="Patients in the unit at 08:00 each day." right={<Legend items={[{ label: fmtMonth(month), color: 'var(--accent)' }, { label: fmtMonth(shiftMonth(month, -1)), color: 'var(--text-3)', dashed: true }]} />} />
          <CompareArea data={censusData} currentLabel={fmtMonth(month)} previousLabel={fmtMonth(shiftMonth(month, -1))} height={240} />
        </div>

        <div className="card flex flex-col p-5">
          <CardHeader title={<span className="flex items-center gap-2 text-accent-ink"><Sparkles size={16} />Antibiome noticed</span>}
            info="Changes vs last month that pass a size threshold (≥ 20%) and an exact statistical test (p < 0.05). Descriptive only — they are not explanations." />
          <div className="flex flex-col divide-y divide-line">
            {d.projection != null && (
              <NoticeRow icon={<Target size={16} />} tone="good" title={`On track for ~${d.projection} admissions this month`} detail={`Based on the daily rate so far (${c.elapsedDays} days). ${p.admissions} last month.`} />
            )}
            {d.changes.notices.slice(0, d.projection != null ? 3 : 4).map((n, i) => <NoticeItem key={n.id} n={n} i={i} />)}
            {!d.changes.notices.length && <NoticeRow icon={<Info size={16} />} tone="info" title="No significant changes this month" detail="Large swings on small numbers are listed below as possible noise." />}
          </div>
          {d.changes.notices.length > 3 && <p className="mt-2 text-[12px] text-ink-3">+{d.changes.notices.length - 3} more in the monthly report.</p>}
          {!!d.changes.noise.length && (
            <div className="mt-auto pt-3">
              <button className="text-[12px] text-ink-3 underline-offset-2 hover:text-ink hover:underline" onClick={() => setShowNoise(!showNoise)}>
                {showNoise ? 'Hide' : 'Show'} {d.changes.noise.length} large change{d.changes.noise.length === 1 ? '' : 's'} that may be noise
              </button>
              {showNoise && <ul className="mt-2 space-y-1 text-[12px] text-ink-3">{d.changes.noise.slice(0, 6).map(n => <li key={n.id}>• {n.title} <span className="opacity-70">(p = {n.p?.toFixed(2)})</span></li>)}</ul>}
            </div>
          )}
        </div>
      </div>

      {/* Disease burden + support */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.65fr_1fr]">
        <div className="card p-5">
          <CardHeader title="Disease burden" info="Primary diagnosis of patients admitted in the month. Deaths and LOS count those already discharged."
            right={<ContinuousTabs tabs={dxCats.map(x => ({ id: x, label: x }))} value={dxCat} onChange={setDxCat} />} />
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11.5px] text-ink-3">
                <th className="pb-2 font-medium">Diagnosis</th><th className="pb-2 font-medium">Admissions</th>
                <th className="pb-2 pl-3 text-right font-medium whitespace-nowrap">Ventilated</th><th className="pb-2 pl-3 text-right font-medium">Deaths</th><th className="pb-2 pl-3 text-right font-medium whitespace-nowrap">Median LOS</th>
              </tr>
            </thead>
            <tbody>
              {dxRows.map(r => {
                const prevN = p.topDx.find(x => x.code === r.code)?.n ?? 0;
                return (
                  <tr key={r.code} className="border-t border-line">
                    <td className="py-2.5"><span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-accent" />{r.label}</span></td>
                    <td className="w-[34%] py-2.5 pr-4">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 rounded-full bg-panel-2"><div className="h-full rounded-full bg-[var(--series-1)]" style={{ width: `${(r.n / (c.topDx[0]?.n || 1)) * 100}%` }} /></div>
                        <span className="tnum w-6 text-right font-medium">{r.n}</span>
                        <span className={cx('tnum w-10 text-right text-[11px]', r.n > prevN ? 'text-ink-2' : 'text-ink-3')}>{r.n - prevN >= 0 ? '+' : ''}{r.n - prevN}</span>
                      </div>
                    </td>
                    <td className="tnum py-2.5 text-right text-ink-2">{r.mvPatients}</td>
                    <td className={cx('tnum py-2.5 text-right', r.deaths ? 'text-crit-ink' : 'text-ink-3')}>{r.deaths}</td>
                    <td className="tnum py-2.5 text-right text-ink-2">{r.medianLos != null ? `${fmt1(r.medianLos)} d` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!dxRows.length && <Empty title="No admissions in this period" />}
        </div>

        <div className="card p-5">
          <CardHeader title="Respiratory & haemodynamic" info="Patients who needed each level at any point in the month, and device-days." />
          <HBars rows={(['O2', 'HFNC', 'NIV', 'MV'] as const).map((k, i) => ({ key: k, label: RESP_LABEL[k], value: c.support[k].patients, color: `var(--seq-${i + 1})` }))}
            right={k => <span>{c.support[k as 'MV'].patients} <span className="text-[11px] font-normal text-ink-3">· {fmt1(c.support[k as 'MV'].days)} d</span></span>} />
          <div className="mt-5 grid grid-cols-2 gap-3">
            <MiniStat icon={<HeartPulse size={15} />} label="Vasoactive support" value={`${c.vaso.patients}`} sub={`${fmt1(c.vaso.days)} days`} />
            <MiniStat icon={<Wind size={15} />} label="Patient-days" value={fmtInt(c.patientDays)} sub={`${fmtPct(c.occupancyPct)} average occupancy`} />
          </div>
        </div>
      </div>

      {/* Trends + stewardship + micro */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="card p-5">
          <CardHeader title="Admissions · 12 months" right={<button onClick={() => go('report')} className="text-[12px] text-ink-3 hover:text-ink">Report →</button>} />
          <Columns data={d.series.map(s => ({ x: s.label.split(' ')[0], y: s.admissions }))} name="Admissions" />
        </div>
        <div className="card p-5">
          <CardHeader title="Antimicrobial use" info="Days of therapy (DOT) per 1,000 patient-days, this month. WHO AWaRe groups simplified." right={<button onClick={() => go('stewardship')} className="text-[12px] text-ink-3 hover:text-ink">Stewardship →</button>} />
          <div className="mb-4 flex items-baseline gap-2"><span className="tnum text-[26px] font-semibold">{fmtInt(c.dot.per1000)}</span><span className="text-[12px] text-ink-3">DOT / 1,000 patient-days</span></div>
          <HBars rows={topDrugs.map(([drug, dot]) => ({ key: drug, label: drug, value: c.patientDays ? (dot / c.patientDays) * 1000 : 0 }))} fmt={v => fmtInt(v)} />
          <div className="mt-4"><StackBar parts={[
            { label: 'Access', value: c.dot.byAware.Access, color: 'var(--series-3)' },
            { label: 'Watch', value: c.dot.byAware.Watch, color: 'var(--series-1)' },
            { label: 'Reserve', value: c.dot.byAware.Reserve, color: 'var(--series-2)' },
          ]} /></div>
        </div>
        <div className="card p-5">
          <CardHeader title="Microbiology" info="Share of positive isolates flagged MDR (definition v1, unchanged from the original Antibiome)." right={<button onClick={() => go('micro')} className="text-[12px] text-ink-3 hover:text-ink">Antibiogram →</button>} />
          <div className="mb-1 flex items-baseline gap-2">
            <span className="tnum text-[26px] font-semibold">{c.micro.positives ? fmtPct((c.micro.mdr / c.micro.positives) * 100) : '—'}</span>
            <span className="text-[12px] text-ink-3">MDR · {c.micro.mdr}/{c.micro.positives} positive of {c.micro.cultures} cultures</span>
          </div>
          <TrendLine data={d.series.map(s => ({ x: s.label.split(' ')[0], y: s.mdrPct }))} name="MDR %" fmt={v => `${Math.round(v)}%`} height={120} domain={[0, 100]} />
          <div className="mt-3 flex flex-col gap-1.5">
            {topOrgs.map(([o, n]) => (
              <div key={o} className="flex items-center justify-between text-[12.5px]">
                <span className="truncate text-ink-2 italic">{o}</span>
                <span className="tnum text-ink">{n}{c.micro.mdrByOrganism[o] ? <span className="ml-1.5 text-[11px] text-crit-ink">{c.micro.mdrByOrganism[o]} MDR</span> : null}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="text-[11.5px] text-ink-3">All figures are descriptive summaries of locally recorded data. Changes and differences are associations, not causes, and do not replace clinical judgement.</p>
    </div>
  );
}

function Tile({ label, value, suffix, decimals = 0, delta: dl, deltaNote, deltaIsPoints, upIsBad, sub, spark, foot, onClick }: {
  label: string; value: number; suffix?: string; decimals?: number; delta?: number | null; deltaNote?: string; deltaIsPoints?: boolean;
  upIsBad?: boolean; sub?: string; spark?: (number | null)[]; foot?: React.ReactNode; onClick?: () => void;
}) {
  const show = dl != null && Number.isFinite(dl) && Math.abs(dl) >= 0.5;
  const up = (dl ?? 0) > 0;
  return (
    <SpotlightCard className={cx('p-4', onClick && 'cursor-pointer')} onClick={onClick}>
      <p className="text-[12.5px] text-ink-3">{label}</p>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <span className="tnum text-[30px] leading-none font-semibold tracking-tight">
          <CountUp to={Math.round(value * 10 ** decimals) / 10 ** decimals} duration={0.9} separator="," />
          {suffix && <span className="text-[16px] font-medium text-ink-3">{suffix}</span>}
        </span>
        {spark && <Sparkline values={spark} width={96} height={34} />}
      </div>
      {foot}
      {!foot && (
        <div className="mt-2.5 flex flex-col gap-0.5">
          {show && (
            <span className={cx('inline-flex items-center gap-1 text-[12px] font-medium whitespace-nowrap', up === !!upIsBad ? 'text-warn-ink' : 'text-good-ink')} title={deltaNote}>
              {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
              {deltaIsPoints ? `${Math.abs(dl!).toFixed(1)} pts` : `${Math.abs(Math.round(dl!))}%`} <span className="font-normal text-ink-3">{deltaNote}</span>
            </span>
          )}
          {sub && <span className="text-[12px] text-ink-3">{sub}</span>}
        </div>
      )}
    </SpotlightCard>
  );
}

function NoticeItem({ n, i }: { n: Notice; i: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i }}>
      <NoticeRow icon={n.direction === 'up' ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
        tone={n.tone === 'watch' ? 'accent' : n.tone === 'good' ? 'good' : 'info'} title={n.title}
        detail={<>{n.detail}<span className="ml-1 opacity-70">· {n.p != null ? `p = ${n.p < 0.001 ? '<0.001' : n.p.toFixed(3)}` : 'descriptive'}</span></>} hint={n.test} />
    </motion.div>
  );
}

function NoticeRow({ icon, tone, title, detail, hint }: { icon: React.ReactNode; tone: 'accent' | 'good' | 'info'; title: string; detail: React.ReactNode; hint?: string }) {
  const bg = { accent: 'bg-accent-soft text-accent-ink', good: 'bg-good-soft text-good-ink', info: 'bg-info-soft text-info-ink' }[tone];
  return (
    <div className="flex items-start gap-3.5 py-3 first:pt-0" title={hint}>
      <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', bg)}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium">{title}</span>
        <span className="block text-[12px] text-ink-3">{detail}</span>
      </span>
    </div>
  );
}

function MiniStat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="inset p-3">
      <p className="flex items-center gap-1.5 text-[12px] text-ink-3">{icon}{label}</p>
      <p className="tnum mt-1 text-[20px] font-semibold">{value}</p>
      <p className="text-[11.5px] text-ink-3">{sub}</p>
    </div>
  );
}

function Welcome({ user, onAdmit }: { user: User; onAdmit: () => void }) {
  const toast = useToast();
  const admin = user.role === 'admin';
  const clinical = admin || user.role === 'clinician';
  const loadDemo = async () => { try { const n = await call('desktop.loadDemo'); toast(`Loaded ${n} synthetic admissions`); } catch (e: any) { toast(e.message, 'crit'); } };
  const importLegacy = async () => { try { const r = await call('desktop.importLegacy'); if (r) toast(`Imported ${r.imported} cultures (${r.skipped} skipped)`); } catch (e: any) { toast(e.message, 'crit'); } };
  return (
    <div className="mx-auto max-w-3xl py-10">
      <PageHeader title="Welcome to Antibiome PICU" subtitle="The command centre fills in as admissions, therapies and cultures are recorded." />
      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        {clinical && <WelcomeCard icon={<Plus size={18} />} title="Admit the first patient" text="About 30 seconds. Press A from anywhere." action={<Button variant="primary" size="sm" onClick={onAdmit}>New admission</Button>} />}
        {admin && <WelcomeCard icon={<FileUp size={18} />} title="Import NICU cultures" text="Bring the history from the original Antibiome web app (CSV export or JSON backup)." action={<Button size="sm" onClick={importLegacy}>Import file…</Button>} />}
        {admin && <WelcomeCard icon={<LineChart size={18} />} title="Explore with demo data" text="Loads 15 months of clearly-labelled synthetic data into this empty database." action={<Button size="sm" onClick={loadDemo}>Load demo data</Button>} />}
        {!clinical && <WelcomeCard icon={<BedDouble size={18} />} title="Nothing recorded yet" text="Dashboards appear once clinicians start recording admissions." />}
      </div>
    </div>
  );
}
function WelcomeCard({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action?: React.ReactNode }) {
  return (
    <SpotlightCard className="flex flex-col gap-3 p-5">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent-ink">{icon}</span>
      <div><p className="font-medium">{title}</p><p className="mt-1 text-[12.5px] text-ink-3">{text}</p></div>
      {action && <div className="mt-auto">{action}</div>}
    </SpotlightCard>
  );
}
