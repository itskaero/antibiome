// Admission sheet — designed for < 60 s: defaults everywhere, one-tap chips, keyboard-first,
// MRN recognises returning patients, and a visible entry timer so the target is measured.
import { useEffect, useMemo, useState } from 'react';
import { Timer, UserCheck } from 'lucide-react';
import { call } from '@/lib/api';
import { go, useApi } from '@/lib/hooks';
import { Button, ChoiceChips, ErrorNote, Field, Modal, Toggle, useToast } from '@/components/ui';
import { DxPicker, rememberDx } from '@/components/DxPicker';
import { ModuleFormSection, useApplicableModules } from '@/components/ModuleFields';
import type { ParamValue } from '@shared/modules';
import { Pim3Fields, draftRisk, pim3Draft, type Pim3Draft } from '@/components/Pim3Form';
import { suggestRiskDx } from '@shared/pim3';
import { ADMISSION_SOURCES, DX_BY_CODE, PRESCRIBABLE_ANTIMICROBIALS, RESP_LABEL, RESP_LEVELS, VASOACTIVES, type RespLevel } from '@shared/reference';
import { nowLocal } from '@shared/time';
import type { CensusRow } from './types';

const COMMON_ABX = ['Ceftriaxone', 'Ampicillin', 'Gentamicin', 'Amikacin', 'Vancomycin', 'Meropenem', 'Piperacillin-Tazobactam', 'Cefotaxime'];

const blank = () => ({
  mrn: '', name: '', sex: '' as '' | 'M' | 'F', years: '', months: '', weightKg: '', bed: '', admitAt: nowLocal(),
  source: 'ED' as (typeof ADMISSION_SOURCES)[number], elective: false, primaryDx: null as string | null, secondaryDx: [] as string[],
  arrivalSupport: 'RA' as RespLevel, shockOnArrival: false, comaOnArrival: false, chronicCondition: false, malnutrition: false,
  vasoactives: [] as string[], antimicrobials: [] as string[], notes: '',
});

