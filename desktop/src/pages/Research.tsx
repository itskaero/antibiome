// Research: the cross-module Explorer, plus a per-module overview. Every result is labelled
// DESCRIPTIVE or ASSOCIATION and states its limits — never causal.
import { useEffect, useState } from 'react';
import { Download, FlaskRound, Info, ShieldAlert } from 'lucide-react';
import { call } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { cx, fmt1 } from '@/lib/format';
import { Button, CardHeader, Chip, Empty, Field, PageHeader, useToast } from '@/components/ui';
import { ContinuousTabs } from '@/vendor/watermelon/continuous-tabs';
import { Explorer, emptySpec } from './Explorer';
import type { CohortSpec } from '@shared/explorer';
import type { GroupComparison, ModuleDef, VariableSummary } from '@shared/modules';
import { DERIVED } from '@shared/modules';
import { dxLabel } from '@shared/reference';

interface Result {
  module: ModuleDef; n: number; discharged: number; completion: number | null; variables: VariableSummary[]; comparison: GroupComparison | null;
  filters: { from: string | null; to: string | null; diagnoses: string[]; groupBy: string | null; outcomes: string[] };
}

/** Routes: #/research · #/research/<moduleId> (module overview) · #/research/q/<url-encoded CohortSpec> (run a query). */
export function Research({ canExport, args }: { canExport: boolean; args: string[] }) {
  const linked = args[0] === 'q' ? (() => { try { return JSON.parse(decodeURIComponent(args.slice(1).join('/'))) as CohortSpec; } catch { return null; } })() : null;
  const initialModule = args[0] && args[0] !== 'q' ? args[0] : undefined;
  const [tab, setTab] = useState(initialModule ? 'modules' : 'explorer');
  const [spec, setSpec] = useState<CohortSpec>(() => (linked ? { ...emptySpec(), ...linked } : emptySpec()));
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon={<FlaskRound className="text-accent-ink" size={22} />} title="Research"
        subtitle="Ask questions of everything the unit records. Results are counts and statistics only — never identifiers — and always state their limits."
        actions={<>
          <ContinuousTabs size="md" tabs={[{ id: 'explorer', label: 'Explorer' }, { id: 'modules', label: 'Module overview' }]} value={tab} onChange={setTab} />
          {canExport && <ExportButton />}
        </>} />
      {tab === 'explorer' ? <Explorer spec={spec} setSpec={setSpec} autoRun={linked ? 1 : 0} /> : <ModuleOverview initialModule={initialModule} />}
    </div>
  );
}

function ExportButton() {
  const toast = useToast();
  const exportAll = async () => {
    try {
      const res = await call<{ csv: string; dictionary: string; rows: number; columns: number }>('export.deidentified', {});
      const stamp = new Date().toISOString().slice(0, 10);
      const p = await call('desktop.saveCsv', { csv: res.csv, name: `antibiome-dataset-${stamp}.csv` });
      if (!p) return;
      await call('desktop.saveCsv', { csv: res.dictionary, name: `antibiome-data-dictionary-${stamp}.csv` });
      toast(`Exported ${res.rows} admissions × ${res.columns} columns, with data dictionary`);
    } catch (e: any) { toast(e.message, 'crit'); }
  };
  return <Button onClick={exportAll}><Download size={15} />Export dataset</Button>;
}

