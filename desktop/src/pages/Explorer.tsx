// Research Explorer: build a cohort from any recorded field (core, derived, PIM3, any module),
// see it in plain words, run it, compare groups, adjust, save. Aggregates only.
import { useEffect, useMemo, useState } from 'react';
import { BookmarkPlus, ChevronDown, Filter, Play, ShieldAlert, Trash2, Info, Sigma, Users } from 'lucide-react';
import { call } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { fmt1 } from '@/lib/format';
import { Button, CardHeader, ChoiceChips, Chip, Empty, ErrorNote, Field, useToast } from '@/components/ui';
import { describeSpec, OP_LABEL, OPS_BY_KIND, type CohortResult, type CohortSpec, type Condition, type ExplorerField, type FieldKind, type Op } from '@shared/explorer';

export const emptySpec = (): CohortSpec => ({ include: [], exclude: [], groupBy: null, outcomes: ['died', 'los_days'], describe: [], regression: null });

export function Explorer({ spec, setSpec, autoRun, runSource }: { spec: CohortSpec; setSpec: (s: CohortSpec) => void; autoRun?: number; runSource?: 'ai' | 'builder' }) {
  const { data: fields } = useApi<ExplorerField[]>('explorer.fields');
  const cohorts = useApi<{ id: string; name: string; spec: CohortSpec; author: string }[]>('cohorts.list');
  const [result, setResult] = useState<(CohortResult & { dataAsOf: string; narrative: string[] }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const toast = useToast();

  const run = async (s = spec) => {
    setErr(null); setRunning(true);
    try { setResult(await call('explorer.run', { spec: s, source: runSource })); } catch (e: any) { setErr(e.message); setResult(null); } finally { setRunning(false); }
  };
  useEffect(() => { if (autoRun) run(); }, [autoRun]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const name = prompt('Name this cohort', spec.name ?? '');
    if (!name) return;
    try { await call('cohorts.save', { name, spec: { ...spec, name } }); setSpec({ ...spec, name }); toast('Cohort saved'); } catch (e: any) { toast(e.message, 'crit'); }
  };

  if (!fields) return null;
  const preview = (() => { try { return describeSpec(spec, fields); } catch { return []; } })();

  return (
    <div className="grid grid-cols-1 gap-3 2xl:grid-cols-[460px_1fr] xl:grid-cols-[420px_1fr]">
      {/* Builder */}
      <div className="flex min-w-0 flex-col gap-3">
        <div className="card flex items-center gap-2 p-3">
          <select className="field h-9 flex-1" value="" onChange={e => { const c = cohorts.data?.find(x => x.id === e.target.value); if (c) { setSpec(c.spec); run(c.spec); } }}>
            <option value="">{cohorts.data?.length ? `Open a saved cohort (${cohorts.data.length})…` : 'No saved cohorts yet'}</option>
            {cohorts.data?.map(c => <option key={c.id} value={c.id}>{c.name} — {c.author}</option>)}
          </select>
          <Button size="sm" onClick={save} title="Save cohort"><BookmarkPlus size={14} />Save</Button>
          <Button size="sm" variant="ghost" onClick={() => { setSpec(emptySpec()); setResult(null); }}>Reset</Button>
        </div>

        <div className="card flex flex-col gap-4 p-5">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Admitted from"><input type="date" className="field h-9" value={spec.from ?? ''} onChange={e => setSpec({ ...spec, from: e.target.value || null })} /></Field>
            <Field label="to"><input type="date" className="field h-9" value={spec.to ?? ''} onChange={e => setSpec({ ...spec, to: e.target.value || null })} /></Field>
          </div>
          <Conditions title="Include patients where (all must hold)" list={spec.include} fields={fields} onChange={include => setSpec({ ...spec, include })} />
          <Conditions title="Exclude patients where (any)" list={spec.exclude} fields={fields} onChange={exclude => setSpec({ ...spec, exclude })} />
          <Field label="Compare groups by">
            <FieldSelect fields={fields} kinds={['boolean', 'category', 'set']} value={spec.groupBy ?? ''} placeholder="No grouping"
              onChange={v => setSpec({ ...spec, groupBy: v || null, regression: v ? spec.regression : null })} />
          </Field>
          <Field label="Outcomes"><FieldMulti fields={fields} kinds={['boolean', 'number']} value={spec.outcomes} onChange={outcomes => setSpec({ ...spec, outcomes })} /></Field>
          <Field label="Also describe"><FieldMulti fields={fields} kinds={['boolean', 'number', 'category', 'set']} value={spec.describe} onChange={describe => setSpec({ ...spec, describe })} /></Field>
          {spec.groupBy && (
            <details className="rounded-xl border border-line p-3" open={!!spec.regression}>
              <summary className="flex cursor-pointer items-center gap-2 text-[12.5px] font-medium"><Sigma size={14} className="text-ink-3" />Adjusted analysis (logistic regression)</summary>
              <div className="mt-3 flex flex-col gap-3">
                <Field label="Binary outcome"><FieldSelect fields={fields} kinds={['boolean']} value={spec.regression?.outcome ?? ''} placeholder="None"
                  onChange={v => setSpec({ ...spec, regression: v ? { outcome: v, covariates: spec.regression?.covariates ?? [] } : null })} /></Field>
                {spec.regression && <Field label="Adjust for" hint="Needs ≥ 10 events per variable; otherwise the model is refused.">
                  <FieldMulti fields={fields} kinds={['number', 'boolean', 'category']} value={spec.regression.covariates} onChange={covariates => setSpec({ ...spec, regression: { ...spec.regression!, covariates } })} />
                </Field>}
              </div>
            </details>
          )}
          <div className="rounded-xl bg-panel-2 p-3 text-[12.5px] leading-relaxed text-ink-2">
            <p className="mb-1 text-[11px] font-semibold tracking-wider text-ink-3 uppercase">This query, in words</p>
            {preview.map((l, i) => <p key={i}>{l}</p>)}
          </div>
          <Button variant="primary" onClick={() => run()} disabled={running}><Play size={15} />{running ? 'Running…' : 'Run'}</Button>
          <ErrorNote text={err} />
        </div>
      </div>

      {/* Results */}
      <div className="flex min-w-0 flex-col gap-3">
        {!result ? <div className="card"><Empty icon={<Filter size={18} />} title="Build a cohort and press Run">Every field recorded in the unit is available: patient, admission, severity, support, treatment, microbiology, outcomes and every module field.</Empty></div> : <Results r={result} />}
      </div>
    </div>
  );
}

// ── Builder pieces ───────────────────────────────────────────

export function FieldSelect({ fields, kinds, value, onChange, placeholder }: { fields: ExplorerField[]; kinds: FieldKind[]; value: string; onChange: (v: string) => void; placeholder: string }) {
  const groups = useMemo(() => {
    const g: Record<string, ExplorerField[]> = {};
    fields.filter(f => kinds.includes(f.kind)).forEach(f => (g[f.group] ??= []).push(f));
    return Object.entries(g);
  }, [fields, kinds]);
  return (
    <select className="field h-9" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {groups.map(([g, list]) => <optgroup key={g} label={g}>{list.map(f => <option key={f.id} value={f.id}>{f.label}{f.unit ? ` (${f.unit})` : ''}</option>)}</optgroup>)}
    </select>
  );
}

function FieldMulti({ fields, kinds, value, onChange }: { fields: ExplorerField[]; kinds: FieldKind[]; value: string[]; onChange: (v: string[]) => void }) {
  const label = (id: string) => fields.find(f => f.id === id)?.label ?? id;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map(id => (
        <button key={id} type="button" onClick={() => onChange(value.filter(x => x !== id))} className="inline-flex h-7 items-center gap-1 rounded-full bg-panel-3 px-2.5 text-[12px] hover:text-crit-ink">{label(id)} ×</button>
      ))}
      <div className="w-full"><FieldSelect fields={fields.filter(f => !value.includes(f.id))} kinds={kinds} value="" placeholder="+ Add…" onChange={v => v && onChange([...value, v])} /></div>
    </div>
  );
}

