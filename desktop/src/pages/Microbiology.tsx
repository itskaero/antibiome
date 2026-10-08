import { useEffect, useMemo, useState } from 'react';
import { FlaskConical, Plus, Search, Trash2 } from 'lucide-react';
import { call } from '@/lib/api';
import { go, useApi } from '@/lib/hooks';
import { cx } from '@/lib/format';
import { Button, CardHeader, Chip, Empty, PageHeader, Toggle, useToast } from '@/components/ui';
import { HBars } from '@/components/charts';
import { CultureForm } from '@/components/CultureForm';
import { ContinuousTabs } from '@/vendor/watermelon/continuous-tabs';
import { SPECIMEN_TYPES } from '@shared/reference';
import { ANTIBIOGRAM_MIN_N, type Antibiogram } from '@shared/antibiogram';
import { toDateStr } from '@shared/time';

const PERIODS = [{ id: '12m', label: 'Last 12 months' }, { id: 'ytd', label: 'This year' }, { id: 'all', label: 'All time' }];
const periodFrom = (p: string) => { const d = new Date(); if (p === '12m') { d.setFullYear(d.getFullYear() - 1); return toDateStr(d); } if (p === 'ytd') return `${d.getFullYear()}-01-01`; return undefined; };

export function Microbiology({ canEdit, openNew }: { canEdit: boolean; openNew: boolean }) {
  const [tab, setTab] = useState('antibiogram');
  const [unit, setUnit] = useState('');
  const [specimen, setSpecimen] = useState('');
  const [period, setPeriod] = useState('12m');
  const [firstIsolate, setFirstIsolate] = useState(true);
  const [form, setForm] = useState<{ open: boolean; existing?: any }>({ open: openNew });
  useEffect(() => { if (openNew) setForm({ open: true }); }, [openNew]);
  const summary = useApi<{ antibiogram: Antibiogram; units: string[]; total: number; mdrVersion: string }>('micro.summary', { unit, specimen, from: periodFrom(period), firstIsolateOnly: firstIsolate });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon={<FlaskConical className="text-accent-ink" size={22} />} title="Microbiology"
        subtitle="Cumulative antibiogram, culture records and MDR isolates — the original Antibiome, now linked to admissions."
        chips={<><Chip>{summary.data?.total ?? 0} cultures in view</Chip><Chip>MDR definition {summary.data?.mdrVersion}</Chip></>}
        actions={canEdit && <Button variant="primary" onClick={() => setForm({ open: true })}><Plus size={16} />Add culture</Button>} />

      <div className="flex flex-wrap items-center gap-2">
        <ContinuousTabs size="md" tabs={[{ id: 'antibiogram', label: 'Antibiogram' }, { id: 'cultures', label: 'Cultures' }, { id: 'mdr', label: 'MDR isolates' }]} value={tab} onChange={setTab} />
        <span className="mx-1 h-6 w-px bg-line" />
        <select className="field h-9 w-36" value={unit} onChange={e => setUnit(e.target.value)} aria-label="Unit">
          <option value="">All units</option>{summary.data?.units.map(u => <option key={u}>{u}</option>)}
        </select>
        <select className="field h-9 w-40" value={specimen} onChange={e => setSpecimen(e.target.value)} aria-label="Specimen">
          <option value="">All specimens</option>{SPECIMEN_TYPES.map(s => <option key={s}>{s}</option>)}
        </select>
        <select className="field h-9 w-40" value={period} onChange={e => setPeriod(e.target.value)} aria-label="Period">
          {PERIODS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {tab === 'antibiogram' && <Toggle checked={firstIsolate} onChange={setFirstIsolate} label="First isolate per patient" />}
      </div>

      {tab === 'antibiogram' && <AntibiogramTable ab={summary.data?.antibiogram} firstIsolate={firstIsolate} />}
      {tab !== 'antibiogram' && <CultureList unit={unit} specimen={specimen} from={periodFrom(period)} mdrOnly={tab === 'mdr'} canEdit={canEdit} onEdit={c => setForm({ open: true, existing: c })} />}

      <CultureForm open={form.open} existing={form.existing} onClose={() => { setForm({ open: false }); if (openNew) go('micro'); }} />
    </div>
  );
}

