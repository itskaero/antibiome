// Phone → Chart: quick bedside charting for nurses and doctors. Pick a bed, then add intake/output in
// two taps, see the shift's hourly balance, record vitals or a nursing note. Nothing is kept on the phone
// except which bed was last open (in memory, for this tab only).
import { useMemo, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowUpFromLine, ClipboardPlus, Clock, Droplets, Gauge, Minus, NotebookPen, Pill, ScrollText, Trash2 } from 'lucide-react';
import { call } from '@/lib/api';
import { go, useApi } from '@/lib/hooks';
import { cx } from '@/lib/format';
import { Button, Empty, useToast } from '@/components/ui';
import { RecordVitalsModal } from '@/components/VitalsEntry';
import { NursingNote } from '@/pages/Patient';
import { DrugsCard, DueChip, GivenButton, HandoverList, PewsChip, QuickPews } from '@/components/Bedside';
import type { VitalSet } from '@shared/vitals';
import { FLUID_IN, FLUID_OUT, currentShift, shiftHours, type FluidDir, type FluidEntry, type FluidSummary } from '@shared/fluids';
import { dxLabel } from '@shared/reference';
import { nowLocal } from '@shared/time';
import type { CensusRow } from '@/pages/types';

let lastBed: string | null = null;
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n))}`;
export function MobileChart() {
  const census = useApi<{ rows: CensusRow[] }>('census.list');
  const [bed, setBed] = useState<string | null>(lastBed);
  const rows = census.data?.rows ?? [];
  const row = rows.find(r => r.admission.id === bed) ?? null;
  const pick = (id: string) => { lastBed = id; setBed(id); };
  if (!census.data) return null;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight">Chart</h1>
        <p className="text-[12px] text-ink-3">Intake / output, PEWS, medicines and handover at the bedside.</p>
      </div>
      <DosesDue rows={rows} onPick={pick} />
      {!rows.length ? <Empty icon={<Droplets size={18} />} title="No patients in the unit" /> : (
        <div className="-mx-3.5 flex gap-2 overflow-x-auto px-3.5 pb-1 scroll-thin" role="tablist" aria-label="Bed">
          {rows.map(r => (
            <button key={r.admission.id} role="tab" aria-selected={r.admission.id === bed} onClick={() => pick(r.admission.id)}
              className={cx('relative flex h-12 min-w-[64px] shrink-0 flex-col items-center justify-center rounded-xl border px-3 text-[12px]', r.admission.id === bed ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line bg-panel text-ink-2')}>
              <span className="tnum text-[16px] font-semibold leading-none">{r.admission.bed ?? '–'}</span>
              <span className="mt-0.5 max-w-[84px] truncate text-[10.5px] text-ink-3">{r.name ?? r.label}</span>
              {(r.pews?.level === 'doctor' || r.pews?.level === 'urgent' || r.abx.some(x => x.due?.overdueMin)) && <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-crit" />}
            </button>
          ))}
        </div>
      )}
      {row ? <BedChart key={row.admission.id} row={row} /> : rows.length > 0 && <p className="rounded-xl bg-panel-2 px-4 py-6 text-center text-[13px] text-ink-3">Choose a bed above.</p>}
    </div>
  );
}

type Section = 'io' | 'pews' | 'meds' | 'handover';
let lastSection: Section = 'io';
const SECTIONS: { id: Section; label: string; icon: typeof Droplets }[] = [
  { id: 'io', label: 'In / Out', icon: Droplets }, { id: 'pews', label: 'PEWS', icon: Gauge }, { id: 'meds', label: 'Meds', icon: Pill }, { id: 'handover', label: 'Handover', icon: ScrollText },
];

/** Overdue and next antimicrobial doses across the unit, soonest first. */
function DosesDue({ rows, onPick }: { rows: CensusRow[]; onPick: (id: string) => void }) {
  const list = rows.flatMap(r => r.abx.filter(x => x.due?.nextDue).map(x => ({ r, x })))
    .filter(({ x }) => x.due!.overdueMin > 0 || (x.due!.dueInMin ?? 999) <= 120)
    .sort((p, q) => (q.x.due!.overdueMin - p.x.due!.overdueMin) || p.x.due!.nextDue!.localeCompare(q.x.due!.nextDue!));
  if (!list.length) return null;
  return (
    <div className="card flex flex-col gap-2 p-3.5">
      <h2 className="flex items-center gap-2 text-[14px] font-semibold"><Clock size={15} className="text-accent-ink" />Doses due in the next 2 h</h2>
      {list.slice(0, 8).map(({ r, x }) => (
        <div key={x.id} className="flex items-center gap-2.5">
          <button onClick={() => onPick(r.admission.id)} className="tnum grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-panel-3 text-[13px] font-semibold">{r.admission.bed ?? '–'}</button>
          <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] font-medium">{x.drug}{x.dose ? ` · ${x.dose}` : ''}</span><DueChip due={x.due} /></span>
          <GivenButton episodeId={x.id} drug={x.drug} />
        </div>
      ))}
    </div>
  );
}

function BedChart({ row }: { row: CensusRow }) {
  const a = row.admission;
  const [vitalsOpen, setVitalsOpen] = useState(false);
  const [section, setSection] = useState<Section>(lastSection);
  const vit = useApi<{ sets: VitalSet[] }>('vitals.forAdmission', { admissionId: a.id });
  const latest = useMemo(() => {
    const out: Record<string, number> = {}; const cutoff = Date.now() - 6 * 3_600_000;
    [...(vit.data?.sets ?? [])].filter(s => new Date(s.at).getTime() >= cutoff).sort((x, y) => x.at.localeCompare(y.at)).forEach(s => Object.assign(out, s.values));
    return out;
  }, [vit.data]);
  const pick = (x: Section) => { lastSection = x; setSection(x); };
  return (
    <div className="flex flex-col gap-3">
      <button className="card flex items-center gap-3 p-3.5 text-left" onClick={() => go(`patient/${a.id}`)}>
        <span className="tnum grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-panel-3 text-[14px] font-semibold">{a.bed ?? '–'}</span>
        <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold">{row.name ?? row.label}</span><span className="block truncate text-[12px] text-ink-3">{dxLabel(a.primaryDx)}{a.weightKg ? ` · ${a.weightKg} kg` : ''}</span></span>
        <PewsChip p={row.pews} />
      </button>
      <div className="sticky top-0 z-10 -mx-1 grid grid-cols-4 gap-1 rounded-2xl bg-panel-2/95 p-1 backdrop-blur" role="tablist" aria-label="Section">
        {SECTIONS.map(x => (
          <button key={x.id} role="tab" aria-selected={section === x.id} onClick={() => pick(x.id)}
            className={cx('flex h-11 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px]', section === x.id ? 'bg-panel font-semibold text-accent-ink shadow-sm' : 'text-ink-3')}>
            <x.icon size={15} />{x.label}
          </button>
        ))}
      </div>
      {section === 'io' && <>
        <IntakeOutput admissionId={a.id} />
        <div className="grid grid-cols-2 gap-2">
          <Button className="h-12" onClick={() => setVitalsOpen(true)}><Activity size={16} />Vitals</Button>
          <Button className="h-12" onClick={() => go(`monitor`)}><ClipboardPlus size={16} />From monitor</Button>
        </div>
        <NursingNote admissionId={a.id} />
      </>}
      {section === 'pews' && <QuickPews key={a.id} admissionId={a.id} ageMonths={a.ageMonths} latest={latest} onSaved={vit.reload} />}
      {section === 'meds' && <>
        <div className="card flex flex-col gap-2 p-3.5">
          <h2 className="text-[14px] font-semibold">Antimicrobials</h2>
          {!row.abx.length && <p className="text-[12.5px] text-ink-3">None running.</p>}
          {row.abx.map(x => (
            <div key={x.id} className="flex items-center gap-2.5 border-t border-line pt-2 first:border-0 first:pt-0">
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium">{x.drug}{x.dose ? ` · ${x.dose}` : ''}</span>
                <span className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-3">{x.intervalHours ? `every ${x.intervalHours} h` : 'no interval set'}{x.due?.lastGiven && ` · last ${x.due.lastGiven.slice(11, 16)}`}<DueChip due={x.due} /></span>
              </span>
              {x.intervalHours != null && <GivenButton episodeId={x.id} drug={x.drug} />}
            </div>
          ))}
        </div>
        <DrugsCard weightKg={a.weightKg} ageMonths={a.ageMonths} running={row.vaso.map(v => v.agent)} />
      </>}
      {section === 'handover' && <HandoverList admissionId={a.id} canWrite />}
      <RecordVitalsModal open={vitalsOpen} onClose={() => setVitalsOpen(false)} admissionId={a.id} ageMonths={a.ageMonths ?? 0} />
    </div>
  );
}

function IntakeOutput({ admissionId }: { admissionId: string }) {
  const { data } = useApi<{ entries: FluidEntry[]; weightKg: number | null; summary: FluidSummary }>('fluids.forAdmission', { admissionId });
  const toast = useToast();
  const [dir, setDir] = useState<FluidDir>('in');
  const [category, setCategory] = useState<string>('IV fluids');
  const [ml, setMl] = useState('');
  const [busy, setBusy] = useState(false);
  const shift = useMemo(() => shiftHours(data?.entries ?? []), [data]);
  if (!data) return null;
  const s = data.summary;
  const cats = dir === 'in' ? FLUID_IN : FLUID_OUT;
  const setDirection = (d: FluidDir) => { setDir(d); setCategory(d === 'in' ? 'IV fluids' : 'Urine'); };
  const bump = (n: number) => setMl(String(Math.max(0, (Number(ml) || 0) + n)));
  const add = async () => {
    setBusy(true);
    try { await call('fluids.add', { admissionId, dir, category, ml: Number(ml), at: nowLocal() }); toast(`${dir === 'in' ? 'In' : 'Out'} · ${category} ${ml} mL`); setMl(''); }
    catch (e: any) { toast(e.message, 'crit'); } finally { setBusy(false); }
  };
  const remove = async (id: string) => { if (!confirm('Remove this entry?')) return; try { await call('fluids.delete', { id }); toast('Entry removed'); } catch (e: any) { toast(e.message, 'crit'); } };
  const recent = [...data.entries].sort((x, y) => y.at.localeCompare(x.at)).slice(0, 6);
  const { label } = currentShift();

  return (
    <div className="card flex flex-col gap-3.5 p-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Droplets size={16} className="text-accent-ink" />Intake / output</h2>
        <span className="text-[11.5px] text-ink-3">{s.hours < 24 ? `${s.hours} h since admission` : 'last 24 h'}</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5 text-center">
        {[['In', Math.round(s.in)], ['Out', Math.round(s.out)], ['Balance', signed(s.balance)]].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-panel-2 px-1 py-2"><div className="text-[10.5px] text-ink-3">{k} mL</div><div className="tnum text-[17px] font-semibold">{v}</div></div>
        ))}
        <div className={cx('rounded-xl px-1 py-2', s.oliguria ? 'bg-crit-soft text-crit-ink' : 'bg-panel-2')}><div className="text-[10.5px] opacity-75">Urine mL/kg/h</div><div className="tnum text-[17px] font-semibold">{s.urineRate ?? '--'}</div></div>
      </div>
      {!data.weightKg && <p className="text-[11.5px] text-warn-ink">Add a weight to the admission to calculate urine mL/kg/h.</p>}

      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Direction">
        <button role="radio" aria-checked={dir === 'in'} onClick={() => setDirection('in')} className={cx('flex h-12 items-center justify-center gap-2 rounded-xl border text-[14px] font-semibold', dir === 'in' ? 'border-info-ink bg-info-soft text-info-ink' : 'border-line text-ink-2')}><ArrowDownToLine size={16} />Intake</button>
        <button role="radio" aria-checked={dir === 'out'} onClick={() => setDirection('out')} className={cx('flex h-12 items-center justify-center gap-2 rounded-xl border text-[14px] font-semibold', dir === 'out' ? 'border-warn bg-warn-soft text-warn-ink' : 'border-line text-ink-2')}><ArrowUpFromLine size={16} />Output</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {cats.map(c => <button key={c} onClick={() => setCategory(c)} className={cx('h-10 rounded-full border px-3.5 text-[13px]', c === category ? 'border-accent bg-accent-soft font-semibold text-accent-ink' : 'border-line text-ink-2')}>{c}</button>)}
      </div>
      <div className="flex items-center gap-2">
        <button aria-label="Less" onClick={() => bump(-10)} className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-line text-ink-2"><Minus size={16} /></button>
        <div className="relative flex-1">
          <input id="io-ml" className="field tnum h-12 pr-12 text-center text-[22px] font-semibold" inputMode="decimal" value={ml} onChange={e => setMl(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" aria-label="Volume in mL" />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[13px] text-ink-3">mL</span>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {[5, 10, 50, 100].map(n => <button key={n} onClick={() => bump(n)} className="h-10 rounded-xl bg-panel-2 text-[13px] font-medium text-ink-2">+{n}</button>)}
      </div>
      <Button variant="primary" className="h-12 text-[15px]" disabled={busy || !(Number(ml) > 0)} onClick={add}>Save {dir === 'in' ? 'intake' : 'output'}{Number(ml) > 0 ? ` · ${ml} mL` : ''}</Button>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between"><h3 className="text-[13px] font-semibold">{label}</h3><span className="tnum text-[12px] text-ink-3">In {Math.round(shift.total.in)} · Out {Math.round(shift.total.out)} · <b className="text-ink">{signed(shift.total.in - shift.total.out)}</b> mL</span></div>
        <table className="w-full text-[13px]" aria-label="Hourly intake and output this shift">
          <thead><tr className="text-[11px] text-ink-3"><th className="py-1 text-left font-medium">Hour</th><th className="text-right font-medium">In</th><th className="text-right font-medium">Out</th><th className="text-right font-medium">Net</th></tr></thead>
          <tbody className="tnum">
            {shift.rows.map(r => (
              <tr key={r.label} className="border-t border-line">
                <td className="py-1.5 text-ink-2">{r.label}</td>
                <td className="text-right">{r.in ? Math.round(r.in) : <span className="text-ink-3">–</span>}</td>
                <td className="text-right">{r.out ? Math.round(r.out) : <span className="text-ink-3">–</span>}</td>
                <td className={cx('text-right font-medium', r.in - r.out < 0 && 'text-warn-ink')}>{r.in || r.out ? signed(r.in - r.out) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {recent.length > 0 && (
        <div>
          <h3 className="mb-1 text-[13px] font-semibold">Recent entries</h3>
          <ul className="flex flex-col divide-y divide-line">
            {recent.map(e => (
              <li key={e.id} className="flex items-center gap-2 py-1.5 text-[13px]">
                <span className="tnum w-11 shrink-0 text-ink-3">{e.at.slice(11, 16)}</span>
                <span className={cx('h-2 w-2 shrink-0 rounded-full', e.dir === 'in' ? 'bg-info-ink' : 'bg-warn')} />
                <span className="min-w-0 flex-1 truncate">{e.category}</span>
                <span className="tnum font-medium">{Math.round(e.ml)} mL</span>
                <button aria-label="Remove" onClick={() => remove(e.id)} className="grid h-9 w-9 place-items-center text-ink-3"><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="flex items-center gap-1.5 text-[11px] text-ink-3"><NotebookPen size={12} />Saved at the current time on the PICU PC; it appears on the PC and other phones at once.</p>
    </div>
  );
}
