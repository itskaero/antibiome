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
        subtitle="Days of therapy (DOT) per 1,000 days present — the standard paediatric stewardship measure (no dosing data needed)."
        chips={<><Chip>{data.courses} courses in the last 3 months</Chip><Chip>Median course {fmt1(data.medianCourseDays)} d</Chip>
          {last.daysPresent < SMALL && <Chip tone="warn">Only {last.daysPresent} days present in {fmtMonth(last.month)} — rates swing widely</Chip>}</>} />

      <div className="inset grid grid-cols-1 gap-3 p-4 text-[12.5px] text-ink-2 md:grid-cols-[1.2fr_1fr_1fr_1fr]">
        <p><b className="text-ink">How to read this.</b> One DOT is one antimicrobial given on one calendar day (two drugs on the same day = 2 DOT). Days present = calendar days each patient spent in the unit. So a single drug can reach at most 1,000.</p>
        <p><Chip tone="good">Access</Chip> WHO first-choice, narrow-spectrum agents (e.g. ampicillin, gentamicin, amikacin, cefazolin). Use freely when indicated.</p>
        <p><Chip tone="warn">Watch</Chip> Broader-spectrum agents with higher resistance risk (e.g. ceftriaxone, piperacillin-tazobactam, meropenem, vancomycin). Not wrong — but the ones to monitor.</p>
        <p><Chip tone="crit">Reserve</Chip> Last-resort agents for multidrug-resistant infection (e.g. colistin, linezolid). Expect few, each backed by a culture.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="card p-5 xl:col-span-2">
          <CardHeader title="Total antimicrobial use · 12 months" info="All agents, DOT per 1,000 days present. Above 1,000 means patients were on more than one agent on average." />
          <Columns data={data.months.map(m => ({ x: fmtMonth(m.month).split(' ')[0], y: m.per1000 != null ? Math.round(m.per1000) : null }))} name="DOT / 1,000 days present" height={220} />
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

      <div className="card overflow-hidden">
        <div className="px-5 pt-5"><CardHeader title="Use by agent" info="DOT per 1,000 days present by month. Cell shade scales with use; values are printed. Months with few patients swing widely." /></div>
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