export function AdmitModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState(blank);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [returning, setReturning] = useState<any>(null);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [moreAbx, setMoreAbx] = useState('');
  const [secondary, setSecondary] = useState<string | null>(null);
  const toast = useToast();
  const census = useApi<{ rows: CensusRow[]; beds: number }>(open ? 'census.list' : null);
  const [moduleValues, setModuleValues] = useState<Record<string, ParamValue | undefined>>({});
  const modules = useApplicableModules(f.primaryDx, f.secondaryDx);
  const [pimOpen, setPimOpen] = useState(false);
  const [pim, setPim] = useState<Pim3Draft>(() => pim3Draft());
  // Keep PIM3 suggestions in step with the sheet until the user opens the panel.
  useEffect(() => { if (!pimOpen) setPim(pim3Draft(null, { riskDx: f.primaryDx ? suggestRiskDx(f.primaryDx) : 'none', elective: f.elective, mvFirstHour: f.arrivalSupport === 'MV' })); },
    [pimOpen, f.primaryDx, f.elective, f.arrivalSupport]);

  useEffect(() => { if (open) { setF(blank()); setErr(null); setReturning(null); setModuleValues({}); setPimOpen(false); setStartedAt(Date.now()); } }, [open]);
  useEffect(() => { if (!open) return; const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000); return () => clearInterval(t); }, [open, startedAt]);

  const freeBeds = useMemo(() => {
    const taken = new Set((census.data?.rows ?? []).map(r => r.admission.bed));
    return Array.from({ length: census.data?.beds ?? 0 }, (_, i) => String(i + 1)).filter(b => !taken.has(b));
  }, [census.data]);
  useEffect(() => { if (open && !f.bed && freeBeds.length) setF(s => ({ ...s, bed: freeBeds[0] })); }, [open, freeBeds, f.bed]);

  const set = <K extends keyof ReturnType<typeof blank>>(k: K, v: ReturnType<typeof blank>[K]) => setF(s => ({ ...s, [k]: v }));

  const lookup = async () => {
    if (f.mrn.trim().length < 2) return;
    try {
      const r = await call('patient.lookup', { mrn: f.mrn });
      setReturning(r);
      if (r) setF(s => ({ ...s, sex: r.sex, name: s.name || r.name || '', weightKg: s.weightKg || (r.lastAdmission?.weight_kg ? String(r.lastAdmission.weight_kg) : '') }));
    } catch { /* lookup is a convenience only */ }
  };

  const ageMonths = (Number(f.years) || 0) * 12 + (Number(f.months) || 0);
  const submit = async () => {
    setErr(null);
    if (!f.sex) return setErr('Choose sex');
    if (f.years === '' && f.months === '') return setErr('Enter age (years and/or months)');
    setSaving(true);
    try {
      // Only values for modules that still apply to the chosen diagnoses.
      const applicable = new Set(modules.flatMap(m => m.params.map(p => p.id)));
      const mv = Object.fromEntries(Object.entries(moduleValues).filter(([k, v]) => v !== undefined && applicable.has(k)));
      if (pimOpen && 'error' in draftRisk(pim)) { setSaving(false); return setErr(`PIM3: ${(draftRisk(pim) as { error: string }).error}`); }
      const res = await call<{ id: string }>('admission.create', { ...f, ageMonths, weightKg: f.weightKg || null, moduleValues: mv, pim3: pimOpen ? pim : undefined });
      if (f.primaryDx) rememberDx(f.primaryDx);
      toast(`Admitted to bed ${f.bed || '—'} in ${elapsed}s`);
      onClose();
      go(`patient/${res.id}`);
    } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  };

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });

  return (
    <Modal open={open} onClose={onClose} width={860} title="New admission"
      subtitle="Only what the unit needs to analyse. Everything else is derived."
      footer={
        <>
          <span className={`mr-auto flex items-center gap-1.5 text-[12px] ${elapsed > 60 ? 'text-warn-ink' : 'text-ink-3'}`}>
            <Timer size={14} />Entry time <span className="tnum font-medium">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>
          </span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={saving}>Admit patient <span className="kbd border-white/30 bg-white/10 text-white/80">Ctrl ↵</span></Button>
        </>
      }>
      <div className="flex flex-col gap-5">
        <section className="grid grid-cols-[1.1fr_1.4fr_auto] items-end gap-3">
          <Field label="MRN" required><input className="field" value={f.mrn} onChange={e => set('mrn', e.target.value)} onBlur={lookup} autoFocus placeholder="Hospital number" /></Field>
          <Field label="Name" hint="Visible to clinical roles only"><input className="field" value={f.name} onChange={e => set('name', e.target.value)} placeholder="Optional" /></Field>
          <Field label="Sex" required><ChoiceChips options={['M', 'F'] as const} value={f.sex || null} onChange={v => set('sex', v)} labels={{ M: 'Male', F: 'Female' }} /></Field>
        </section>
        {returning && (
          <div className="-mt-2 flex items-center gap-2 rounded-xl bg-info-soft px-3 py-2 text-[12.5px] text-info-ink">
            <UserCheck size={14} />Returning patient{returning.lastAdmission ? ` — last admitted ${returning.lastAdmission.admit_at.slice(0, 10)}` : ''}.
            {returning.openAdmissionId && <b className="ml-1">Already has an open admission.</b>}
          </div>
        )}

        <section className="grid grid-cols-[repeat(2,72px)_100px_110px_1fr] items-end gap-3">
          <Field label="Age · yrs"><input className="field tnum" type="number" min={0} max={18} value={f.years} onChange={e => set('years', e.target.value)} /></Field>
          <Field label="· months"><input className="field tnum" type="number" min={0} max={11} value={f.months} onChange={e => set('months', e.target.value)} /></Field>
          <Field label="Weight kg"><input className="field tnum" type="number" step="0.1" min={0} value={f.weightKg} onChange={e => set('weightKg', e.target.value)} /></Field>
          <Field label="Bed">
            <select className="field" value={f.bed} onChange={e => set('bed', e.target.value)}>
              <option value="">—</option>
              {freeBeds.map(b => <option key={b} value={b}>Bed {b}</option>)}
            </select>
          </Field>
          <Field label="Admitted at"><input className="field" type="datetime-local" value={f.admitAt} onChange={e => set('admitAt', e.target.value)} /></Field>
        </section>

        <section className="grid grid-cols-[1fr_auto] items-end gap-3">
          <Field label="Admitted from"><ChoiceChips options={ADMISSION_SOURCES} value={f.source} onChange={v => set('source', v)} /></Field>
          <Toggle checked={f.elective} onChange={v => set('elective', v)} label="Elective" />
        </section>

        <section className="grid grid-cols-2 gap-3">
          <Field label="Primary diagnosis" required><DxPicker value={f.primaryDx} onChange={c => set('primaryDx', c)} /></Field>
          <Field label="Secondary diagnoses" hint={f.secondaryDx.length ? undefined : 'Optional, up to 3'}>
            <DxPicker value={secondary} exclude={[f.primaryDx ?? '', ...f.secondaryDx]} placeholder="Add a secondary diagnosis…"
              onChange={c => { if (c && f.secondaryDx.length < 3) set('secondaryDx', [...f.secondaryDx, c]); setSecondary(null); }} />
            {!!f.secondaryDx.length && (
              <div className="flex flex-wrap gap-1.5">
                {f.secondaryDx.map(c => (
                  <button key={c} type="button" onClick={() => set('secondaryDx', f.secondaryDx.filter(x => x !== c))}
                    className="rounded-full bg-panel-3 px-2.5 py-1 text-[12px] text-ink-2 hover:text-crit-ink">{DX_BY_CODE[c]?.label} ×</button>
                ))}
              </div>
            )}
          </Field>
        </section>

        <ModuleFormSection modules={modules} stages={['admission']} values={moduleValues}
          onChange={(pid, v) => setModuleValues(s => ({ ...s, [pid]: v ?? undefined }))} />

        <section className="inset grid grid-cols-1 gap-4 p-4">
          <Field label="Respiratory support on arrival">
            <ChoiceChips options={RESP_LEVELS} value={f.arrivalSupport} onChange={v => set('arrivalSupport', v)} labels={RESP_LABEL} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Toggle checked={f.shockOnArrival} onChange={v => set('shockOnArrival', v)} label="Shock on arrival" />
            <Toggle checked={f.comaOnArrival} onChange={v => set('comaOnArrival', v)} label="Coma (GCS ≤ 8)" />
            <Toggle checked={f.chronicCondition} onChange={v => set('chronicCondition', v)} label="Chronic condition" />
            <Toggle checked={f.malnutrition} onChange={v => set('malnutrition', v)} label="Severe malnutrition" />
          </div>
          {f.shockOnArrival && (
            <Field label="Vasoactives started"><ChoiceChips multi size="sm" options={VASOACTIVES} value={f.vasoactives} onChange={v => set('vasoactives', v)} /></Field>
          )}
        </section>

        <div className="inset p-4">
          <button type="button" onClick={() => setPimOpen(!pimOpen)} className="flex w-full items-center justify-between text-left text-[13px]">
            <span><b className="font-medium">PIM3 severity</b> <span className="text-ink-3">· optional now, can be completed within the first hour from the patient page</span></span>
            <span className="text-[12px] text-accent-ink">{pimOpen ? 'Remove' : 'Add'}</span>
          </button>
          {pimOpen && <div className="mt-4"><Pim3Fields d={pim} onChange={setPim} /></div>}
        </div>

        <Field label="Empiric antimicrobials started" hint="Start times default to the admission time; adjust later on the timeline if needed.">
          <div className="flex flex-wrap items-center gap-1.5">
            <ChoiceChips multi size="sm" options={[...new Set([...COMMON_ABX, ...f.antimicrobials])]} value={f.antimicrobials} onChange={v => set('antimicrobials', v)} />
            <select className="field h-7 w-44 text-[12px]" value={moreAbx} onChange={e => { const d = e.target.value; if (d && !f.antimicrobials.includes(d)) set('antimicrobials', [...f.antimicrobials, d]); setMoreAbx(''); }}>
              <option value="">+ Other agent…</option>
              {PRESCRIBABLE_ANTIMICROBIALS.filter(d => !COMMON_ABX.includes(d)).map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
        </Field>

        <ErrorNote text={err} />
      </div>
    </Modal>
  );
}
