// Vital signs at key moments: compact entry grid (numeric keypads on phones), live
// age-specific flags, and the patient-page card with first-24 h worst values and trends.
import { useMemo, useState } from 'react';
import { Activity, Plus, Trash2 } from 'lucide-react';
import { call } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { cx } from '@/lib/format';
import { Button, CardHeader, ChoiceChips, Chip, ErrorNote, Field, Modal, useToast } from '@/components/ui';
import { TrendLine } from '@/components/charts';
import {
  VITALS, VITAL_CONTEXTS, VITAL_CONTEXT_LABEL, VITAL_FLAGS, ageBand, shockIndex, sfRatio, validateVitals, vitalFlags,
  type VitalCode, type VitalContext, type VitalFlag, type VitalValues, type Worst24,
} from '@shared/vitals';
import { nowLocal } from '@shared/time';

/** Entry order: the sequence nurses read them off the monitor. */
const ENTRY: VitalCode[] = ['hr', 'rr', 'spo2', 'fio2', 'sbp', 'dbp', 'map', 'temp', 'crt', 'gcs', 'glucose', 'urine'];
export type VitalsDraft = Partial<Record<VitalCode, string>>;

/** Draft → validated values, or null when nothing (valid) has been entered yet. */
export function parseDraft(d: VitalsDraft): { values: VitalValues } | { error: string } | null {
  if (!Object.values(d).some(v => v !== undefined && v !== '')) return null;
  try { return { values: validateVitals(d) }; } catch (e: any) { return { error: e.message }; }
}

export function VitalsGrid({ d, onChange, ageMonths, dense }: { d: VitalsDraft; onChange: (d: VitalsDraft) => void; ageMonths: number | null; dense?: boolean }) {
  const parsed = parseDraft(d);
  const v = parsed && 'values' in parsed ? parsed.values : {};
  const flags = ageMonths != null && parsed && 'values' in parsed ? vitalFlags(v, ageMonths) : [];
  const sf = sfRatio(v), si = shockIndex(v);
  const derivedMap = d.map ? null : v.map;
  return (
    <div className="flex flex-col gap-3">
      <div className={cx('grid gap-2.5', dense ? 'grid-cols-3 sm:grid-cols-4' : 'grid-cols-3 md:grid-cols-6')}>
        {ENTRY.map(code => {
          const def = VITALS[code];
          return (
            <label key={code} className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-[11.5px] font-medium text-ink-3">{def.short}{def.unit ? <span className="font-normal"> · {def.unit}</span> : null}</span>
              <input className="field tnum h-10 text-[15px]" inputMode="decimal" enterKeyHint="next" aria-label={def.label}
                placeholder={code === 'map' && derivedMap != null ? `${derivedMap}` : code === 'fio2' ? '21' : '—'}
                value={d[code] ?? ''} onChange={e => onChange({ ...d, [code]: e.target.value.replace(',', '.') })} />
            </label>
          );
        })}
      </div>
      <div className="flex min-h-6 flex-wrap items-center gap-1.5 text-[12px]">
        {parsed && 'error' in parsed && <span className="text-crit-ink">{parsed.error}</span>}
        {flags.map(f => <Chip key={f} tone={FLAG_TONE[f]}>{VITAL_FLAGS[f]}</Chip>)}
        {derivedMap != null && <span className="text-ink-3">MAP {derivedMap} (calculated)</span>}
        {sf != null && <span className="text-ink-3">· S/F {Math.round(sf)}</span>}
        {si != null && <span className="text-ink-3">· shock index {si.toFixed(2)}</span>}
        {ageMonths != null && <span className="ml-auto text-[11.5px] text-ink-3">Age band {ageBand(ageMonths).label} (IPSCC)</span>}
      </div>
    </div>
  );
}

const FLAG_TONE: Record<VitalFlag, 'crit' | 'warn'> = {
  tachycardia: 'warn', bradycardia: 'crit', tachypnoea: 'warn', hypotension: 'crit', hypoxaemia: 'crit', fever: 'warn', hypothermia: 'warn',
  prolonged_crt: 'warn', coma: 'crit', oliguria: 'warn', hypoglycaemia: 'crit',
};

