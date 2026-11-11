// Fluid balance on the patient page: 24 h intake / output / balance and urine output (mL/kg/h)
// in the live-monitor tile style, 6-hour bars, and two-tap entry.
import { useState } from 'react';
import { Droplets, Trash2 } from 'lucide-react';
import { call } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { cx } from '@/lib/format';
import { Button, CardHeader, Field, useToast } from '@/components/ui';
import { VitalTile } from '@/components/monitor';
import { FLUID_IN, FLUID_OUT, type FluidDir, type FluidEntry, type FluidSummary } from '@shared/fluids';
import { nowLocal } from '@shared/time';

const AMOUNTS = [10, 25, 50, 100, 250];
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n))}`;

export function FluidsCard({ admissionId, editable }: { admissionId: string; editable: boolean }) {
  const { data } = useApi<{ entries: FluidEntry[]; weightKg: number | null; summary: FluidSummary }>('fluids.forAdmission', { admissionId });
  const toast = useToast();
  const [dir, setDir] = useState<FluidDir>('in');
  const [category, setCategory] = useState<string>('IV fluids');
  const [ml, setMl] = useState('');
  const [at, setAt] = useState(nowLocal());
  if (!data) return null;
  const s = data.summary;
  const cats = dir === 'in' ? FLUID_IN : FLUID_OUT;
  const add = async () => {
    try { await call('fluids.add', { admissionId, dir, category, ml: Number(ml), at }); toast(`${category} ${ml} mL added`); setMl(''); setAt(nowLocal()); }
    catch (e: any) { toast(e.message, 'crit'); }
  };
  const remove = async (id: string) => { try { await call('fluids.delete', { id }); toast('Entry removed'); } catch (e: any) { toast(e.message, 'crit'); } };
  const max = Math.max(1, ...s.blocks.map(b => Math.max(b.in, b.out)));

  return (
    <div className="card p-5">
      <CardHeader title="Fluid balance" info="Last 24 hours (or since admission). Urine output uses the admission weight." right={<span className="text-[12px] text-ink-3">{s.hours < 24 ? `${s.hours} h since admission` : 'last 24 h'}</span>} />
      <div className="grid grid-cols-2 gap-2.5">
        <VitalTile tone="sky" title="Balance" compact value={signed(s.balance)} unit="mL" />
        <VitalTile title="In" compact value={Math.round(s.in)} unit="mL" />
        <VitalTile title="Out" compact value={Math.round(s.out)} unit="mL" />
        <VitalTile tone={s.oliguria ? 'alert' : 'teal'} title="Urine" compact sub={s.oliguria ? 'Below 0.5 mL/kg/h' : data.weightKg ? `${Math.round(s.urineMl)} mL · ${data.weightKg} kg` : 'Needs a weight'} value={s.urineRate ?? '--'} unit="mL/kg/h" />
      </div>

      {s.in + s.out > 0 && (
        <div className="mt-4 flex items-end gap-3">
          {s.blocks.map(b => (
            <div key={b.start} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-16 w-full items-end justify-center gap-1">
                <div className="w-1/3 rounded-t-md bg-[var(--series-1)]" style={{ height: `${(b.in / max) * 100}%` }} title={`In ${b.in} mL`} />
                <div className="w-1/3 rounded-t-md bg-[var(--series-2)]" style={{ height: `${(b.out / max) * 100}%` }} title={`Out ${b.out} mL`} />
              </div>
              <span className="tnum text-[10.5px] text-ink-3">{new Date(b.start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          ))}
          <div className="flex flex-col gap-1 text-[11px] text-ink-3"><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-[var(--series-1)]" />In</span><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-[var(--series-2)]" />Out</span></div>
        </div>
      )}

      {editable && (
        <div className="inset mt-4 flex flex-col gap-3 p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-line bg-panel p-0.5">
              {(['in', 'out'] as const).map(d => (
                <button key={d} type="button" onClick={() => { setDir(d); setCategory(d === 'in' ? FLUID_IN[0] : FLUID_OUT[0]); }}
                  className={cx('h-7 rounded-md px-3 text-[12.5px] font-semibold transition', dir === d ? 'bg-panel-3 text-ink' : 'text-ink-3 hover:text-ink')}>{d === 'in' ? 'Intake' : 'Output'}</button>
              ))}
            </div>
            {cats.map(c => (
              <button key={c} type="button" onClick={() => setCategory(c)}
                className={cx('h-7 rounded-full border px-3 text-[12px] transition', category === c ? 'border-accent bg-accent-soft font-medium text-accent-ink' : 'border-line bg-panel text-ink-2 hover:text-ink')}>{c}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {AMOUNTS.map(a => <button key={a} type="button" onClick={() => setMl(String(a))} className={cx('tnum h-9 rounded-xl border px-3 text-[13px]', ml === String(a) ? 'border-accent text-accent-ink' : 'border-line bg-panel text-ink-2')}>{a}</button>)}
            <Field label="mL" className="w-24"><input id="fluid-ml" className="field tnum" inputMode="decimal" value={ml} onChange={e => setMl(e.target.value)} /></Field>
            <Field label="Time" className="w-[200px]"><input id="fluid-at" type="datetime-local" className="field tnum" value={at} onChange={e => setAt(e.target.value)} /></Field>
            <Button variant="primary" disabled={!(Number(ml) > 0)} onClick={add}><Droplets size={15} />Add</Button>
          </div>
        </div>
      )}

      {data.entries.length > 0 && (
        <ul className="mt-3 flex flex-col">
          {data.entries.slice(0, 8).map(e => (
            <li key={e.id} className="group flex items-center gap-3 border-b border-line py-1.5 text-[12.5px] last:border-0">
              <span className={cx('tnum w-14 shrink-0 font-semibold', e.dir === 'in' ? 'text-info-ink' : 'text-accent-ink')}>{e.dir === 'in' ? '+' : '−'}{e.ml}</span>
              <span className="flex-1 text-ink-2">{e.category}</span>
              <span className="tnum text-ink-3">{e.at.slice(5, 16).replace('T', ' ')}</span>
              {editable && <button onClick={() => remove(e.id)} className="text-ink-3 opacity-0 transition group-hover:opacity-100 hover:text-crit-ink" aria-label="Remove"><Trash2 size={13} /></button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
