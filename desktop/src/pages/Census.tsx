import { useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, BedDouble, FlaskConical, HeartPulse, Pill, Plus } from 'lucide-react';
import { call } from '@/lib/api';
import { go, useApi } from '@/lib/hooks';
import { cx, losLabel } from '@/lib/format';
import { Button, Chip, Empty, PageHeader, RespChip, RespSegment, useToast } from '@/components/ui';
import { PewsChip, dueLabel } from '@/components/Bedside';
import { ContinuousTabs } from '@/vendor/watermelon/continuous-tabs';
import { dxLabel, RESP_LABEL } from '@shared/reference';
import { fmtAge } from '@shared/time';
import type { CensusRow } from './types';
import { isPhone } from '@/lib/api';
import { useMonitorBeds, type BedSnapshot } from '@/lib/monitor';
import { censusBedFor } from '@shared/monitor/beds';

/** Live monitor readings keyed by census bed (desktop only; the monitor feed is not sent to phones). */
function useLiveByBed(): Map<string, BedSnapshot> {
  const { beds } = useMonitorBeds();
  const st = useApi<{ bedMap: Record<string, string> }>(isPhone() ? null : 'desktop.monitorStatus');
  const out = new Map<string, BedSnapshot>();
  for (const b of beds) {
    if (b.source !== 'network' || b.stale) continue;
    const cb = censusBedFor(st.data?.bedMap ?? {}, b.id, b.bed, false);
    if (cb) out.set(cb, b);
  }
  return out;
}

function LiveMini({ b }: { b: BedSnapshot }) {
  const out = (v?: BedSnapshot['values']['spo2']) => v?.value != null && v.alarmOn && ((v.low != null && v.value < v.low) || (v.high != null && v.value > v.high));
  const spo2 = b.values.spo2?.value, pr = b.values.pr?.value;
  return (
    <button onClick={e => { e.stopPropagation(); go(`monitor/${encodeURIComponent(b.id)}`); }} title="Live from the bedside monitor"
      className={cx('flex items-center gap-2 rounded-xl px-2.5 py-1 text-white', out(b.values.spo2) || out(b.values.pr) ? 'bg-crit' : '')}
      style={out(b.values.spo2) || out(b.values.pr) ? undefined : { background: 'linear-gradient(140deg,#2dd4bf,#0891b2)' }}>
      <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-70" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" /></span>
      <span className="tnum text-[13px] font-semibold">{spo2 ?? '--'}<span className="text-[10px] opacity-80">%</span></span>
      <span className="tnum text-[13px] font-semibold">{pr ?? '--'}<span className="text-[10px] opacity-80"> bpm</span></span>
    </button>
  );
}