/** Per-module overview: completeness, distributions and outcomes by one exposure. */
function ModuleOverview({ initialModule }: { initialModule?: string }) {
  const mods = useApi<{ modules: ModuleDef[] }>('modules.list');
  const modules = (mods.data?.modules ?? []).filter(m => m.active);
  const [moduleId, setModuleId] = useState<string>(initialModule ?? '');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [groupBy, setGroupBy] = useState('');
  useEffect(() => { if (!moduleId && modules[0]) setModuleId(modules[0].id); }, [modules, moduleId]);
  const m = modules.find(x => x.id === moduleId);
  useEffect(() => { setGroupBy(m?.exposures[0] ?? ''); }, [m?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data: r } = useApi<Result>(moduleId ? 'research.module' : null, { moduleId, from: from || undefined, to: to || undefined, groupBy: groupBy || undefined });
  const groupables = m?.params.filter(p => ['choice', 'multi', 'boolean'].includes(p.type)) ?? [];

  return (
    <div className="flex flex-col gap-5">
      {!modules.length ? <div className="card"><Empty title="No active modules" /></div> : <>
        <div className="flex flex-wrap items-end gap-3">
          <ContinuousTabs size="md" tabs={modules.map(x => ({ id: x.id, label: x.label }))} value={moduleId} onChange={setModuleId} />
          <Field label="Admitted from"><input type="date" className="field h-9 w-40" value={from} onChange={e => setFrom(e.target.value)} /></Field>
          <Field label="to"><input type="date" className="field h-9 w-40" value={to} onChange={e => setTo(e.target.value)} /></Field>
        </div>

        {r && <>
          {/* Cohort definition — always visible so every number can be reproduced. */}
          <div className="inset flex flex-wrap items-center gap-2 px-4 py-3 text-[12.5px]">
            <span className="font-semibold">Cohort</span>
            <Chip tone="accent">{r.filters.diagnoses.length ? r.filters.diagnoses.map(dxLabel).join(' / ') : 'All admissions'} (primary or secondary)</Chip>
            <Chip>{r.filters.from ?? 'all time'} → {r.filters.to ?? 'today'}</Chip>
            <Chip>{r.n} admissions · {r.discharged} discharged</Chip>
            <Chip tone={r.completion != null && r.completion >= 90 ? 'good' : 'warn'}>{r.completion != null ? `${Math.round(r.completion)}%` : '—'} complete</Chip>
            <span className="ml-auto text-ink-3">Aggregate counts only · no identifiers</span>
          </div>

          <div className="card p-5">
            <CardHeader title="What was recorded" info="n = patients with a value. Eligible = asked (field existed and was shown). Not collected = admitted before the field was introduced." />
            {!r.variables.length ? <Empty title="No fields" /> : (
              <table className="w-full text-[13px]">
                <thead className="text-left text-[11.5px] text-ink-3"><tr><th className="pb-2 font-medium">Variable</th><th className="pb-2 font-medium">Recorded</th><th className="pb-2 font-medium">Summary</th></tr></thead>
                <tbody>
                  {r.variables.map(v => (
                    <tr key={v.id} className="border-t border-line align-top">
                      <td className="py-2.5 pr-4">{v.label}{DERIVED[v.id] && <span className="ml-1.5 text-[11px] text-ink-3">derived</span>}</td>
                      <td className="tnum py-2.5 pr-4 whitespace-nowrap text-ink-2">
                        {v.n}/{v.eligible}{v.eligible ? <span className="text-ink-3"> ({Math.round((v.n / v.eligible) * 100)}%)</span> : ''}
                        {v.notCollected > 0 && <div className="text-[11px] text-ink-3">{v.notCollected} not collected</div>}
                      </td>
                      <td className="py-2.5 text-ink-2"><Summary v={v} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card p-5">
            <CardHeader title="Outcomes by group"
              right={<select className="field h-9 w-64" value={groupBy} onChange={e => setGroupBy(e.target.value)} aria-label="Group by">
                <option value="">No grouping</option>
                {groupables.map(p => <option key={p.key} value={p.key}>Group by: {p.label}</option>)}
              </select>} />
            {!r.comparison ? <p className="text-[13px] text-ink-3">Choose an exposure (a choice or yes/no field) to compare outcomes between groups.</p> : <Comparison c={r.comparison} />}
          </div>
        </>}
      </>}
    </div>
  );
}

function Summary({ v }: { v: VariableSummary }) {
  if (!v.n) return <span className="text-ink-3">—</span>;
  if (v.numeric) return <span className="tnum">median {fmt1(v.numeric.median)} <span className="text-ink-3">(IQR {fmt1(v.numeric.q1)}–{fmt1(v.numeric.q3)}; range {fmt1(v.numeric.min)}–{fmt1(v.numeric.max)})</span></span>;
  if (v.yes !== undefined) return <span className="tnum">{v.yes}/{v.n} yes <span className="text-ink-3">({Math.round((v.yes / v.n) * 100)}%)</span></span>;
  if (v.counts) {
    const total = v.n;
    return (
      <div className="flex flex-col gap-1">
        {v.counts.filter(c => c.n).sort((a, b) => b.n - a.n).map(c => (
          <div key={c.option} className="grid grid-cols-[minmax(0,200px)_1fr_auto] items-center gap-3 text-[12.5px]">
            <span className="truncate">{c.option}</span>
            <div className="h-2 rounded-full bg-panel-2"><div className="h-full rounded-full bg-[var(--series-1)]" style={{ width: `${(c.n / total) * 100}%` }} /></div>
            <span className="tnum w-16 text-right">{c.n} <span className="text-ink-3">({Math.round((c.n / total) * 100)}%)</span></span>
          </div>
        ))}
      </div>
    );
  }
  return <span className="tnum">{v.n} recorded</span>;
}

function Comparison({ c }: { c: GroupComparison }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={c.claim === 'ASSOCIATION' ? 'warn' : 'info'}><ShieldAlert size={12} />{c.claim === 'ASSOCIATION' ? 'Association — not causation' : 'Descriptive only'}</Chip>
        {c.groups.map(g => <Chip key={g.key}>{g.key}: n = {g.n}</Chip>)}
      </div>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="text-left text-[11.5px] text-ink-3">
            <tr><th className="pb-2 pr-4 font-medium">Outcome</th>{c.groups.map(g => <th key={g.key} className="pb-2 pr-4 font-medium">{g.key}</th>)}<th className="pb-2 font-medium">Test</th></tr>
          </thead>
          <tbody>
            {c.outcomes.map(o => (
              <tr key={o.id} className="border-t border-line">
                <td className="py-2.5 pr-4">{o.label}</td>
                {o.cells.map(cell => (
                  <td key={cell.key} className="tnum py-2.5 pr-4 whitespace-nowrap">
                    {o.kind === 'boolean'
                      ? cell.n ? <>{cell.yes}/{cell.n} <span className="text-ink-3">({Math.round(((cell.yes ?? 0) / cell.n) * 100)}%)</span></> : '—'
                      : cell.median !== undefined ? <>{fmt1(cell.median)} <span className="text-ink-3">({fmt1(cell.q1)}–{fmt1(cell.q3)}) · n {cell.n}</span></> : '—'}
                  </td>
                ))}
                <td className={cx('py-2.5 text-[12px] whitespace-nowrap', o.test && o.test.p < 0.05 ? 'text-ink' : 'text-ink-3')}>
                  {o.test ? <>{o.test.name}, p = {o.test.p < 0.001 ? '<0.001' : o.test.p.toFixed(3)}</> : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11.5px] text-ink-3">Numbers are n/N (%) or median (IQR). Write findings descriptively — e.g. “12/14 patients in the IVIG group improved” — not “IVIG improved outcomes”.</p>
      <ul className="flex flex-col gap-1 rounded-xl bg-panel-2 px-4 py-3 text-[12px] text-ink-2">
        {c.caveats.map(x => <li key={x} className="flex gap-2"><Info size={13} className="mt-0.5 shrink-0 text-ink-3" />{x}</li>)}
      </ul>
    </div>
  );
}