export function RecordVitalsModal({ open, onClose, admissionId, ageMonths, defaultContext = 'routine' }: { open: boolean; onClose: () => void; admissionId: string; ageMonths: number; defaultContext?: VitalContext }) {
  const [d, setD] = useState<VitalsDraft>({});
  const [at, setAt] = useState(nowLocal());
  const [context, setContext] = useState<VitalContext>(defaultContext);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const reset = () => { setD({}); setAt(nowLocal()); setContext(defaultContext); setErr(null); };
  const save = async () => {
    const p = parseDraft(d);
    if (!p) return setErr('Enter at least one vital sign');
    if ('error' in p) return setErr(p.error);
    try { await call('vitals.add', { admissionId, at, context, values: p.values }); toast('Vital signs recorded'); reset(); onClose(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} width={720} title="Record vital signs"
      subtitle="Any subset is fine. Flags use age-specific limits; nothing here changes treatment."
      footer={<><Button variant="ghost" onClick={() => { reset(); onClose(); }}>Cancel</Button><Button variant="primary" onClick={save}>Save vitals</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_1fr]">
          <Field label="Time"><input type="datetime-local" className="field" value={at} onChange={e => setAt(e.target.value)} /></Field>
          <Field label="Moment"><ChoiceChips size="sm" options={VITAL_CONTEXTS} value={context} onChange={setContext} labels={VITAL_CONTEXT_LABEL} /></Field>
        </div>
        <VitalsGrid d={d} onChange={setD} ageMonths={ageMonths} />
        <ErrorNote text={err} />
      </div>
    </Modal>
  );
}

interface VitalsData {
  sets: { id: string; at: string; context: VitalContext; values: VitalValues; flags: VitalFlag[]; sf: number | null; shockIndex: number | null }[];
  admissionSetId: string | null; worst24: Worst24 | null; flags24: VitalFlag[]; ageMonths: number;
}

const fmtV = (code: VitalCode, v: number | undefined) => (v == null ? '—' : v.toFixed(VITALS[code].decimals));
const TRENDS: VitalCode[] = ['hr', 'rr', 'spo2', 'sbp', 'temp', 'map'];

export function VitalsCard({ admissionId, canEdit, editable }: { admissionId: string; canEdit: boolean; editable: boolean }) {
  const { data } = useApi<VitalsData>('vitals.forAdmission', { admissionId });
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const toast = useToast();
  const chronological = useMemo(() => [...(data?.sets ?? [])].reverse(), [data]);
  if (!data) return null;
  const latest = data.sets[0];
  const w = data.worst24;
  const trends = TRENDS.filter(c => chronological.filter(s => s.values[c] != null).length >= 2);
  const del = async (id: string) => {
    if (!confirm('Remove this set of vital signs? It is kept in the audit log.')) return;
    try { await call('vitals.delete', { id }); toast('Vital signs removed'); } catch (e: any) { toast(e.message, 'crit'); }
  };

  return (
    <div className="card p-5">
      <CardHeader title="Vital signs" info="Recorded at key moments (admission, deterioration, review). Worst first-24 h values are derived for research and severity."
        right={editable && <Button size="sm" variant="primary" onClick={() => setOpen(true)}><Plus size={14} />Record</Button>} />
      {!latest ? (
        <div className="flex items-center gap-3 rounded-xl bg-panel-2 px-4 py-3 text-[12.5px] text-ink-3">
          <Activity size={16} />No vital signs recorded{editable ? ' — record the admission set within the first hour.' : '.'}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-2 text-[11.5px] text-ink-3">
              Latest · {latest.at.replace('T', ' ')} · {VITAL_CONTEXT_LABEL[latest.context]}{latest.id === data.admissionSetId ? ' (admission set)' : ''}
            </p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(78px,1fr))] gap-2">
              {ENTRY.filter(c => latest.values[c] != null).map(c => (
                <div key={c} className="min-w-0 rounded-xl bg-panel-2 px-2.5 py-2">
                  <p className="truncate text-[11px] text-ink-3">{VITALS[c].short}{VITALS[c].unit && <span className="opacity-70"> {VITALS[c].unit}</span>}</p>
                  <p className="tnum text-[17px] font-semibold leading-tight">{fmtV(c, latest.values[c])}</p>
                </div>
              ))}
            </div>
            {(latest.flags.length > 0 || latest.sf != null || latest.shockIndex != null) && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-3">
                {latest.flags.map(f => <Chip key={f} tone={FLAG_TONE[f]}>{VITAL_FLAGS[f]}</Chip>)}
                {latest.sf != null && <span>S/F {Math.round(latest.sf)}</span>}
                {latest.shockIndex != null && <span>· shock index {latest.shockIndex.toFixed(2)}</span>}
              </div>
            )}
          </div>

          {w && (
            <div className="inset p-3">
              <p className="mb-1.5 text-[11.5px] font-medium text-ink-2">Worst in first 24 h <span className="font-normal text-ink-3">· {w.sets} set{w.sets === 1 ? '' : 's'}</span></p>
              <div className="tnum flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
                {w.values.hr != null && <span>HR max <b>{w.values.hr}</b></span>}
                {w.values.rr != null && <span>RR max <b>{w.values.rr}</b></span>}
                {w.values.spo2 != null && <span>SpO₂ min <b>{w.values.spo2}%</b></span>}
                {w.values.sbp != null && <span>SBP min <b>{w.values.sbp}</b></span>}
                {w.values.map != null && <span>MAP min <b>{w.values.map}</b></span>}
                {w.values.tempMax != null && <span>Temp <b>{w.values.tempMin?.toFixed(1)}–{w.values.tempMax.toFixed(1)}</b></span>}
                {w.values.gcs != null && <span>GCS min <b>{w.values.gcs}</b></span>}
                {w.sfMin != null && <span>S/F min <b>{Math.round(w.sfMin)}</b></span>}
                {w.shockIndexMax != null && <span>SI max <b>{w.shockIndexMax.toFixed(2)}</b></span>}
              </div>
              {!!data.flags24.length && <div className="mt-2 flex flex-wrap gap-1.5">{data.flags24.map(f => <Chip key={f} tone={FLAG_TONE[f]}>{VITAL_FLAGS[f]}</Chip>)}</div>}
            </div>
          )}

          {!!trends.length && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
              {trends.map(c => {
                const pts = chronological.filter(s => s.values[c] != null).map(s => ({ x: s.at.slice(5, 16).replace('T', ' '), y: s.values[c]! }));
                const ys = pts.map(p => p.y), lo = Math.min(...ys), hi = Math.max(...ys), pad = Math.max((hi - lo) * 0.2, c === 'temp' ? 0.5 : 4);
                const f = 10 ** VITALS[c].decimals;
                return (
                  <div key={c} className="min-w-0">
                    <p className="text-[11px] text-ink-3">{VITALS[c].short}</p>
                    <TrendLine height={84} name={VITALS[c].short} data={pts} domain={[Math.max(VITALS[c].min, Math.floor((lo - pad) * f) / f), Math.min(VITALS[c].max, Math.ceil((hi + pad) * f) / f)]} fmt={v => v.toFixed(VITALS[c].decimals)} />
                  </div>
                );
              })}
            </div>
          )}

          <div>
            <button className="text-[12px] text-accent-ink" onClick={() => setShowAll(!showAll)}>{showAll ? 'Hide' : 'Show'} all {data.sets.length} sets</button>
            {showAll && (
              <div className="mt-2 flex flex-col divide-y divide-line text-[12.5px]">
                {data.sets.map(s => (
                  <div key={s.id} className="group flex items-center gap-3 py-1.5">
                    <span className="tnum w-28 shrink-0 text-ink-3">{s.at.slice(5, 16).replace('T', ' ')}</span>
                    <span className="tnum min-w-0 flex-1 truncate">{ENTRY.filter(c => s.values[c] != null).map(c => `${VITALS[c].short} ${fmtV(c, s.values[c])}`).join(' · ')}</span>
                    {s.flags.length > 0 && <span className="shrink-0 text-[11.5px] text-warn-ink">{s.flags.length} flag{s.flags.length > 1 ? 's' : ''}</span>}
                    {canEdit && <button onClick={() => del(s.id)} className="shrink-0 text-ink-3 opacity-0 transition group-hover:opacity-100 hover:text-crit-ink" aria-label="Remove"><Trash2 size={13} /></button>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      <RecordVitalsModal open={open} onClose={() => setOpen(false)} admissionId={admissionId} ageMonths={data.ageMonths} defaultContext={latest ? 'routine' : 'admission'} />
    </div>
  );
}