export function Census({ onAdmit, canEdit }: { onAdmit: () => void; canEdit: boolean }) {
  const { data } = useApi<{ rows: CensusRow[]; beds: number; showIdentifiers: boolean }>('census.list');
  const [view, setView] = useState('beds');
  const toast = useToast();
  const live = useLiveByBed();
  if (!data) return null;
  const rows = data.rows;
  const byBed = Object.fromEntries(rows.filter(r => r.admission.bed).map(r => [r.admission.bed!, r]));
  const unbedded = rows.filter(r => !r.admission.bed || Number(r.admission.bed) > data.beds);
  const counts = { mv: rows.filter(r => r.resp.level === 'MV').length, niv: rows.filter(r => r.resp.level === 'NIV').length, vaso: rows.filter(r => r.vaso.length).length, abx: rows.filter(r => r.abx.length).length };

  const setResp = async (r: CensusRow, level: any) => {
    try { await call('resp.set', { admissionId: r.admission.id, level }); toast(`Bed ${r.admission.bed ?? '—'}: ${RESP_LABEL[r.resp.level]} → ${RESP_LABEL[level as 'MV']}`); }
    catch (e: any) { toast(e.message, 'crit'); }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon={<BedDouble className="text-accent-ink" size={22} />} title="Census board"
        subtitle="Every patient in the unit. Change respiratory support with one tap; open a bed for therapy, events and discharge."
        chips={<>
          <Chip tone="accent" dot>{rows.length} / {data.beds} beds</Chip>
          <Chip tone="crit">{counts.mv} ventilated</Chip>
          <Chip tone="warn">{counts.niv} on NIV</Chip>
          <Chip>{counts.vaso} on vasoactives</Chip>
          <Chip>{counts.abx} on antimicrobials</Chip>
        </>}
        actions={<>
          <ContinuousTabs size="md" tabs={[{ id: 'beds', label: 'Beds' }, { id: 'list', label: 'List' }]} value={view} onChange={setView} />
          {canEdit && <Button variant="primary" onClick={onAdmit}><Plus size={16} />Admit <span className="kbd border-white/30 bg-white/10 text-white/80">A</span></Button>}
        </>} />

      {view === 'beds' ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: data.beds }, (_, i) => String(i + 1)).map((bed, i) => {
            const r = byBed[bed];
            return r ? <BedCard key={bed} r={r} i={i} canEdit={canEdit} live={live.get(bed)} onResp={l => setResp(r, l)} />
              : (
                <button key={bed} onClick={canEdit ? onAdmit : undefined}
                  className="flex min-h-[188px] flex-col items-center justify-center gap-2 rounded-[18px] border border-dashed border-line-2 text-ink-3 transition hover:border-accent hover:text-accent-ink">
                  <span className="tnum text-[13px] font-semibold">Bed {bed}</span>
                  <span className="text-[12px]">Available{canEdit ? ' · admit' : ''}</span>
                </button>
              );
          })}
          {unbedded.map((r, i) => <BedCard key={r.admission.id} r={r} i={data.beds + i} canEdit={canEdit} live={r.admission.bed ? live.get(r.admission.bed) : undefined} onResp={l => setResp(r, l)} />)}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-panel-2/60 text-left text-[11.5px] text-ink-3">
              <tr>{['Bed', 'Patient', 'Diagnosis', 'Stay', 'Support', 'Vasoactives', 'Antimicrobials', ''].map(h => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.admission.id} onClick={() => go(`patient/${r.admission.id}`)} className="cursor-pointer border-t border-line hover:bg-panel-2/50">
                  <td className="tnum px-4 py-3 font-semibold">{r.admission.bed ?? '—'}</td>
                  <td className="px-4 py-3"><div className="font-medium">{r.name ?? r.label}</div><div className="text-[11.5px] text-ink-3">{r.mrn ?? r.label} · {fmtAge(r.admission.ageMonths)} · {r.admission.sex}</div></td>
                  <td className="px-4 py-3">{dxLabel(r.admission.primaryDx)}</td>
                  <td className="tnum px-4 py-3 text-ink-2">{losLabel(r.losDays)}</td>
                  <td className="px-4 py-3"><RespChip level={r.resp.level} /></td>
                  <td className="px-4 py-3 text-ink-2">{r.vaso.map(v => v.agent).join(', ') || '—'}</td>
                  <td className="px-4 py-3 text-ink-2">{r.abx.map(a => a.drug + (a.due?.overdueMin ? ' (overdue)' : '')).join(', ') || '—'} <PewsChip p={r.pews} compact /></td>
                  <td className="px-4 py-3">{r.issues > 0 && <Chip tone="warn"><AlertTriangle size={11} />{r.issues}</Chip>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <Empty icon={<BedDouble size={18} />} title="No patients in the unit" />}
        </div>
      )}
    </div>
  );
}

function BedCard({ r, i, canEdit, onResp, live }: { r: CensusRow; i: number; canEdit: boolean; onResp: (l: any) => void; live?: BedSnapshot }) {
  const a = r.admission;
  const critical = r.resp.level === 'MV' || r.vaso.length > 0;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.02 }}
      className={cx('card group flex min-h-[188px] cursor-pointer flex-col p-4 transition hover:border-line-2', critical && 'ring-1 ring-crit/25')}
      onClick={() => go(`patient/${a.id}`)}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className={cx('tnum grid h-7 min-w-7 place-items-center rounded-lg px-1.5 text-[12px] font-semibold', critical ? 'bg-crit-soft text-crit-ink' : 'bg-panel-3 text-ink-2')}>{a.bed ?? '—'}</span>
          <span className="text-[12px] text-ink-3">Day {Math.floor(r.losDays) + 1} · {losLabel(r.losDays)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          {r.culturesSent > r.culturesResulted && <span title="Culture sent, no result yet" className="text-info-ink"><FlaskConical size={14} /></span>}
          {r.issues > 0 && <span title={`${r.issues} data-quality warning(s)`} className="text-warn-ink"><AlertTriangle size={14} /></span>}
        </span>
      </div>
      <div className="mt-3">
        <p className="truncate text-[15px] font-semibold">{dxLabel(a.primaryDx)}</p>
        <p className="truncate text-[12px] text-ink-3">{r.name ?? r.label} · {fmtAge(a.ageMonths)} · {a.sex}{a.weightKg ? ` · ${a.weightKg} kg` : ''}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {r.vaso.map(v => <Chip key={v.id} tone="accent"><HeartPulse size={11} />{v.agent}</Chip>)}
        <PewsChip p={r.pews} />
        {r.abx.slice(0, 3).map(x => <Chip key={x.id} tone={x.due?.overdueMin ? 'crit' : 'neutral'}><Pill size={11} />{x.drug}{dueLabel(x.due) && <span className="opacity-75">· {dueLabel(x.due)}</span>}</Chip>)}
        {r.abx.length > 3 && <Chip>+{r.abx.length - 3}</Chip>}
      </div>
      <div className="mt-auto flex items-center justify-between pt-3" onClick={e => e.stopPropagation()}>
        {canEdit ? <RespSegment value={r.resp.level} onChange={onResp} /> : <RespChip level={r.resp.level} />}
        {live && <LiveMini b={live} />}
      </div>
    </motion.div>
  );
}
