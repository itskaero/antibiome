// Schema-driven rendering of module parameters: one input per type, used by the admission sheet,
// the discharge dialog and the patient page. Nothing here knows about specific diseases.
import { useEffect, useMemo, useState } from 'react';
import { History, Layers, Plus, Sparkles, Trash2 } from 'lucide-react';
import { call } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { cx } from '@/lib/format';
import { Button, CardHeader, ChoiceChips, Chip, SegmentMeter, useToast } from '@/components/ui';
import { DERIVED, isVisible, moduleApplies, type ModuleDef, type ParamDef, type ParamValue, type StoredValue } from '@shared/modules';
import { fmtDateTime, nowLocal } from '@shared/time';

// ── Single input ─────────────────────────────────────────────

export function ParamInput({ def, value, onCommit, compact }: { def: ParamDef; value: ParamValue | undefined; onCommit: (v: ParamValue | null) => void; compact?: boolean }) {
  const [draft, setDraft] = useState<string>(value === undefined ? '' : String(value));
  useEffect(() => { setDraft(value === undefined ? '' : String(value)); }, [value]);
  const commitText = () => {
    const t = draft.trim();
    if (t === (value === undefined ? '' : String(value))) return;
    onCommit(t === '' ? null : def.type === 'number' ? Number(t) : t);
  };
  const keyCommit = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLElement).blur(); } };

  switch (def.type) {
    case 'number':
      return (
        <div className="relative w-40">
          <input className={cx('field tnum', def.unit && 'pr-16', compact && 'h-8')} type="number" step={def.decimals ? 10 ** -def.decimals : 1}
            min={def.min ?? undefined} max={def.max ?? undefined} value={draft} placeholder={def.min != null && def.max != null ? `${def.min}–${def.max}` : ''}
            onChange={e => setDraft(e.target.value)} onBlur={commitText} onKeyDown={keyCommit} />
          {def.unit && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[11.5px] text-ink-3">{def.unit}</span>}
        </div>
      );
    case 'boolean':
      return <ChoiceChips size="sm" options={['Yes', 'No'] as const} value={value === undefined ? null : value ? 'Yes' : 'No'}
        onChange={(v: string) => onCommit((value === true && v === 'Yes') || (value === false && v === 'No') ? null : v === 'Yes')} />;
    case 'choice':
      return def.options.length > 7
        ? <select className={cx('field', compact && 'h-8')} value={typeof value === 'string' ? value : ''} onChange={e => onCommit(e.target.value || null)}>
            <option value="">—</option>{def.options.map(o => <option key={o}>{o}</option>)}
          </select>
        : <ChoiceChips size="sm" options={def.options} value={typeof value === 'string' ? value : null} onChange={(v: string) => onCommit(v === value ? null : v)} />;
    case 'multi':
      return <ChoiceChips size="sm" multi options={def.options} value={Array.isArray(value) ? value : []} onChange={(v: string[]) => onCommit(v.length ? v : null)} />;
    case 'date':
    case 'datetime':
      return <input className={cx('field w-56', compact && 'h-8')} type={def.type === 'date' ? 'date' : 'datetime-local'} value={draft}
        onChange={e => setDraft(e.target.value)} onBlur={commitText} />;
    case 'text':
      return <input className={cx('field', compact && 'h-8')} value={draft} maxLength={300} onChange={e => setDraft(e.target.value)} onBlur={commitText} onKeyDown={keyCommit}
        placeholder="Avoid identifying details" />;
  }
}

