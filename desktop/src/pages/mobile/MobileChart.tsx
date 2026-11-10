// Phone → Chart: quick bedside charting for nurses and doctors. Pick a bed, then add intake/output in
// two taps, see the shift's hourly balance, record vitals or a nursing note. Nothing is kept on the phone
// except which bed was last open (in memory, for this tab only).
import { useMemo, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowUpFromLine, ClipboardPlus, Droplets, Minus, NotebookPen, Trash2 } from 'lucide-react';
import { call } from '@/lib/api';
import { go, useApi } from '@/lib/hooks';
import { cx } from '@/lib/format';
import { Button, Chip, Empty, useToast } from '@/components/ui';
import { RecordVitalsModal } from '@/components/VitalsEntry';
import { NursingNote } from '@/pages/Patient';
import { FLUID_IN, FLUID_OUT, type FluidDir, type FluidEntry, type FluidSummary } from '@shared/fluids';
import { dxLabel } from '@shared/reference';
import { nowLocal } from '@shared/time';
import type { CensusRow } from '@/pages/types';

let lastBed: string | null = null;
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n))}`;
const hourOf = (at: string) => Number(at.slice(11, 13));

/** Day shift 08:00–20:00, night 20:00–08:00 (local clock of the PICU PC). */
export function currentShift(now = new Date()) {
  const h = now.getHours();
  const start = new Date(now); start.setMinutes(0, 0, 0);
  if (h >= 8 && h < 20) start.setHours(8); else { if (h < 8) start.setDate(start.getDate() - 1); start.setHours(20); }
  return { start, label: h >= 8 && h < 20 ? 'Day shift (08–20)' : 'Night shift (20–08)' };
}
const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Hour-by-hour intake and output since the start of the shift, newest hour first. */
export function shiftHours(entries: FluidEntry[], now = new Date()) {
  const { start } = currentShift(now);
  const from = localIso(start);
  const rows: { hour: number; label: string; in: number; out: number }[] = [];
  for (let t = new Date(start); t <= now; t.setHours(t.getHours() + 1)) rows.push({ hour: t.getHours(), label: `${String(t.getHours()).padStart(2, '0')}:00`, in: 0, out: 0 });
  for (const e of entries) {
    if (e.at < from) continue;
    const r = rows.find(x => x.hour === hourOf(e.at));
    if (r) r[e.dir] += e.ml;
  }
  const total = rows.reduce((s, r) => ({ in: s.in + r.in, out: s.out + r.out }), { in: 0, out: 0 });
  return { rows: rows.reverse(), total };
}

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
        <p className="text-[12px] text-ink-3">Intake / output, vitals and notes at the bedside.</p>
      </div>
      {!rows.length ? <Empty icon={<Droplets size={18} />} title="No patients in the unit" /> : (
        <div className="-mx-3.5 flex gap-2 overflow-x-auto px-3.5 pb-1 scroll-thin" role="tablist" aria-label="Bed">
          {rows.map(r => (
            <button key={r.admission.id} role="tab" aria-selected={r.admission.id === bed} onClick={() => pick(r.admission.id)}
              className={cx('flex h-12 min-w-[64px] shrink-0 flex-col items-center justify-center rounded-xl border px-3 text-[12px]', r.admission.id === bed ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line bg-panel text-ink-2')}>
              <span className="tnum text-[16px] font-semibold leading-none">{r.admission.bed ?? '–'}</span>
              <span className="mt-0.5 max-w-[84px] truncate text-[10.5px] text-ink-3">{r.name ?? r.label}</span>
            </button>
          ))}
        </div>
      )}
      {row ? <BedChart key={row.admission.id} row={row} /> : rows.length > 0 && <p className="rounded-xl bg-panel-2 px-4 py-6 text-center text-[13px] text-ink-3">Choose a bed above.</p>}
    </div>
  );
}

function BedChart({ row }: { row: CensusRow }) {
  const a = row.admission;
  const [vitalsOpen, setVitalsOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <button className="card flex items-center gap-3 p-3.5 text-left" onClick={() => go(`patient/${a.id}`)}>
        <span className="tnum grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-panel-3 text-[14px] font-semibold">{a.bed ?? '–'}</span>
        <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold">{row.name ?? row.label}</span><span className="block truncate text-[12px] text-ink-3">{dxLabel(a.primaryDx)}</span></span>
        <Chip>Open</Chip>
      </button>
      <IntakeOutput admissionId={a.id} />
      <div className="grid grid-cols-2 gap-2">
        <Button className="h-12" onClick={() => setVitalsOpen(true)}><Activity size={16} />Vitals</Button>
        <Button className="h-12" onClick={() => go(`monitor`)}><ClipboardPlus size={16} />From monitor</Button>
      </div>
      <NursingNote admissionId={a.id} />
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
