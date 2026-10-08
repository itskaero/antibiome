// Daily reconcile — one grid for the whole unit (~1 minute). Toggle what is true now; the server
// opens/closes episodes, which yields ventilator-days, vasoactive-days and DOT without per-patient forms.
import { useEffect, useMemo, useState } from 'react';
import { CheckCheck, ListChecks, X } from 'lucide-react';
import { call } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { cx } from '@/lib/format';
import { Button, Chip, Empty, Field, PageHeader, RespSegment, useToast } from '@/components/ui';
import { PRESCRIBABLE_ANTIMICROBIALS, VASOACTIVES, dxLabel, type RespLevel } from '@shared/reference';
import { nowLocal } from '@shared/time';
import type { CensusRow } from './types';

interface Draft { resp: RespLevel; vaso: string[]; abx: string[] }

export function Reconcile({ canEdit }: { canEdit: boolean }) {
  const { data } = useApi<{ rows: CensusRow[] }>('census.list');
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [at, setAt] = useState(nowLocal());
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const original = useMemo(() => Object.fromEntries((data?.rows ?? []).map(r => [r.admission.id, {
    resp: r.resp.level, vaso: r.vaso.map(v => v.agent).sort(), abx: r.abx.map(a => a.drug).sort(),
  }])) as Record<string, Draft>, [data]);
  useEffect(() => { setDraft(structuredClone(original)); }, [original]);

  const changed = (id: string) => {
    const a = draft[id], b = original[id];
    return !!a && !!b && (a.resp !== b.resp || [...a.vaso].sort().join() !== b.vaso.join() || [...a.abx].sort().join() !== b.abx.join());
  };
  const rows = data?.rows ?? [];
  const nChanged = rows.filter(r => changed(r.admission.id)).length;
  const upd = (id: string, patch: Partial<Draft>) => setDraft(s => ({ ...s, [id]: { ...s[id], ...patch } }));

  const apply = async () => {
    setSaving(true);
    try {
      const payload = rows.filter(r => changed(r.admission.id)).map(r => ({ admissionId: r.admission.id, ...draft[r.admission.id] }));
      const res = await call<{ changes: number }>('reconcile.apply', { at, rows: payload });
      toast(res.changes ? `Reconciled — ${res.changes} change${res.changes === 1 ? '' : 's'} recorded` : 'Reconciled — no changes');
      setAt(nowLocal());
    } catch (e: any) { toast(e.message, 'crit'); } finally { setSaving(false); }
  };

  if (!data) return null;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon={<ListChecks className="text-accent-ink" size={22} />} title="Daily reconcile"
        subtitle="Once a day (and whenever things change): confirm support, vasoactives and antimicrobials for every patient. Unchanged rows need no action."
        chips={<><Chip tone="accent" dot>{rows.length} patients</Chip>{nChanged > 0 && <Chip tone="warn">{nChanged} edited</Chip>}</>}
        actions={canEdit && <>
          <Field label="Changes take effect at"><input type="datetime-local" className="field h-9 w-52" value={at} onChange={e => setAt(e.target.value)} /></Field>
          <Button variant="ghost" onClick={() => setDraft(structuredClone(original))} disabled={!nChanged}>Reset</Button>
          <Button variant="primary" onClick={apply} disabled={saving}><CheckCheck size={16} />{nChanged ? `Apply ${nChanged} change${nChanged === 1 ? '' : 's'}` : 'Confirm all unchanged'}</Button>
        </>} />

      {!rows.length ? <div className="card"><Empty title="No patients in the unit" /></div> : (
        <div className="card overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-panel-2/60 text-left text-[11.5px] text-ink-3">
              <tr>{['Bed', 'Patient', 'Respiratory support', 'Vasoactives', 'Antimicrobials'].map(h => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const id = r.admission.id, dft = draft[id];
                if (!dft) return null;
                return (
                  <tr key={id} className={cx('border-t border-line align-top', changed(id) && 'bg-accent-soft/40')}>
                    <td className="tnum px-4 py-3 font-semibold">{r.admission.bed ?? '—'}</td>
                    <td className="px-4 py-3"><div className="font-medium">{dxLabel(r.admission.primaryDx)}</div><div className="text-[11.5px] text-ink-3">{r.name ?? r.label}</div></td>
                    <td className="px-4 py-3"><RespSegment value={dft.resp} onChange={l => upd(id, { resp: l })} disabled={!canEdit} /></td>
                    <td className="px-4 py-3"><DrugCell values={dft.vaso} options={VASOACTIVES} onChange={v => upd(id, { vaso: v })} disabled={!canEdit} tone="accent" /></td>
                    <td className="px-4 py-3"><DrugCell values={dft.abx} options={PRESCRIBABLE_ANTIMICROBIALS} onChange={v => upd(id, { abx: v })} disabled={!canEdit} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11.5px] text-ink-3">Exact start/stop times can be corrected on each patient's timeline. Stopping and restarting the same agent creates a new course.</p>
    </div>
  );
}

function DrugCell({ values, options, onChange, disabled, tone }: { values: string[]; options: string[]; onChange: (v: string[]) => void; disabled?: boolean; tone?: 'accent' }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {values.map(v => (
        <span key={v} className={cx('inline-flex h-7 items-center gap-1 rounded-full pr-1 pl-2.5 text-[12px]', tone === 'accent' ? 'bg-accent-soft text-accent-ink' : 'bg-panel-3 text-ink')}>
          {v}
          {!disabled && <button onClick={() => onChange(values.filter(x => x !== v))} className="grid h-5 w-5 place-items-center rounded-full hover:bg-black/20" aria-label={`Stop ${v}`}><X size={11} /></button>}
        </span>
      ))}
      {!disabled && (
        <select className="h-7 w-[76px] rounded-full border border-dashed border-line-2 bg-transparent px-2.5 text-[12px] text-ink-3 outline-none hover:text-ink" value=""
          onChange={e => e.target.value && onChange([...values, e.target.value])}>
          <option value="">+ add</option>
          {options.filter(o => !values.includes(o)).map(o => <option key={o}>{o}</option>)}
        </select>
      )}
      {!values.length && disabled && <span className="text-ink-3">—</span>}
    </div>
  );
}