export function FieldRow({ def, children, missing }: { def: ParamDef; children: React.ReactNode; missing?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(160px,220px)_1fr] items-start gap-3 py-2">
      <div className="pt-1.5">
        <p className="text-[13px] leading-tight">{def.label}{def.required && <span className={missing ? 'text-warn-ink' : 'text-accent-ink'}> *</span>}</p>
        {def.help && <p className="mt-0.5 text-[11px] leading-snug text-ink-3">{def.help}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}

// ── Form section for admit / discharge (values held by the caller) ──

/** Values keyed by paramId → keyed by key, for showIf. */
const byKey = (m: ModuleDef, values: Record<string, ParamValue | undefined>) => Object.fromEntries(m.params.map(p => [p.key, values[p.id]]));

export function ModuleFormSection({ modules, stages, values, onChange, title, onlyMissingRequired }: {
  modules: ModuleDef[]; stages: ParamDef['capture'][]; values: Record<string, ParamValue | undefined>;
  onChange: (paramId: string, v: ParamValue | null) => void; title?: string; onlyMissingRequired?: boolean;
}) {
  const sections = modules.map(m => ({
    m, params: m.params.filter(p => !p.retiredAt && stages.includes(p.capture) && isVisible(p, byKey(m, values)) && (!onlyMissingRequired || p.capture !== 'any' || (p.required && values[p.id] === undefined))),
  })).filter(s => s.params.length);
  if (!sections.length) return null;
  return (
    <div className="flex flex-col gap-3">
      {sections.map(({ m, params }) => (
        <div key={m.id} className="rounded-2xl border border-accent/25 bg-accent-soft/30 p-4">
          <p className="mb-1 flex items-center gap-2 text-[12.5px] font-semibold text-accent-ink"><Layers size={14} />{title ?? m.label} module</p>
          <div className="divide-y divide-line">
            {params.map(p => (
              <FieldRow key={p.id} def={p} missing={p.required && values[p.id] === undefined}>
                <ParamInput def={p} compact value={values[p.id]} onCommit={v => onChange(p.id, v)} />
              </FieldRow>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Active modules for a diagnosis set (admission sheet, before the admission exists). */
export function useApplicableModules(primaryDx: string | null, secondaryDx: string[]) {
  const { data } = useApi<{ modules: ModuleDef[] }>('modules.list');
  return useMemo(() => (primaryDx ? (data?.modules ?? []).filter(m => moduleApplies(m, { primaryDx, secondaryDx })) : []), [data, primaryDx, secondaryDx]);
}

// ── Patient page panel ───────────────────────────────────────

interface ForAdmission {
  module: ModuleDef; stored: StoredValue[]; derived: Record<string, number | boolean | null>;
  completion: { asked: number; filled: number; required: number; requiredFilled: number }; notCollected: string[];
}

const fmtDerived = (id: string, v: number | boolean | null) => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const d = DERIVED[id];
  if (d?.unit === 'min') return v >= 120 || v <= -120 ? `${(v / 60).toFixed(1)} h` : `${v} min`;
  return `${v}${d?.unit ? ` ${d.unit}` : ''}`;
};

export function ModulesPanel({ admissionId, canEdit }: { admissionId: string; canEdit: boolean }) {
  const { data } = useApi<ForAdmission[]>('values.forAdmission', { admissionId });
  if (!data?.length) return null;
  return <>{data.map(d => <ModuleCard key={d.module.id} d={d} admissionId={admissionId} canEdit={canEdit} />)}</>;
}

function ModuleCard({ d, admissionId, canEdit }: { d: ForAdmission; admissionId: string; canEdit: boolean }) {
  const toast = useToast();
  const [backfill, setBackfill] = useState(false);
  const m = d.module;
  const latest = useMemo(() => {
    const out: Record<string, ParamValue | undefined> = {};
    m.params.forEach(p => { const vs = d.stored.filter(v => v.paramId === p.id); if (vs.length) out[p.key] = vs[vs.length - 1].value; });
    return out;
  }, [d, m.params]);
  const save = async (p: ParamDef, value: ParamValue | null, recordedAt?: string) => {
    try { await call('values.set', { admissionId, paramId: p.id, value, recordedAt }); } catch (e: any) { toast(e.message, 'crit'); }
  };
  const visible = m.params.filter(p => (backfill || !d.notCollected.includes(p.key)) && isVisible(p, latest));
  const groups = (['admission', 'any', 'discharge', 'daily'] as const).map(stage => ({ stage, params: visible.filter(p => p.capture === stage) })).filter(g => g.params.length);
  const pct = d.completion.required ? Math.round((d.completion.requiredFilled / d.completion.required) * 100) : 100;
  const STAGE = { admission: 'On admission', any: 'During the stay', discharge: 'At discharge', daily: 'Repeated measurements' };

  return (
    <div className="card p-5">
      <CardHeader title={<span className="flex items-center gap-2"><Layers size={15} className="text-accent-ink" />{m.label}</span>} info={m.description ?? undefined}
        right={<span className="flex items-center gap-2 text-[12px] text-ink-3"><SegmentMeter pct={pct} segments={8} tone={pct === 100 ? 'good' : 'warn'} />{d.completion.requiredFilled}/{d.completion.required} required</span>} />

      {!!m.derived.length && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {m.derived.map(id => DERIVED[id] && (
            <span key={id} title="Derived automatically from the core record" className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-panel-2 px-2.5 text-[12px] text-ink-2">
              <Sparkles size={11} className="text-ink-3" />{DERIVED[id].label}: <b className="font-semibold text-ink">{fmtDerived(id, d.derived[id])}</b>
            </span>
          ))}
        </div>
      )}

      {groups.map(g => (
        <div key={g.stage} className="mb-2">
          <p className="mt-2 text-[11px] font-semibold tracking-wider text-ink-3 uppercase">{STAGE[g.stage]}</p>
          <div className="divide-y divide-line">
            {g.params.map(p => (
              <FieldRow key={p.id} def={p} missing={p.required && latest[p.key] === undefined}>
                {p.capture === 'daily'
                  ? <Series def={p} stored={d.stored.filter(v => v.paramId === p.id)} canEdit={canEdit} onAdd={(v, at) => save(p, v, at)} />
                  : canEdit && !p.retiredAt
                    ? <ParamInput def={p} value={latest[p.key]} onCommit={v => save(p, v)} />
                    : <span className="text-[13px] text-ink-2">{latest[p.key] === undefined ? '—' : Array.isArray(latest[p.key]) ? (latest[p.key] as string[]).join(', ') : String(latest[p.key])}{p.unit ? ` ${p.unit}` : ''}</span>}
                {p.retiredAt && <span className="ml-2 text-[11px] text-ink-3">retired field</span>}
              </FieldRow>
            ))}
          </div>
        </div>
      ))}

      {!!d.notCollected.length && (
        <button onClick={() => setBackfill(!backfill)} className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-3 hover:text-ink">
          <History size={13} />{backfill ? 'Hide' : 'Show'} {d.notCollected.length} field{d.notCollected.length === 1 ? '' : 's'} added after this admission{backfill ? '' : ' (back-fill)'}
        </button>
      )}
    </div>
  );
}

function Series({ def, stored, canEdit, onAdd }: { def: ParamDef; stored: StoredValue[]; canEdit: boolean; onAdd: (v: ParamValue, at: string) => void }) {
  const [at, setAt] = useState(nowLocal());
  const [v, setV] = useState<ParamValue | undefined>(undefined);
  const toast = useToast();
  return (
    <div className="flex flex-col gap-1.5">
      {stored.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {stored.map(s => (
            <Chip key={s.id} className="group pr-1">
              <span className="tnum font-semibold text-ink">{Array.isArray(s.value) ? s.value.join(', ') : typeof s.value === 'boolean' ? (s.value ? 'Yes' : 'No') : String(s.value)}</span>
              <span className="text-ink-3">{fmtDateTime(s.recordedAt)}</span>
              {canEdit && <button aria-label="Remove" className="grid h-5 w-5 place-items-center rounded-full opacity-0 group-hover:opacity-100 hover:text-crit-ink"
                onClick={async () => { try { await call('values.delete', { id: s.id }); } catch (e: any) { toast(e.message, 'crit'); } }}><Trash2 size={11} /></button>}
            </Chip>
          ))}
        </div>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <ParamInput def={{ ...def, capture: 'any' }} compact value={v} onCommit={x => setV(x ?? undefined)} />
          <input type="datetime-local" className="field h-8 w-52" value={at} onChange={e => setAt(e.target.value)} />
          <Button size="sm" disabled={v === undefined} onClick={() => { if (v !== undefined) { onAdd(v, at); setV(undefined); setAt(nowLocal()); } }}><Plus size={13} />Add</Button>
        </div>
      )}
      {!stored.length && !canEdit && <span className="text-[13px] text-ink-3">No measurements</span>}
    </div>
  );
}
