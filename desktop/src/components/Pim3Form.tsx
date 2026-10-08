import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { call } from '@/lib/api';
import { Button, CardHeader, Field, Toggle, useToast } from '@/components/ui';
import { PIM3_RECOVERY_LABEL, PIM3_RISKDX_HELP, PIM3_RISKDX_LABEL, pim3Risk, validatePim3, type Pim3Input, type Pim3Recovery, type Pim3RiskDx } from '@shared/pim3';

export interface Pim3Draft { pupilsFixed: boolean; elective: boolean; mvFirstHour: boolean; baseExcess: string; sbp: string; fio2: string; pao2: string; recovery: Pim3Recovery; riskDx: Pim3RiskDx }

export const pim3Draft = (x?: Partial<Pim3Input> | null, suggestion?: Partial<Pim3Input>): Pim3Draft => ({
  pupilsFixed: x?.pupilsFixed ?? false, elective: x?.elective ?? suggestion?.elective ?? false, mvFirstHour: x?.mvFirstHour ?? suggestion?.mvFirstHour ?? false,
  baseExcess: x?.baseExcess?.toString() ?? '', sbp: (x ? x.sbp : suggestion?.sbp)?.toString() ?? '',
  fio2: (x ? x.fio2 : suggestion?.fio2) != null ? String(Math.round((x ? x.fio2! : suggestion!.fio2!) * 100)) : '', pao2: x?.pao2?.toString() ?? '',
  recovery: x?.recovery ?? 'none', riskDx: x?.riskDx ?? suggestion?.riskDx ?? 'none',
});

/** Live risk for a draft, or the validation message. */
export function draftRisk(d: Pim3Draft): { risk: number } | { error: string } {
  try { return { risk: pim3Risk(validatePim3(d)) }; } catch (e: any) { return { error: e.message }; }
}

export function Pim3Fields({ d, onChange }: { d: Pim3Draft; onChange: (d: Pim3Draft) => void }) {
  const set = <K extends keyof Pim3Draft>(k: K, v: Pim3Draft[K]) => onChange({ ...d, [k]: v });
  const live = draftRisk(d);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="Systolic BP" hint="mmHg · from admission vitals if recorded · 0 if arrest, 30 if unrecordable"><input className="field tnum" type="number" value={d.sbp} placeholder="120" onChange={e => set('sbp', e.target.value)} /></Field>
        <Field label="Base excess" hint="mmol/L (art. or cap.)"><input className="field tnum" type="number" value={d.baseExcess} placeholder="0" onChange={e => set('baseExcess', e.target.value)} /></Field>
        <Field label="FiO₂ %" hint="at time of PaO₂"><input className="field tnum" type="number" value={d.fio2} placeholder="—" onChange={e => set('fio2', e.target.value)} /></Field>
        <Field label="PaO₂" hint="mmHg, arterial"><input className="field tnum" type="number" value={d.pao2} placeholder="—" onChange={e => set('pao2', e.target.value)} /></Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Toggle checked={d.pupilsFixed} onChange={v => set('pupilsFixed', v)} label="Pupils fixed to light (> 3 mm)" />
        <Toggle checked={d.mvFirstHour} onChange={v => set('mvFirstHour', v)} label="Ventilated in first hour" />
        <Toggle checked={d.elective} onChange={v => set('elective', v)} label="Elective admission" />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Recovery from procedure">
          <select className="field" value={d.recovery} onChange={e => set('recovery', e.target.value as Pim3Recovery)}>
            {Object.entries(PIM3_RECOVERY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="PIM3 diagnosis group" hint={d.riskDx !== 'none' ? PIM3_RISKDX_HELP[d.riskDx] : 'Pre-selected from the diagnosis — confirm'}>
          <select className="field" value={d.riskDx} onChange={e => set('riskDx', e.target.value as Pim3RiskDx)}>
            {Object.entries(PIM3_RISKDX_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>
      <p className="text-[12.5px] text-ink-3">
        {'risk' in live ? <>Predicted risk of death <b className="tnum text-ink">{(live.risk * 100).toFixed(1)}%</b> — for unit-level risk adjustment (SMR) only, not individual prognosis.</> : <span className="text-crit-ink">{live.error}</span>}
        {' '}Unmeasured values use PIM3 defaults.
      </p>
    </div>
  );
}

export function Pim3Card({ admissionId, saved, suggestion, canEdit }: { admissionId: string; saved: { inputs: Pim3Input; risk: number; updatedAt: string } | null; suggestion: Partial<Pim3Input>; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState(() => pim3Draft(saved?.inputs, suggestion));
  const toast = useToast();
  useEffect(() => { if (!editing) setD(pim3Draft(saved?.inputs, suggestion)); }, [saved, suggestion, editing]);
  const save = async () => {
    try { await call('pim3.save', { admissionId, inputs: d }); toast('PIM3 saved'); setEditing(false); } catch (e: any) { toast(e.message, 'crit'); }
  };
  return (
    <div className="card p-5">
      <CardHeader title={<span className="flex items-center gap-2"><Activity size={15} className="text-accent-ink" />Severity · PIM3</span>}
        info="Paediatric Index of Mortality 3, from the first hour of PICU care. Drives the risk-adjusted mortality ratio (SMR) on the dashboard."
        right={saved && !editing ? <span className="tnum text-[13px]">{(saved.risk * 100).toFixed(1)}% <span className="text-ink-3">predicted</span></span> : null} />
      {editing ? (
        <>
          <Pim3Fields d={d} onChange={setD} />
          <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button><Button variant="primary" size="sm" onClick={save}>Save PIM3</Button></div>
        </>
      ) : saved ? (
        <div className="flex items-center justify-between text-[12.5px] text-ink-3">
          <span>SBP {saved.inputs.sbp ?? '—'} · BE {saved.inputs.baseExcess ?? '—'} · {saved.inputs.mvFirstHour ? 'ventilated in 1st h' : 'not ventilated in 1st h'} · {PIM3_RISKDX_LABEL[saved.inputs.riskDx]}</span>
          {canEdit && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>}
        </div>
      ) : (
        <div className="flex items-center justify-between text-[12.5px] text-ink-3">
          <span>Not recorded. Ideally completed within the first hour of admission.</span>
          {canEdit && <Button size="sm" onClick={() => setEditing(true)}>Record PIM3</Button>}
        </div>
      )}
    </div>
  );
}
