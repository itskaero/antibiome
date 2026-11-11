import { useMemo } from 'react';
import { Pill } from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { cx, fmt1, fmtInt, fmtPct } from '@/lib/format';
import { CardHeader, Chip, PageHeader } from '@/components/ui';
import { Columns, StackBar } from '@/components/charts';
import { SENTINEL_ANTIMICROBIALS, awareGroup } from '@shared/reference';
import { fmtMonth } from '@shared/time';

/** Below this many days present in a month, rates are too unstable to read much into. */
const SMALL = 100;

interface Steward {
  months: { month: string; patientDays: number; daysPresent: number; per1000: number | null; byDrug: Record<string, number>; byAware: Record<string, number>; exposedPct: number | null; patients: number }[];
  intents: { empiric: number; targeted: number; prophylaxis: number }; medianCourseDays: number | null; courses: number;
  courseLengths: { drug: string; courses: number; running: number; medianDays: number; minDays: number; maxDays: number; totalDays: number; over7: number }[];
}

export function Stewardship() {
  const { data } = useApi<Steward>('stewardship.get');
  const drugs = useMemo(() => {
    if (!data) return [];
    const tot: Record<string, number> = {};
    data.months.forEach(m => Object.entries(m.byDrug).forEach(([d, v]) => { tot[d] = (tot[d] ?? 0) + v; }));
    const top = Object.entries(tot).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([d]) => d);
    return [...new Set([...SENTINEL_ANTIMICROBIALS.filter(d => tot[d]), ...top])].slice(0, 12);
  }, [data]);
  if (!data) return null;
  const last = data.months[data.months.length - 1];
  const last3 = data.months.slice(-3);
  const aware3 = ['Access', 'Watch', 'Reserve'].map(k => last3.reduce((s, m) => s + (m.byAware[k] ?? 0), 0));
  const rate = (m: Steward['months'][number], d: string) => (m.daysPresent ? ((m.byDrug[d] ?? 0) / m.daysPresent) * 1000 : null);
  const maxRate = Math.max(1, ...data.months.flatMap(m => drugs.map(d => rate(m, d) ?? 0)));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon={<Pill className="text-accent-ink" size={22} />} title="Antimicrobial stewardship"
        subtitle="How much antibiotic the unit uses (antibiotic-days per 1,000 patient-days, called DOT), and how long each drug is given."
        chips={<><Chip>{data.courses} courses in the last 3 months</Chip><Chip>Median course {fmt1(data.medianCourseDays)} d</Chip>
          {last.daysPresent < SMALL && <Chip tone="warn">Only {last.daysPresent} days present in {fmtMonth(last.month)} — rates swing widely</Chip>}</>} />

      <div className="inset grid grid-cols-1 gap-3 p-4 text-[12.5px] text-ink-2 md:grid-cols-[1.2fr_1fr_1fr_1fr]">
        <p><b className="text-ink">Antibiotic-days (DOT).</b> Each antibiotic given on a calendar day counts 1. Example: one child on ceftriaxone + vancomycin for 3 days = <b>6 antibiotic-days</b>. Dividing by the days children spent in the unit (× 1,000) lets months be compared. One drug alone can reach at most 1,000; above 1,000 means children were on more than one drug at a time.</p>
        <p><Chip tone="good">Access</Chip> WHO first-choice, narrow-spectrum agents (e.g. ampicillin, gentamicin, amikacin, cefazolin). Use freely when indicated.</p>
        <p><Chip tone="warn">Watch</Chip> Broader-spectrum agents with higher resistance risk (e.g. ceftriaxone, piperacillin-tazobactam, meropenem, vancomycin). Not wrong — but the ones to monitor.</p>
        <p><Chip tone="crit">Reserve</Chip> Last-resort agents for multidrug-resistant infection (e.g. colistin, linezolid). Expect few, each backed by a culture.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="card p-5 xl:col-span-2">
          <CardHeader title="Total antibiotic use · 12 months" info="All agents: antibiotic-days per 1,000 patient-days. Above 1,000 means children were on more than one drug at a time, on average." />
          <Columns data={data.months.map(m => ({ x: fmtMonth(m.month).split(' ')[0], y: m.per1000 != null ? Math.round(m.per1000) : null }))} name="Antibiotic-days per 1,000 patient-days" height={220} />
        </div>
        <div className="card flex flex-col gap-5 p-5">
          <div>
            <CardHeader title="AWaRe mix · last 3 months" info="Share of days of therapy in each WHO AWaRe group. A higher Access share is the WHO goal (≥ 60% nationally)." />
            <StackBar parts={[{ label: 'Access', value: aware3[0], color: 'var(--good)' }, { label: 'Watch', value: aware3[1], color: 'var(--warn)' }, { label: 'Reserve', value: aware3[2], color: 'var(--crit)' }]} />
          </div>
          <div>
            <CardHeader title="Why courses were started" info="Intent recorded at start: empiric (before results), targeted (culture-directed) or prophylaxis." />
            <StackBar parts={[{ label: 'Empiric', value: data.intents.empiric, color: 'var(--series-1)' }, { label: 'Targeted', value: data.intents.targeted, color: 'var(--series-3)' }, { label: 'Prophylaxis', value: data.intents.prophylaxis, color: 'var(--series-2)' }]} />
          </div>
          <div className="inset p-3">
            <p className="text-[12px] text-ink-3">Patients exposed to antimicrobials ({fmtMonth(last.month)})</p>
            <p className="tnum text-[22px] font-semibold">{fmtPct(last.exposedPct)}</p>
          </div>
        </div>
      </div>

      <CourseLengths rows={data.courseLengths} />

      <div className="card overflow-hidden">
        <div className="px-5 pt-5"><CardHeader title="Use by agent" info="Antibiotic-days per 1,000 patient-days, by month. Cell shade scales with use; values are printed. Months with few patients swing widely." /></div>
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-[11.5px] text-ink-3">
              <tr><th className="px-5 py-2 font-medium">Agent</th><th className="px-2 py-2 font-medium">Group</th>{data.months.map(m => <th key={m.month} className="px-1.5 py-2 text-center font-medium">{fmtMonth(m.month).split(' ')[0]}</th>)}</tr>
            </thead>
            <tbody>
              {drugs.map(d => (
                <tr key={d} className="border-t border-line">
                  <td className="px-5 py-2 font-medium whitespace-nowrap">{d}</td>
                  <td className="px-2 py-2"><Chip tone={awareGroup(d) === 'Reserve' ? 'crit' : awareGroup(d) === 'Access' ? 'good' : 'warn'}>{awareGroup(d)}</Chip></td>
                  {data.months.map(m => {
                    const v = rate(m, d);
                    const a = v ? 0.08 + 0.6 * (v / maxRate) : 0;
                    return <td key={m.month} className="px-1 py-1 text-center"><span className={cx('tnum block rounded-md py-1', v ? 'text-ink' : 'text-ink-3')} style={{ background: v ? `color-mix(in srgb, var(--series-1) ${Math.round(a * 100)}%, transparent)` : undefined }}>{v ? fmtInt(v) : '·'}</span></td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-5 pt-3 text-[11.5px] text-ink-3">Example: 300 for meropenem means meropenem was given on 30% of the unit's patient-days that month.</p>
        <p className="px-5 py-3 text-[11.5px] text-ink-3">Local practice patterns for review — not prescribing recommendations. Clinical decisions remain with the treating team.</p>
      </div>
    </div>
  );
}

/** How long each drug is actually given: courses, median length and the spread, last 12 months. */
function CourseLengths({ rows }: { rows: Steward['courseLengths'] }) {
  if (!rows.length) return null;
  const scale = Math.max(14, ...rows.map(r => r.maxDays));
  const x = (d: number) => `${Math.min(100, (d / scale) * 100)}%`;
  return (
    <div className="card overflow-hidden">
      <div className="px-5 pt-5"><CardHeader title="Course length by drug · 12 months" info="Each course is one start-to-stop of a drug for one child. Bars show the shortest to longest course; the dot is the median. A running course counts up to today." /></div>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead className="text-left text-[11.5px] text-ink-3">
            <tr><th className="px-5 py-2 font-medium">Drug</th><th className="px-2 py-2 font-medium">Courses</th><th className="px-2 py-2 font-medium">Usual length (median)</th><th className="w-[34%] px-2 py-2 font-medium">Shortest → longest (days)</th><th className="px-2 py-2 font-medium">Longer than 7 days</th><th className="px-5 py-2 font-medium">Total days</th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.drug} className="border-t border-line">
                <td className="px-5 py-2 font-medium whitespace-nowrap">{r.drug} <Chip className="ml-1" tone={awareGroup(r.drug) === 'Reserve' ? 'crit' : awareGroup(r.drug) === 'Access' ? 'good' : 'warn'}>{awareGroup(r.drug)}</Chip></td>
                <td className="tnum px-2 py-2">{r.courses}{r.running ? <span className="text-ink-3"> · {r.running} running</span> : ''}</td>
                <td className="tnum px-2 py-2 text-[14px] font-semibold">{fmt1(r.medianDays)} <span className="text-[11.5px] font-normal text-ink-3">days</span></td>
                <td className="px-2 py-2">
                  <div className="relative h-5">
                    <div className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-panel-3" style={{ left: 0, right: 0 }} />
                    <div className="absolute top-1/2 h-[6px] -translate-y-1/2 rounded-full bg-[var(--series-1)] opacity-50" style={{ left: x(r.minDays), width: `calc(${x(r.maxDays)} - ${x(r.minDays)})` }} />
                    <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel bg-[var(--series-1)]" style={{ left: x(r.medianDays) }} title={`Median ${r.medianDays} d`} />
                    <div className="absolute top-0 bottom-0 border-l border-dashed border-warn/70" style={{ left: x(7) }} title="7 days" />
                  </div>
                  <div className="tnum flex justify-between text-[10.5px] text-ink-3"><span>{fmt1(r.minDays)}</span><span>{fmt1(r.maxDays)}</span></div>
                </td>
                <td className={cx('tnum px-2 py-2', r.over7 ? 'font-semibold text-warn-ink' : 'text-ink-3')}>{r.over7} of {r.courses}</td>
                <td className="tnum px-5 py-2 text-ink-3">{fmt1(r.totalDays)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-5 py-3 text-[11.5px] text-ink-3">Dashed line = 7 days. Long courses aren't wrong (e.g. meningitis, osteomyelitis) — this shows where to look.</p>
    </div>
  );
}