export function Conditions({ title, list, fields, onChange }: { title: string; list: Condition[]; fields: ExplorerField[]; onChange: (l: Condition[]) => void }) {
  const [adding, setAdding] = useState('');
  const defaultOp = (k: FieldKind): Op => ({ number: 'gte', boolean: 'is_true', category: 'in', set: 'includes_any' } as const)[k];
  return (
    <div>
      <p className="mb-1.5 text-[11.5px] font-medium tracking-wide text-ink-3 uppercase">{title}</p>
      <div className="flex flex-col gap-2">
        {list.map((c, i) => <ConditionRow key={i} c={c} fields={fields} onChange={n => onChange(list.map((x, j) => (j === i ? n : x)))} onRemove={() => onChange(list.filter((_, j) => j !== i))} />)}
        <FieldSelect fields={fields} kinds={['number', 'boolean', 'category', 'set']} value={adding} placeholder="+ Add a condition…"
          onChange={id => { const f = fields.find(x => x.id === id); if (f) onChange([...list, { field: id, op: defaultOp(f.kind), value: f.kind === 'number' ? 0 : f.kind === 'boolean' ? undefined : [] }]); setAdding(''); }} />
      </div>
    </div>
  );
}

const MULTI_OPS: Op[] = ['in', 'not_in', 'includes_any', 'includes_all', 'excludes'];