function AntibiogramTable({ ab, firstIsolate }: { ab?: Antibiogram; firstIsolate: boolean }) {
  if (!ab) return null;
  if (!ab.rows.length) return <div className="card"><Empty icon={<FlaskConical size={18} />} title="No positive cultures in this view" /></div>;
  const cls = (p: number) => (p >= 80 ? 'bg-good-soft text-good-ink' : p >= 50 ? 'bg-warn-soft text-warn-ink' : 'bg-crit-soft text-crit-ink');
  return (
    <div className="card overflow-hidden">
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-[12.5px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border-b border-line bg-panel px-4 py-3 text-left font-medium text-ink-3">Organism</th>
              {ab.drugs.map(dr => <th key={dr} className="h-32 border-b border-line px-1 align-bottom font-medium text-ink-3"><span className="inline-block max-w-[120px] origin-bottom-left translate-x-3 -rotate-45 truncate whitespace-nowrap">{dr.replace(' (Septran/Co-trimoxazole)', '')}</span></th>)}
            </tr>
          </thead>
          <tbody>
            {ab.rows.map(r => (
              <tr key={r.organism}>
                <td className="sticky left-0 z-10 border-b border-line bg-panel px-4 py-2 whitespace-nowrap"><i>{r.organism}</i> <span className="text-[11px] text-ink-3">n={r.isolates}</span></td>
                {ab.drugs.map(dr => {
                  const c = r.cells[dr];
                  return (
                    <td key={dr} className="border-b border-line px-1 py-1.5 text-center">
                      {c?.pctS != null
                        ? <span title={`${c.S} S · ${c.I} I · ${c.R} R (n=${c.n})`} className={cx('tnum inline-block min-w-[42px] rounded-md px-1.5 py-0.5 font-semibold', cls(c.pctS), c.n < ANTIBIOGRAM_MIN_N && 'opacity-60')}>
                            {c.pctS}%{c.n < ANTIBIOGRAM_MIN_N && <sup className="ml-px font-normal">†</sup>}
                          </span>
                        : <span className="text-ink-3">·</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line px-4 py-3 text-[11.5px] text-ink-3">
        <span>%S = susceptible ÷ tested (S+I+R)</span>
        <span>† fewer than {ANTIBIOGRAM_MIN_N} isolates tested — interpret with caution (CLSI M39)</span>
        <span>{firstIsolate ? `First isolate per patient · ${ab.duplicatesRemoved} repeat isolates excluded` : 'All isolates (includes repeats)'}</span>
        <span>Unlinked legacy cultures cannot be de-duplicated</span>
      </div>
    </div>
  );
}

function CultureList({ unit, specimen, from, mdrOnly, canEdit, onEdit }: { unit: string; specimen: string; from?: string; mdrOnly: boolean; canEdit: boolean; onEdit: (c: any) => void }) {
  const { data } = useApi<any[]>('culture.list', { unit });
  const [q, setQ] = useState('');
  const toast = useToast();
  const rows = useMemo(() => (data ?? []).filter(c => (!specimen || c.specimen === specimen) && (!from || c.collectedAt >= from) && (!mdrOnly || c.mdr)
    && (!q || `${c.organism ?? 'no growth'} ${c.patientLabel} ${c.specimen}`.toLowerCase().includes(q.toLowerCase()))), [data, specimen, from, mdrOnly, q]);
  const byOrg = useMemo(() => { const m: Record<string, number> = {}; rows.forEach(c => { if (c.organism) m[c.organism] = (m[c.organism] ?? 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8); }, [rows]);

  return (
    <div className={cx('grid gap-3', mdrOnly && 'xl:grid-cols-[1.7fr_1fr]')}>
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Search size={14} className="text-ink-3" />
          <input className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-3" placeholder="Search organism, patient, specimen…" value={q} onChange={e => setQ(e.target.value)} />
          <span className="text-[12px] text-ink-3">{rows.length} records</span>
        </div>
        <div className="scroll-thin max-h-[600px] overflow-y-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-panel text-left text-[11.5px] text-ink-3">
              <tr>{['Date', 'Patient', 'Unit', 'Specimen', 'Organism', mdrOnly ? 'Non-susceptible classes' : 'Status', ''].map(h => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.slice(0, 400).map(c => (
                <tr key={c.id} className="group border-t border-line hover:bg-panel-2/50">
                  <td className="tnum px-4 py-2.5 text-ink-2">{c.collectedAt.slice(0, 10)}</td>
                  <td className="px-4 py-2.5">{c.admissionId ? <button className="hover:text-accent-ink hover:underline" onClick={() => go(`patient/${c.admissionId}`)}>{c.patientLabel}</button> : <span className="text-ink-3">{c.patientLabel}</span>}</td>
                  <td className="px-4 py-2.5 text-ink-2">{c.unit}</td>
                  <td className="px-4 py-2.5 text-ink-2">{c.specimen}</td>
                  <td className="px-4 py-2.5"><i>{c.organism ?? <span className="text-ink-3 not-italic">No growth</span>}</i></td>
                  <td className="px-4 py-2.5">{mdrOnly ? <span className="text-[12px] text-crit-ink">{c.resistantClasses.join(', ')}</span> : c.mdr ? <Chip tone="crit">MDR</Chip> : c.organism ? <Chip>{c.antibiotics.length} AST</Chip> : null}</td>
                  <td className="px-2 py-2.5 text-right whitespace-nowrap">
                    {canEdit && <>
                      <button className="px-1.5 text-[12px] text-ink-3 opacity-0 group-hover:opacity-100 hover:text-ink" onClick={() => onEdit(c)}>Edit</button>
                      <button className="px-1.5 text-ink-3 opacity-0 group-hover:opacity-100 hover:text-crit-ink" aria-label="Delete"
                        onClick={async () => { if (confirm('Remove this culture? It stays in the audit log.')) { try { await call('culture.delete', { id: c.id }); toast('Culture removed'); } catch (e: any) { toast(e.message, 'crit'); } } }}><Trash2 size={13} /></button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <Empty title={mdrOnly ? 'No MDR isolates in this view' : 'No cultures in this view'} />}
        </div>
      </div>
      {mdrOnly && (
        <div className="card p-5">
          <CardHeader title="MDR isolates by organism" info="Non-susceptible (R or I) in ≥ 3 relevant antimicrobial categories — definition v1." />
          {byOrg.length ? <HBars rows={byOrg.map(([o, n]) => ({ key: o, label: <i>{o}</i>, value: n, color: 'var(--crit)' }))} /> : <Empty title="None" />}
        </div>
      )}
    </div>
  );
}
