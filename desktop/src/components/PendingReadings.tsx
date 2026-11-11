// Readings proposed from the bedside monitor, waiting for a clinician: confirm puts them in the chart
// as a routine vital-sign set; dismiss discards them. Both are audited.
import { useState } from 'react';
import { Check, MonitorDot, X } from 'lucide-react';
import { call } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { Button, useToast } from '@/components/ui';
import { VITALS, type VitalCode } from '@shared/vitals';

interface Pending { id: string; at: string; source: string; values: Partial<Record<VitalCode, number>> }

export function PendingReadings({ admissionId, editable }: { admissionId: string; editable: boolean }) {
  const { data } = useApi<Pending[]>('vitals.pending', { admissionId });
  const toast = useToast();
  const [open, setOpen] = useState(false);
  if (!data?.length) return null;
  const resolve = async (ids: string[], decision: 'confirmed' | 'dismissed') => {
    try { const n = await call<number>('vitals.resolvePending', { ids, decision }); toast(decision === 'confirmed' ? `${n} reading${n === 1 ? '' : 's'} added to the chart` : `${n} dismissed`); }
    catch (e: any) { toast(e.message, 'crit'); }
  };
  const fmt = (v: Pending['values']) => (Object.entries(v) as [VitalCode, number][]).map(([c, x]) => `${VITALS[c].short} ${x}`).join(' · ');
  return (
    <div className="rounded-[18px] border border-[#2dd4bf]/40 p-4" style={{ background: 'linear-gradient(120deg, rgba(45,212,191,0.14), rgba(8,145,178,0.06))' }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[13.5px] font-semibold"><MonitorDot size={16} className="text-[#14b8a6]" />{data.length} monitor reading{data.length === 1 ? '' : 's'} waiting for the chart</span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Review'}</Button>
          {editable && <Button size="sm" variant="primary" onClick={() => resolve(data.map(p => p.id), 'confirmed')}><Check size={14} />Confirm all</Button>}
        </div>
      </div>
      {open && (
        <ul className="mt-3 flex flex-col divide-y divide-line rounded-xl bg-panel">
          {data.map(p => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-[12.5px]">
              <span className="tnum w-24 shrink-0 text-ink-3">{p.at.slice(5).replace('T', ' ')}</span>
              <span className="tnum min-w-0 flex-1 font-medium">{fmt(p.values)}</span>
              <span className="text-[11.5px] text-ink-3">{p.source}</span>
              {editable && <span className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => resolve([p.id], 'confirmed')} title="Add to the chart"><Check size={14} /></Button>
                <Button size="sm" variant="ghost" onClick={() => resolve([p.id], 'dismissed')} title="Dismiss"><X size={14} /></Button>
              </span>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11.5px] text-ink-3">Median of the last 5 minutes from the monitor; only verified values. Check them against the bedside before confirming.</p>
    </div>
  );
}