export function ConditionRow({ c, fields, onChange, onRemove }: { c: Condition; fields: ExplorerField[]; onChange: (c: Condition) => void; onRemove: () => void }) {
  const f = fields.find(x => x.id === c.field);
  if (!f) return null;
  const multi = MULTI_OPS.includes(c.op);
  const values = (Array.isArray(c.value) ? c.value : []).map(String);
  const opts = f.options ?? [];
  return (
    <div className="rounded-xl border border-line bg-panel-2/50 p-2.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{f.label}</span>
        <select className="field h-8 w-36 text-[12px]" value={c.op} onChange={e => {
          const op = e.target.value as Op;
          const value = op === 'between' ? [0, 1] : op === 'gte' || op === 'lte' ? (typeof c.value === 'number' ? c.value : 0) : MULTI_OPS.includes(op) ? (Array.isArray(c.value) ? c.value : []) : undefined;
          onChange({ ...c, op, value });
        }}>
          {OPS_BY_KIND[f.kind].map(o => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
        </select>
        <button onClick={onRemove} className="p-1 text-ink-3 hover:text-crit-ink" aria-label="Remove condition"><Trash2 size={13} /></button>
      </div>
      {(c.op === 'gte' || c.op === 'lte') && <input className="field mt-2 h-8 tnum" type="number" value={String(c.value ?? '')} onChange={e => onChange({ ...c, value: Number(e.target.value) })} />}
      {c.op === 'between' && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {[0, 1].map(i => <input key={i} className="field h-8 tnum" type="number" value={String((c.value as number[])[i] ?? '')} onChange={e => { const v = [...(c.value as number[])]; v[i] = Number(e.target.value); onChange({ ...c, value: v }); }} />)}
        </div>
      )}
      {multi && (
        <div className="mt-2">
          {opts.length <= 10
            ? <ChoiceChips multi size="sm" options={opts} labels={f.optionLabels} value={values} onChange={(v: string[]) => onChange({ ...c, value: v })} />
            : <div className="flex flex-wrap items-center gap-1.5">
                {values.map(v => <button key={v} onClick={() => onChange({ ...c, value: values.filter(x => x !== v) })} className="h-7 rounded-full bg-accent-soft px-2.5 text-[12px] text-accent-ink">{f.optionLabels?.[v] ?? v} ×</button>)}
                <select className="field h-8 text-[12px]" value="" onChange={e => e.target.value && onChange({ ...c, value: [...values, e.target.value] })}>
                  <option value="">+ value…</option>
                  {opts.filter(o => !values.includes(o)).map(o => <option key={o} value={o}>{f.optionLabels?.[o] ?? o}</option>)}
                </select>
              </div>}
        </div>
      )}
    </div>
  );
}

// ── Results ──────────────────────────────────────────────────

const pfmt = (p: number) => (p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`);

function Results({ r }: { r: CohortResult & { dataAsOf: string; narrative: string[] } }) {
  return (
    <>
      <div className="card p-5">
        <p className="mb-2 text-[11px] font-semibold tracking-wider text-ink-3 uppercase">In words</p>
        <div className="flex flex-col gap-1 text-[13.5px] leading-relaxed">{r.narrative.map((l, i) => <p key={i}>{l}</p>)}</div>
        <p className="mt-2 text-[11px] text-ink-3">Written by the app from the calculated numbers below — not by an AI.</p>
      </div>
      <div className="card p-5">
        <CardHeader title={<span className="flex items-center gap-2"><Users size={15} className="text-accent-ink" />Cohort: {r.n} admissions</span>}
          right={<Chip tone={r.claim === 'ASSOCIATION' ? 'warn' : 'info'}><ShieldAlert size={12} />{r.claim === 'ASSOCIATION' ? 'Association — not causation' : 'Descriptive'}</Chip>} />
        <ol className="flex flex-col gap-1 text-[12.5px]">
          {r.steps.map((s, i) => (
            <li key={i} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1 odd:bg-panel-2/50">
              <span className="text-ink-2">{s.label}</span><span className="tnum font-medium">{s.remaining}</span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[11.5px] text-ink-3">Data as of {r.dataAsOf.replace('T', ' ')} · query logged in the audit trail · counts only, no identifiers</p>
      </div>

      {!!r.outcomes.length && (
        <div className="card p-5">
          <CardHeader title="Outcomes" info="n/N (%) for yes/no outcomes; median (IQR) for numbers. Tests: Fisher / Mann–Whitney for two groups, χ² / Kruskal–Wallis for more." />
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-left text-[11.5px] text-ink-3">
                <tr><th className="pb-2 pr-4 font-medium">Outcome</th>{r.groups.map(g => <th key={g.key} className="pb-2 pr-4 font-medium whitespace-nowrap">{g.label} <span className="font-normal">(n {g.n})</span></th>)}<th className="pb-2 font-medium">Comparison</th></tr>
              </thead>
              <tbody>
                {r.outcomes.map(o => (
                  <tr key={o.field} className="border-t border-line align-top">
                    <td className="py-2.5 pr-4">{o.label}</td>
                    {o.cells.map(c => (
                      <td key={c.group} className="tnum py-2.5 pr-4 whitespace-nowrap">
                        {o.kind === 'boolean' ? (c.n ? <>{c.yes}/{c.n} <span className="text-ink-3">({Math.round(c.pct ?? 0)}%)</span></> : '—')
                          : c.median !== undefined ? <>{fmt1(c.median)} <span className="text-ink-3">({fmt1(c.q1)}–{fmt1(c.q3)})</span></> : '—'}
                      </td>
                    ))}
                    <td className="py-2.5 text-[12px] text-ink-2">
                      {o.test ? <div>{o.test.name}: {pfmt(o.test.p)}{o.test.note && <div className="text-[11.5px] text-warn-ink">{o.test.note}</div>}</div> : <span className="text-ink-3">—</span>}
                      {o.effect && <div className="text-ink-3">{o.effect.name}: {o.effect.value.toFixed(2)} (95% CI {o.effect.lo.toFixed(2)}–{o.effect.hi.toFixed(2)})</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {r.regression && (
        <div className="card p-5">
          <CardHeader title={<span className="flex items-center gap-2"><Sigma size={15} className="text-accent-ink" />Adjusted odds ratios</span>}
            info="Logistic regression with Wald 95% confidence intervals. Odds ratios above 1 mean higher odds of the outcome." />
          {r.regression.refused ? <p className="rounded-xl bg-warn-soft px-3 py-2 text-[12.5px] text-warn-ink">{r.regression.refused}</p> : (
            <>
              <table className="w-full text-[13px]">
                <thead className="text-left text-[11.5px] text-ink-3"><tr><th className="pb-2 font-medium">Term</th><th className="pb-2 font-medium">Odds ratio (95% CI)</th><th className="pb-2 font-medium">p</th></tr></thead>
                <tbody>
                  {r.regression.terms.map(t => (
                    <tr key={t.name} className="border-t border-line">
                      <td className="py-2.5 pr-4">{t.name}</td>
                      <td className="tnum py-2.5 pr-4">{t.or.toFixed(2)} <span className="text-ink-3">({t.lo.toFixed(2)}–{t.hi.toFixed(2)})</span></td>
                      <td className="tnum py-2.5">{Number.isFinite(t.p) ? pfmt(t.p).replace('p = ', '').replace('p ', '') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11.5px] text-ink-3">n = {r.regression.n} with complete data · {r.regression.events} events (fewer class) · {r.regression.epv.toFixed(1)} events per variable</p>
              {r.regression.warnings.map(w => <p key={w} className="mt-1 text-[12px] text-warn-ink">{w}</p>)}
            </>
          )}
        </div>
      )}

      {!!r.describe.length && (
        <div className="card p-5">
          <CardHeader title="Description of the cohort" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {r.describe.map(v => (
              <div key={v.field} className="inset p-3.5">
                <p className="text-[12.5px] font-medium">{v.label} <span className="font-normal text-ink-3">· n {v.n}{v.missing ? ` · ${v.missing} not recorded` : ''}</span></p>
                {v.numeric && <p className="tnum mt-1 text-[13px]">median {fmt1(v.numeric.median)} (IQR {fmt1(v.numeric.q1)}–{fmt1(v.numeric.q3)}) <span className="text-ink-3">· mean {fmt1(v.numeric.mean)} ± {fmt1(v.numeric.sd)} · {fmt1(v.numeric.min)}–{fmt1(v.numeric.max)}</span></p>}
                {v.yes !== undefined && <p className="tnum mt-1 text-[13px]">{v.yes}/{v.n} yes ({v.n ? Math.round((v.yes / v.n) * 100) : 0}%) <span className="text-ink-3">95% CI {Math.round((v.ci?.[0] ?? 0) * 100)}–{Math.round((v.ci?.[1] ?? 0) * 100)}%</span></p>}
                {v.counts && (
                  <div className="mt-1.5 flex flex-col gap-1">
                    {v.counts.slice(0, 8).map(c => (
                      <div key={c.value} className="grid grid-cols-[minmax(0,1fr)_90px_auto] items-center gap-2 text-[12px]">
                        <span className="truncate">{c.label}</span>
                        <div className="h-1.5 rounded-full bg-panel-3"><div className="h-full rounded-full bg-[var(--series-1)]" style={{ width: `${(c.n / Math.max(1, r.n)) * 100}%` }} /></div>
                        <span className="tnum w-14 text-right">{c.n} <span className="text-ink-3">{Math.round((c.n / Math.max(1, r.n)) * 100)}%</span></span>
                      </div>
                    ))}
                    {v.counts.length > 8 && <span className="text-[11px] text-ink-3">+{v.counts.length - 8} more values</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card p-5">
        <p className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold"><Info size={14} className="text-ink-3" />How to read this</p>
        <ul className="flex flex-col gap-1.5 text-[12.5px] text-ink-2">{r.caveats.map(c => <li key={c} className="flex gap-2"><ChevronDown size={13} className="mt-0.5 shrink-0 -rotate-90 text-ink-3" />{c}</li>)}</ul>
        <p className="mt-3 text-[12px] text-ink-3">Report findings descriptively (“12/14 patients in the IVIG group improved”) or as associations (“mortality was higher in…”), never as causes.</p>
      </div>
    </>
  );
}
