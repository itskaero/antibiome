// Quality improvement: local protocols as measurable rules, adherence vs target, run charts and
// case lists for review. Monitoring of practice — never a recommendation for an individual patient.
import { useEffect, useState } from 'react';
import { ClipboardList, Pencil, Plus, Target, Trash2 } from 'lucide-react';
import { call } from '@/lib/api';
import { go, useApi } from '@/lib/hooks';
import { cx } from '@/lib/format';
import { Button, CardHeader, Chip, Empty, ErrorNote, Field, Modal, PageHeader, Toggle, useToast } from '@/components/ui';
import { TrendLine } from '@/components/charts';
import { ContinuousTabs } from '@/vendor/watermelon/continuous-tabs';
import { ConditionRow, Conditions, FieldSelect } from './Explorer';
import type { Condition, ExplorerField } from '@shared/explorer';
import type { Protocol, ProtocolResult, Rule } from '@shared/protocols';
import { fmtMonth } from '@shared/time';

type ListedProtocol = Protocol & { ruleText: Record<string, string>; eligibilityText: string };

export function Protocols({ isAdmin, canSeeCases }: { isAdmin: boolean; canSeeCases: boolean }) {
  const list = useApi<{ protocols: ListedProtocol[]; timePoints: Record<string, string> }>('protocols.list');
  const results = useApi<ProtocolResult[]>('protocols.results');
  const [selected, setSelected] = useState<string>('');
  const [editor, setEditor] = useState<{ open: boolean; p?: ListedProtocol }>({ open: false });
  const protos = list.data?.protocols ?? [];
  useEffect(() => { if (!selected && results.data?.[0]) setSelected(results.data[0].protocol.id); }, [results.data, selected]);
  const r = results.data?.find(x => x.protocol.id === selected);
  const listed = protos.find(p => p.id === selected);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon={<ClipboardList className="text-accent-ink" size={22} />} title="Protocols & quality"
        subtitle="Local protocols written as measurable rules. Adherence is measured against unit targets to guide quality improvement — it is not a judgement on individual care."
        actions={isAdmin && <Button variant="primary" onClick={() => setEditor({ open: true })}><Plus size={16} />New protocol</Button>} />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {(results.data ?? []).map(x => (
          <button key={x.protocol.id} onClick={() => setSelected(x.protocol.id)} className={cx('card p-4 text-left transition hover:border-line-2', selected === x.protocol.id && 'ring-1 ring-accent')}>
            <p className="truncate text-[13.5px] font-medium">{x.protocol.name}</p>
            <div className="mt-2 flex items-end justify-between">
              <span className="tnum text-[26px] font-semibold">{x.bundle.pct != null ? `${Math.round(x.bundle.pct)}%` : '—'}</span>
              <span className="text-right text-[11.5px] text-ink-3">{x.protocol.rules.length > 1 ? 'all elements met' : 'met'}<br />{x.bundle.met}/{x.bundle.evaluable} · {x.eligible} eligible</span>
            </div>
            <div className="mt-2 flex gap-1">
              {x.rules.map(rr => <span key={rr.id} title={`${rr.label}: ${rr.pct != null ? Math.round(rr.pct) : '—'}% (target ${rr.target}%)`}
                className={cx('h-1.5 flex-1 rounded-full', rr.pct == null ? 'bg-panel-3' : rr.pct >= rr.target ? 'bg-good' : rr.pct >= rr.target - 15 ? 'bg-warn' : 'bg-crit')} />)}
            </div>
          </button>
        ))}
      </div>

      {r && listed && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.4fr_1fr]">
          <div className="card p-5">
            <CardHeader title={r.protocol.name} info={r.protocol.description ?? undefined}
              right={isAdmin && <Button size="sm" variant="ghost" onClick={() => setEditor({ open: true, p: listed })}><Pencil size={13} />Edit</Button>} />
            <p className="mb-4 text-[12.5px] text-ink-3">Applies to: {listed.eligibilityText}</p>
            <div className="flex flex-col gap-4">
              {r.rules.map(rr => {
                const rule = r.protocol.rules.find(x => x.id === rr.id)!;
                const ok = rr.pct != null && rr.pct >= rr.target;
                return (
                  <div key={rr.id}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[13.5px] font-medium">{rr.label}</span>
                      <span className={cx('tnum text-[15px] font-semibold', rr.pct == null ? 'text-ink-3' : ok ? 'text-good-ink' : 'text-warn-ink')}>{rr.pct != null ? `${Math.round(rr.pct)}%` : '—'}</span>
                    </div>
                    <p className="text-[11.5px] text-ink-3">{listed.ruleText[rr.id]}{rule.kind === 'implies' ? ' (only where the condition applies)' : ''}</p>
                    <div className="relative mt-1.5 h-2.5 rounded-full bg-panel-2">
                      <div className={cx('h-full rounded-full', ok ? 'bg-good' : 'bg-warn')} style={{ width: `${rr.pct ?? 0}%` }} />
                      <span className="absolute -top-1 h-[18px] w-0.5 rounded bg-ink" style={{ left: `${rr.target}%` }} title={`Target ${rr.target}%`} />
                    </div>
                    <p className="mt-1 text-[11.5px] text-ink-3">
                      {rr.met} met · {rr.notMet} not met{rr.notRecorded ? ` · ${rr.notRecorded} not recorded (excluded)` : ''}{rr.notApplicable ? ` · ${rr.notApplicable} not applicable` : ''} · target {rr.target}%
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="card p-5">
              <CardHeader title="Run chart · all elements met" info="Monthly bundle adherence by admission month. Look for sustained shifts (6+ points one side of the median) rather than single months." />
              <TrendLine data={r.monthly.map(m => ({ x: fmtMonth(m.month).split(' ')[0], y: m.bundlePct != null ? Math.round(m.bundlePct) : null }))} name="Adherence" fmt={v => `${Math.round(v)}%`} domain={[0, 100]} height={180} />
              <p className="mt-1 text-[11.5px] text-ink-3">Eligible per month: {r.monthly.map(m => m.eligible).join(' · ')}</p>
            </div>
            {canSeeCases && (
              <div className="card p-5">
                <CardHeader title="Cases for review" info="Admissions where an element was not met or not recorded — for case review and documentation, not blame." right={<Chip>{r.failures.length}</Chip>} />
                <div className="scroll-thin flex max-h-80 flex-col divide-y divide-line overflow-y-auto">
                  {r.failures.slice(0, 60).map(f => (
                    <button key={f.id} onClick={() => go(`patient/${f.id}`)} className="flex flex-col py-2 text-left hover:text-accent-ink">
                      <span className="text-[13px]">{f.label} <span className="text-[11.5px] text-ink-3">· {f.admitAt.slice(0, 10)}</span></span>
                      {!!f.failed.length && <span className="text-[11.5px] text-warn-ink">Not met: {f.failed.join(', ')}</span>}
                      {!!f.notRecorded.length && <span className="text-[11.5px] text-ink-3">Not recorded: {f.notRecorded.join(', ')}</span>}
                    </button>
                  ))}
                  {!r.failures.length && <Empty title="Every eligible case met every element" />}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {!results.data?.length && <div className="card"><Empty icon={<Target size={18} />} title="No active protocols" /></div>}

      {list.data && <ProtocolEditor open={editor.open} p={editor.p} timePoints={list.data.timePoints} onClose={() => setEditor({ open: false })} onSaved={id => setSelected(id)} />}
    </div>
  );

}

// ── Editor ───────────────────────────────────────────────────

const newRule = (): Rule => ({ id: '', label: '', kind: 'condition', condition: { field: '', op: 'exists' } as Condition, target: 90, missing: 'exclude' });

function ProtocolEditor({ open, p, timePoints, onClose, onSaved }: { open: boolean; p?: ListedProtocol; timePoints: Record<string, string>; onClose: () => void; onSaved: (id: string) => void }) {
  const { data: fields } = useApi<ExplorerField[]>(open ? 'explorer.fields' : null);
  const [name, setName] = useState(''); const [description, setDescription] = useState('');
  const [eligibility, setEligibility] = useState<Condition[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [active, setActive] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => {
    if (!open) return;
    setName(p?.name ?? ''); setDescription(p?.description ?? ''); setEligibility(p?.eligibility ?? []); setRules(p?.rules ?? [newRule()]); setActive(p?.active ?? true); setErr(null);
  }, [open, p]);
  const setRule = (i: number, r: Rule) => setRules(rules.map((x, j) => (j === i ? r : x)));
  const save = async () => {
    try { const r = await call<{ id: string }>('protocols.save', { id: p?.id, name, description, eligibility, rules, active }); toast('Protocol saved'); onSaved(r.id); onClose(); }
    catch (e: any) { setErr(e.message); }
  };
  const remove = async () => {
    if (!p || !confirm(`Delete "${p.name}"?`)) return;
    try { await call('protocols.delete', { id: p.id }); toast('Protocol deleted'); onClose(); } catch (e: any) { toast(e.message, 'crit'); }
  };
  if (!fields) return null;
  const condFor = (c: Condition | undefined, onChange: (c: Condition) => void) =>
    c && c.field ? <ConditionRow c={c} fields={fields} onChange={onChange} onRemove={() => onChange({ field: '', op: 'exists' })} />
      : <FieldSelect fields={fields} kinds={['number', 'boolean', 'category', 'set']} value="" placeholder="Choose a field…"
          onChange={id => { const f = fields.find(x => x.id === id); if (f) onChange({ field: id, op: f.kind === 'boolean' ? 'is_true' : f.kind === 'number' ? 'gte' : f.kind === 'set' ? 'includes_any' : 'in', value: f.kind === 'number' ? 0 : f.kind === 'boolean' ? undefined : [] }); }} />;

  return (
    <Modal open={open} onClose={onClose} width={860} title={p ? `Edit “${p.name}”` : 'New protocol'}
      subtitle="Write each element so it can be measured from what is already recorded."
      footer={<>
        {p && !p.builtIn && <Button variant="danger" size="sm" className="mr-auto" onClick={remove}><Trash2 size={13} />Delete</Button>}
        <Toggle checked={active} onChange={setActive} label={active ? 'Active' : 'Inactive'} />
        <Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save protocol</Button>
      </>}>
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Name"><input className="field" value={name} onChange={e => setName(e.target.value)} /></Field>
          <Field label="Description"><input className="field" value={description} onChange={e => setDescription(e.target.value)} /></Field>
        </div>
        <Conditions title="Applies to admissions where (empty = all)" list={eligibility} fields={fields} onChange={setEligibility} />
        <div className="flex flex-col gap-3">
          <p className="text-[11.5px] font-medium tracking-wide text-ink-3 uppercase">Elements</p>
          {rules.map((r, i) => (
            <div key={i} className="rounded-2xl border border-line p-4">
              <div className="mb-3 grid grid-cols-[1fr_auto_auto] items-end gap-2">
                <Field label="Element"><input className="field h-9" value={r.label} placeholder="e.g. Antibiotic within 60 minutes" onChange={e => setRule(i, { ...r, label: e.target.value })} /></Field>
                <Field label="Target %"><input className="field h-9 w-20 tnum" type="number" min={0} max={100} value={r.target} onChange={e => setRule(i, { ...r, target: Number(e.target.value) })} /></Field>
                <button onClick={() => setRules(rules.filter((_, j) => j !== i))} className="mb-2 p-1 text-ink-3 hover:text-crit-ink" aria-label="Remove element"><Trash2 size={14} /></button>
              </div>
              <ContinuousTabs tabs={[{ id: 'condition', label: 'Condition' }, { id: 'time_to', label: 'Time window' }, { id: 'implies', label: 'If … then …' }]} value={r.kind}
                onChange={k => setRule(i, k === 'time_to' ? { id: r.id, label: r.label, target: r.target, missing: r.missing, kind: 'time_to', anchor: 'admission', event: 'first_abx', withinMinutes: 60 }
                  : k === 'implies' ? { id: r.id, label: r.label, target: r.target, missing: r.missing, kind: 'implies', if: { field: '', op: 'exists' }, then: { field: '', op: 'exists' } }
                  : { id: r.id, label: r.label, target: r.target, missing: r.missing, kind: 'condition', condition: { field: '', op: 'exists' } })} />
              <div className="mt-3">
                {r.kind === 'condition' && condFor(r.condition, c => setRule(i, { ...r, condition: c }))}
                {r.kind === 'implies' && (
                  <div className="flex flex-col gap-2">
                    <span className="text-[12px] text-ink-3">If</span>{condFor(r.if, c => setRule(i, { ...r, if: c }))}
                    <span className="text-[12px] text-ink-3">then</span>{condFor(r.then, c => setRule(i, { ...r, then: c }))}
                  </div>
                )}
                {r.kind === 'time_to' && (
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_120px_1fr]">
                    <Field label="Event"><select className="field h-9" value={r.event} onChange={e => setRule(i, { ...r, event: e.target.value })}>{Object.entries(timePoints).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                    <Field label="Within (min)"><input className="field h-9 tnum" type="number" min={0} value={r.withinMinutes} onChange={e => setRule(i, { ...r, withinMinutes: Number(e.target.value) })} /></Field>
                    <Field label="Of"><select className="field h-9" value={r.anchor} onChange={e => setRule(i, { ...r, anchor: e.target.value })}>{Object.entries(timePoints).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                  </div>
                )}
              </div>
              <label className="mt-3 flex items-center gap-2 text-[12px] text-ink-2">
                <input type="checkbox" checked={r.missing === 'fail'} onChange={e => setRule(i, { ...r, missing: e.target.checked ? 'fail' : 'exclude' })} />
                Count “not recorded” as not met (otherwise those cases are excluded and shown separately)
              </label>
            </div>
          ))}
          <Button size="sm" onClick={() => setRules([...rules, newRule()])}><Plus size={13} />Add element</Button>
        </div>
        <ErrorNote text={err} />
      </div>
    </Modal>
  );
}
