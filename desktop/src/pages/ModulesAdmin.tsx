// Admin: build and maintain disease modules and their fields — no code changes, full version history.
import { useEffect, useState } from 'react';
import { Archive, Layers, Lock, Pencil, Plus, RotateCcw, Sparkles } from 'lucide-react';
import { call } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { cx } from '@/lib/format';
import { Button, CardHeader, ChoiceChips, Chip, Empty, ErrorNote, Field, Modal, PageHeader, Toggle, useToast } from '@/components/ui';
import { DxPicker } from '@/components/DxPicker';
import { ParamInput } from '@/components/ModuleFields';
import { CAPTURE_LABEL, CAPTURE_STAGES, PARAM_TYPES, PARAM_TYPE_LABEL, slugify, type ModuleDef, type ParamDef, type ParamValue } from '@shared/modules';
import { dxLabel } from '@shared/reference';
import { toDateStr } from '@shared/time';

type AdminModule = ModuleDef & { valueCounts: Record<string, number> };
interface DerivedInfo { id: string; label: string; kind: string; unit?: string; needs?: string }

export function ModulesAdmin({ isAdmin }: { isAdmin: boolean }) {
  const { data } = useApi<{ modules: AdminModule[]; derived: DerivedInfo[] }>('modules.list');
  const [selected, setSelected] = useState<string | null>(null);
  const [newModule, setNewModule] = useState(false);
  const [field, setField] = useState<{ open: boolean; def?: ParamDef }>({ open: false });
  const toast = useToast();
  const modules = data?.modules ?? [];
  const m = modules.find(x => x.id === selected) ?? modules[0];
  useEffect(() => { if (!selected && modules[0]) setSelected(modules[0].id); }, [modules, selected]);

  const retire = async (p: ParamDef, retired: boolean) => {
    if (retired && !confirm(`Retire "${p.label}"? It stops being asked; existing data is kept and still exported.`)) return;
    try { await call('params.retire', { id: p.id, retired }); toast(retired ? 'Field retired' : 'Field restored'); } catch (e: any) { toast(e.message, 'crit'); }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon={<Layers className="text-accent-ink" size={22} />} title="Modules & fields"
        subtitle="Disease-specific fields appear only for the diagnoses that trigger them. Add or change fields here — no software update needed."
        chips={<><Chip>{modules.filter(x => x.active).length} active modules</Chip><Chip>{modules.reduce((s, x) => s + x.params.filter(p => !p.retiredAt).length, 0)} fields</Chip></>}
        actions={isAdmin && <Button variant="primary" onClick={() => setNewModule(true)}><Plus size={16} />New module</Button>} />

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[300px_1fr]">
        <div className="flex flex-col gap-2">
          {modules.map(x => (
            <button key={x.id} onClick={() => setSelected(x.id)}
              className={cx('card p-4 text-left transition hover:border-line-2', m?.id === x.id && 'ring-1 ring-accent', !x.active && 'opacity-60')}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{x.label}</span>
                {x.builtIn ? <Chip>Built-in</Chip> : <Chip tone="accent">Custom</Chip>}
              </div>
              <p className="mt-1 text-[12px] text-ink-3">{x.triggerDx.length ? x.triggerDx.map(dxLabel).join(', ') : 'Every admission'}</p>
              <p className="mt-1 text-[11.5px] text-ink-3">{x.params.filter(p => !p.retiredAt).length} fields · {x.derived.length} derived{!x.active ? ' · inactive' : ''}</p>
            </button>
          ))}
        </div>

        {m ? (
          <div className="flex flex-col gap-3">
            <ModuleSettings key={m.id} m={m} derived={data?.derived ?? []} isAdmin={isAdmin} />
            <div className="card p-5">
              <CardHeader title="Fields" info="Required fields are tracked on the data-quality page. Each field remembers when it was introduced, so earlier admissions are reported as “not collected” rather than “no”."
                right={isAdmin && <Button size="sm" variant="primary" onClick={() => setField({ open: true })}><Plus size={14} />Add field</Button>} />
              {!m.params.length ? <Empty title="No fields yet" /> : (
                <table className="w-full text-[13px]">
                  <thead className="text-left text-[11.5px] text-ink-3">
                    <tr>{['Field', 'Type', 'Captured', 'Since', 'Data', ''].map(h => <th key={h} className="pb-2 font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {m.params.map(p => (
                      <tr key={p.id} className={cx('border-t border-line', p.retiredAt && 'opacity-50')}>
                        <td className="py-2.5 pr-3">
                          <div className="font-medium">{p.label}{p.required && <span className="text-accent-ink"> *</span>}</div>
                          <div className="font-mono text-[11px] text-ink-3">{m.id}__{p.key}{p.version > 1 && ` · v${p.version}`}{p.showIf && ` · shown if ${p.showIf.param}${p.showIf.includes ? ` ∋ ${p.showIf.includes}` : p.showIf.equals !== undefined ? ` = ${p.showIf.equals}` : ''}`}</div>
                        </td>
                        <td className="py-2.5 pr-3 text-ink-2">
                          {PARAM_TYPE_LABEL[p.type]}{p.unit && ` · ${p.unit}`}{p.min != null || p.max != null ? ` · ${p.min ?? ''}–${p.max ?? ''}` : ''}
                          {!!p.options.length && <div className="max-w-[260px] truncate text-[11.5px] text-ink-3">{p.options.join(' · ')}</div>}
                        </td>
                        <td className="py-2.5 pr-3 text-ink-2">{CAPTURE_LABEL[p.capture]}</td>
                        <td className="tnum py-2.5 pr-3 text-ink-3">{p.introducedAt === '2000-01-01' ? 'start' : p.introducedAt}{p.retiredAt && <div>retired {p.retiredAt}</div>}</td>
                        <td className="tnum py-2.5 pr-3 text-ink-2">{m.valueCounts[p.id] ?? 0}</td>
                        <td className="py-2.5 text-right whitespace-nowrap">
                          {isAdmin && !p.retiredAt && <Button size="sm" variant="ghost" onClick={() => setField({ open: true, def: p })}><Pencil size={13} />Edit</Button>}
                          {isAdmin && (p.retiredAt
                            ? <Button size="sm" variant="ghost" onClick={() => retire(p, false)}><RotateCcw size={13} />Restore</Button>
                            : <Button size="sm" variant="ghost" onClick={() => retire(p, true)}><Archive size={13} />Retire</Button>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : <div className="card"><Empty title="No modules" /></div>}
      </div>

      <NewModuleModal open={newModule} onClose={() => setNewModule(false)} onCreated={id => setSelected(id)} />
      {m && <FieldEditor open={field.open} def={field.def} module={m} hasData={!!(field.def && m.valueCounts[field.def.id])} onClose={() => setField({ open: false })} />}
    </div>
  );
}

function ModuleSettings({ m, derived, isAdmin }: { m: AdminModule; derived: DerivedInfo[]; isAdmin: boolean }) {
  const [f, setF] = useState({ label: m.label, description: m.description ?? '', triggerDx: m.triggerDx, derived: m.derived, outcomes: m.outcomes, exposures: m.exposures, active: m.active });
  const [dx, setDx] = useState<string | null>(null);
  const toast = useToast();
  const dirty = JSON.stringify(f) !== JSON.stringify({ label: m.label, description: m.description ?? '', triggerDx: m.triggerDx, derived: m.derived, outcomes: m.outcomes, exposures: m.exposures, active: m.active });
  const exposureOptions = m.params.filter(p => ['choice', 'multi', 'boolean'].includes(p.type)).map(p => p.key);
  const outcomeOptions = [...m.params.filter(p => ['number', 'boolean'].includes(p.type)).map(p => p.key), ...f.derived];
  const labelOf = (k: string) => m.params.find(p => p.key === k)?.label ?? derived.find(d => d.id === k)?.label ?? k;
  const save = async () => { try { await call('modules.save', { id: m.id, ...f }); toast('Module saved'); } catch (e: any) { toast(e.message, 'crit'); } };

  return (
    <div className="card p-5">
      <CardHeader title={<span className="flex items-center gap-2">{m.label}{m.builtIn && <span title="Built-in — can be edited and extended"><Lock size={13} className="text-ink-3" /></span>}</span>}
        right={isAdmin && <div className="flex items-center gap-2"><Toggle checked={f.active} onChange={v => setF({ ...f, active: v })} label={f.active ? 'Active' : 'Inactive'} /><Button size="sm" variant="primary" disabled={!dirty} onClick={save}>Save module</Button></div>} />
      <fieldset disabled={!isAdmin} className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Name"><input className="field" value={f.label} onChange={e => setF({ ...f, label: e.target.value })} /></Field>
        <Field label="Description"><input className="field" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Triggered by diagnoses" hint="Primary or secondary. Leave empty to ask for every admission." className="md:col-span-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {f.triggerDx.map(c => <button key={c} type="button" onClick={() => setF({ ...f, triggerDx: f.triggerDx.filter(x => x !== c) })} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-[12px] text-accent-ink hover:bg-accent/25" title="Remove trigger">{dxLabel(c)} <span className="text-[13px] leading-none">×</span></button>)}
            {!f.triggerDx.length && <Chip>Every admission</Chip>}
            {isAdmin && <div className="w-72"><DxPicker value={dx} exclude={f.triggerDx} placeholder="Add a diagnosis…" onChange={c => { if (c) setF({ ...f, triggerDx: [...f.triggerDx, c] }); setDx(null); }} /></div>}
          </div>
        </Field>
        <Field label="Derived values (calculated, never asked)" className="md:col-span-2" hint="Computed from the core record — support episodes, antimicrobials, cultures and outcome.">
          <ChoiceChips multi size="sm" options={derived.map(d => d.id)} labels={Object.fromEntries(derived.map(d => [d.id, d.label + (d.needs ? ` (needs ${d.needs})` : '')]))}
            value={f.derived} onChange={(v: string[]) => setF({ ...f, derived: v, outcomes: f.outcomes.filter(o => m.params.some(p => p.key === o) || v.includes(o)) })} />
        </Field>
        <Field label="Exposures for research (group by)">
          {exposureOptions.length ? <ChoiceChips multi size="sm" options={exposureOptions} labels={Object.fromEntries(exposureOptions.map(k => [k, labelOf(k)]))} value={f.exposures} onChange={(v: string[]) => setF({ ...f, exposures: v })} />
            : <span className="text-[12px] text-ink-3">Add a choice or yes/no field first.</span>}
        </Field>
        <Field label="Outcomes for research">
          <ChoiceChips multi size="sm" options={outcomeOptions} labels={Object.fromEntries(outcomeOptions.map(k => [k, labelOf(k)]))} value={f.outcomes} onChange={(v: string[]) => setF({ ...f, outcomes: v })} />
        </Field>
      </fieldset>
    </div>
  );
}

function NewModuleModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [label, setLabel] = useState(''); const [triggerDx, setTrigger] = useState<string[]>([]); const [dx, setDx] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => { if (open) { setLabel(''); setTrigger([]); setErr(null); } }, [open]);
  const save = async () => {
    try {
      const r = await call<{ id: string }>('modules.save', { label, triggerDx, derived: ['mv_required', 'los_days', 'died'], outcomes: ['mv_required', 'los_days', 'died'] });
      toast('Module created — now add its fields'); onCreated(r.id); onClose();
    } catch (e: any) { setErr(e.message); }
  };
  return (
    <Modal open={open} onClose={onClose} title="New module" width={560} subtitle="E.g. “Status epilepticus”, “Dengue”, or a unit-wide QI field set (no trigger)."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Create module</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Name"><input className="field" value={label} onChange={e => setLabel(e.target.value)} autoFocus /></Field>
        <Field label="Triggered by diagnoses" hint="Leave empty for a module asked of every admission.">
          <DxPicker value={dx} exclude={triggerDx} onChange={c => { if (c) setTrigger([...triggerDx, c]); setDx(null); }} />
          <div className="flex flex-wrap gap-1.5">{triggerDx.map(c => <Chip key={c} tone="accent">{dxLabel(c)}</Chip>)}</div>
        </Field>
        <ErrorNote text={err} />
      </div>
    </Modal>
  );
}

function FieldEditor({ open, def, module, hasData, onClose }: { open: boolean; def?: ParamDef; module: ModuleDef; hasData: boolean; onClose: () => void }) {
  const blank = () => ({
    label: def?.label ?? '', key: def?.key ?? '', type: def?.type ?? 'number', capture: def?.capture ?? 'admission', required: def?.required ?? false,
    unit: def?.unit ?? '', min: def?.min?.toString() ?? '', max: def?.max?.toString() ?? '', decimals: String(def?.decimals ?? 1),
    options: (def?.options ?? []).join('\n'), help: def?.help ?? '', showParam: def?.showIf?.param ?? '', showValue: String(def?.showIf?.includes ?? def?.showIf?.equals ?? ''),
    introducedAt: toDateStr(new Date()),
  });
  const [f, setF] = useState(blank);
  const [preview, setPreview] = useState<ParamValue | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => { if (open) { setF(blank()); setErr(null); setPreview(undefined); } }, [open, def]); // eslint-disable-line react-hooks/exhaustive-deps
  const options = f.options.split('\n').map(s => s.trim()).filter(Boolean);
  const controllers = module.params.filter(p => p.id !== def?.id && ['choice', 'multi', 'boolean'].includes(p.type) && !p.retiredAt);
  const controller = controllers.find(p => p.key === f.showParam);
  // Mirrors the server's isSemanticChange(): unit, range, decimals or a removed option.
  const semantic = !!def && hasData && ((def.unit ?? '') !== f.unit.trim() || String(def.min ?? '') !== f.min || String(def.max ?? '') !== f.max
    || String(def.decimals) !== f.decimals || def.options.some(o => !options.includes(o)));

  const draftDef: ParamDef = {
    id: 'preview', moduleId: module.id, key: f.key || slugify(f.label), label: f.label || 'Preview', type: f.type, unit: f.unit || null, options,
    min: f.min === '' ? null : Number(f.min), max: f.max === '' ? null : Number(f.max), decimals: Number(f.decimals), capture: f.capture, required: f.required,
    help: f.help || null, showIf: null, sort: 0, version: 1, introducedAt: '', retiredAt: null,
  };

  const save = async () => {
    setErr(null);
    const showIf = controller ? (controller.type === 'multi' ? { param: controller.key, includes: f.showValue } : controller.type === 'boolean' ? { param: controller.key, equals: f.showValue === 'Yes' } : { param: controller.key, equals: f.showValue }) : null;
    try {
      const r = await call<{ bumped: boolean; version: number }>('params.save', {
        id: def?.id, moduleId: module.id, label: f.label, key: f.key || undefined, type: f.type, capture: f.capture, required: f.required,
        unit: f.unit, min: f.min, max: f.max, decimals: f.decimals, options, help: f.help, showIf, introducedAt: def ? undefined : f.introducedAt,
      });
      toast(r.bumped ? `Saved as version ${r.version} — earlier values keep their version` : def ? 'Field updated' : 'Field added');
      onClose();
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <Modal open={open} onClose={onClose} width={760} title={def ? `Edit “${def.label}”` : `Add a field to ${module.label}`}
      subtitle="Ask yourself first: which analysis, decision or research question needs this field?"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>{def ? 'Save field' : 'Add field'}</Button></>}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Label" className="md:col-span-2"><input className="field" value={f.label} autoFocus onChange={e => setF({ ...f, label: e.target.value })} /></Field>
        <Field label="Type" hint={def && hasData ? 'Locked: this field already has data.' : undefined}>
          <select className="field" value={f.type} disabled={!!def && hasData} onChange={e => setF({ ...f, type: e.target.value as ParamDef['type'] })}>
            {PARAM_TYPES.map(t => <option key={t} value={t}>{PARAM_TYPE_LABEL[t]}</option>)}
          </select>
        </Field>
        <Field label="Captured">
          <select className="field" value={f.capture} onChange={e => setF({ ...f, capture: e.target.value as ParamDef['capture'] })}>
            {CAPTURE_STAGES.map(c => <option key={c} value={c}>{CAPTURE_LABEL[c]}</option>)}
          </select>
        </Field>
        {!def && <Field label="Export key" hint={`Column: ${module.id}__${f.key || slugify(f.label || 'field')}. Cannot change later.`}>
          <input className="field font-mono text-[12.5px]" value={f.key} placeholder={slugify(f.label || 'field')} onChange={e => setF({ ...f, key: slugify(e.target.value) })} />
        </Field>}
        {!def && <Field label="Ask for admissions from" hint="Earlier admissions show this field as “not collected” (they can still be back-filled).">
          <input type="date" className="field" value={f.introducedAt} max={toDateStr(new Date())} onChange={e => setF({ ...f, introducedAt: e.target.value })} />
        </Field>}
        {f.type === 'number' && <>
          <Field label="Unit"><input className="field" value={f.unit} placeholder="e.g. mmol/L" onChange={e => setF({ ...f, unit: e.target.value })} /></Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Min"><input className="field tnum" type="number" value={f.min} onChange={e => setF({ ...f, min: e.target.value })} /></Field>
            <Field label="Max"><input className="field tnum" type="number" value={f.max} onChange={e => setF({ ...f, max: e.target.value })} /></Field>
            <Field label="Decimals"><input className="field tnum" type="number" min={0} max={4} value={f.decimals} onChange={e => setF({ ...f, decimals: e.target.value })} /></Field>
          </div>
        </>}
        {(f.type === 'choice' || f.type === 'multi') && (
          <Field label="Options (one per line)" className="md:col-span-2" hint={def && hasData ? 'Adding options is safe. Removing or renaming one creates a new version.' : undefined}>
            <textarea className="field" rows={5} value={f.options} onChange={e => setF({ ...f, options: e.target.value })} />
          </Field>
        )}
        <Field label="Help text" className="md:col-span-2"><input className="field" value={f.help} onChange={e => setF({ ...f, help: e.target.value })} placeholder="Definition or scale, shown under the label" /></Field>
        <Field label="Show only when">
          <select className="field" value={f.showParam} onChange={e => setF({ ...f, showParam: e.target.value, showValue: '' })}>
            <option value="">Always shown</option>
            {controllers.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </Field>
        {controller && <Field label={controller.type === 'multi' ? 'includes' : 'equals'}>
          <select className="field" value={f.showValue} onChange={e => setF({ ...f, showValue: e.target.value })}>
            <option value="">—</option>
            {(controller.type === 'boolean' ? ['Yes', 'No'] : controller.options).map(o => <option key={o}>{o}</option>)}
          </select>
        </Field>}
        <div className="flex items-end md:col-span-2"><Toggle checked={f.required} onChange={v => setF({ ...f, required: v })} label="Required (flagged on the data-quality page if missing at discharge)" /></div>

        <div className="inset md:col-span-2 p-4">
          <p className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold tracking-wider text-ink-3 uppercase"><Sparkles size={12} />Preview</p>
          <p className="mb-1.5 text-[13px]">{draftDef.label}{draftDef.required && <span className="text-accent-ink"> *</span>}</p>
          {(f.type !== 'choice' && f.type !== 'multi') || options.length ? <ParamInput def={draftDef} value={preview} onCommit={v => setPreview(v ?? undefined)} /> : <span className="text-[12px] text-ink-3">Add options to preview.</span>}
        </div>
        {semantic && <div className="md:col-span-2 rounded-xl bg-warn-soft px-3 py-2 text-[12.5px] text-warn-ink">This change alters the meaning of existing values, so it will be saved as version {(def?.version ?? 1) + 1}. Earlier values keep version {def?.version} and its definition stays on record.</div>}
        <div className="md:col-span-2"><ErrorNote text={err} /></div>
      </div>
    </Modal>
  );
}
