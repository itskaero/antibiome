// Patients archive: every admission, current and past, searchable by MRN, name (clinical roles),
// pseudonymous ID, diagnosis, ICD-10 code or bed, and filterable by status and admission date.
import { useEffect, useState } from 'react';
import { Search, Users } from 'lucide-react';
import { go, useApi } from '@/lib/hooks';
import { cx, losLabel } from '@/lib/format';
import { Button, Chip, Empty, Field, PageHeader } from '@/components/ui';
import { ContinuousTabs } from '@/vendor/watermelon/continuous-tabs';
import { dxLabel } from '@shared/reference';
import { fmtAge } from '@shared/time';
import type { Admission } from '@shared/types';

interface Row { admission: Admission; label: string; name: string | null; mrn: string | null; losDays: number }
const STATUS = [{ id: 'all', label: 'All' }, { id: 'in', label: 'In unit' }, { id: 'discharged', label: 'Discharged' }, { id: 'died', label: 'Died' }];
const PAGE = 50;

/** Debounced value, so typing doesn't re-query on every key. */
function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function Patients() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const dq = useDebounced(q);
  useEffect(() => setLimit(PAGE), [dq, status, from, to]);
  const { data } = useApi<{ rows: Row[]; total: number; showIdentifiers: boolean }>('patients.search', { q: dq, status, from: from || null, to: to || null, limit });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon={<Users className="text-accent-ink" size={22} />} title="Patients"
        subtitle={data?.showIdentifiers ? 'Every admission, current and past. Search by MRN, name, ID, diagnosis, ICD-10 code or bed.' : 'Every admission, current and past. Search by ID, diagnosis, ICD-10 code or bed.'}
        chips={data && <Chip>{data.total} admission{data.total === 1 ? '' : 's'}</Chip>} />

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Search" className="min-w-[240px] flex-1">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
            <input className="field pl-8" value={q} onChange={e => setQ(e.target.value)} autoFocus
              placeholder={data?.showIdentifiers ? 'MRN, name, diagnosis…' : 'P-ID, diagnosis, ICD-10…'} />
          </div>
        </Field>
        <Field label="Admitted from"><input type="date" className="field w-40" value={from} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label="to"><input type="date" className="field w-40" value={to} onChange={e => setTo(e.target.value)} /></Field>
        <ContinuousTabs size="md" tabs={STATUS} value={status} onChange={setStatus} />
      </div>

      <div className="card overflow-hidden">
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-panel-2/60 text-left text-[11.5px] text-ink-3">
              <tr>{['Patient', 'Diagnosis', 'Admitted', 'Stay', 'Outcome', 'Discharged'].map(h => <th key={h} className="px-4 py-2.5 font-medium whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map(r => {
                const a = r.admission;
                return (
                  <tr key={a.id} onClick={() => go(`patient/${a.id}`)} className="cursor-pointer border-t border-line hover:bg-panel-2/50">
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.name ?? r.label}</div>
                      <div className="text-[11.5px] text-ink-3">{r.mrn ? `${r.mrn} · ` : ''}{fmtAge(a.ageMonths)} · {a.sex}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{dxLabel(a.primaryDx)}</div>
                      {!!a.secondaryDx.length && <div className="text-[11.5px] text-ink-3">+ {a.secondaryDx.map(dxLabel).join(', ')}</div>}
                    </td>
                    <td className="tnum px-4 py-3 whitespace-nowrap text-ink-2">{a.admitAt.slice(0, 10)}<span className="text-ink-3"> {a.admitAt.slice(11, 16)}</span></td>
                    <td className="tnum px-4 py-3 whitespace-nowrap text-ink-2">{losLabel(r.losDays)}</td>
                    <td className="px-4 py-3">
                      {a.dischargeAt
                        ? <Chip tone={a.disposition === 'Died' ? 'crit' : 'good'}>{a.disposition === 'Died' ? 'Died' : `→ ${a.disposition}`}</Chip>
                        : <Chip tone="accent" dot>In PICU{a.bed ? ` · bed ${a.bed}` : ''}</Chip>}
                    </td>
                    <td className="tnum px-4 py-3 whitespace-nowrap text-ink-2">{a.dischargeAt ? a.dischargeAt.slice(0, 10) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data && !data.rows.length && <Empty icon={<Users size={18} />} title={q || from || to || status !== 'all' ? 'No admissions match' : 'No admissions yet'} />}
        {data && data.rows.length < data.total && (
          <div className={cx('flex items-center justify-between border-t border-line px-4 py-3 text-[12px] text-ink-3')}>
            <span>Showing {data.rows.length} of {data.total}</span>
            <Button size="sm" onClick={() => setLimit(l => l + PAGE)}>Show {Math.min(PAGE, data.total - data.rows.length)} more</Button>
          </div>
        )}
      </div>
    </div>
  );
}
