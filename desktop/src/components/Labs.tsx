// Laboratory results on the patient page: latest value per analyte with reference flags, trend
// sparklines and derived values, plus quick entry (tap a panel, type, or paste the lab report).
import { useMemo, useState } from 'react';
import { ClipboardPaste, Copy, FlaskConical, Plus, Table2 } from 'lucide-react';
import { call } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { cx } from '@/lib/format';
import { Button, CardHeader, Chip, ErrorNote, Field, Modal, useToast } from '@/components/ui';
import { PANELS, derivedLabs, labFlag, parseLabText, rangeLabel, type LabFlag, type ParsedLab } from '@shared/labs';
import { VITALS, type VitalCode, type VitalValues } from '@shared/vitals';
import { nowLocal } from '@shared/time';
import type { LabPanel } from '@shared/vitals';

interface LabSet { id: string; at: string; values: VitalValues }
const FLAG_STYLE: Record<LabFlag, string> = { H: 'text-warn-ink', L: 'text-warn-ink', HH: 'text-crit-ink', LL: 'text-crit-ink' };
const FLAG_BG: Record<LabFlag, string> = { H: 'bg-warn-soft', L: 'bg-warn-soft', HH: 'bg-crit-soft', LL: 'bg-crit-soft' };
const fmt = (c: VitalCode, v: number) => v.toFixed(VITALS[c].decimals);
const when = (at: string) => new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Tiny trend line; the last point is emphasised. */
export function MiniTrend({ values, flag, width = 64, height = 22 }: { values: number[]; flag?: LabFlag | null; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => [2 + (i / (values.length - 1)) * (width - 4), height - 3 - ((v - lo) / span) * (height - 6)]);
  const color = flag === 'HH' || flag === 'LL' ? 'var(--crit)' : flag ? 'var(--warn)' : 'var(--series-3)';
  return (
    <svg width={width} height={height} aria-hidden className="shrink-0">
      <polyline points={pts.map(p => p.join(',')).join(' ')} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.4} fill={color} />
    </svg>
  );
}

export function LabsCard({ admissionId, ageMonths, editable }: { admissionId: string; ageMonths: number | null; editable: boolean }) {
  const { data } = useApi<{ sets: LabSet[] }>('vitals.forAdmission', { admissionId });
  const [open, setOpen] = useState(false);
  const [table, setTable] = useState(false);
  // Oldest → newest series per analyte, from every set that holds it (labs may arrive at different times).
  const series = useMemo(() => {
    const out = new Map<VitalCode, { at: string; v: number }[]>();
    [...(data?.sets ?? [])].reverse().forEach(s => Object.entries(s.values).forEach(([c, v]) => {
      const code = c as VitalCode;
      if (VITALS[code]?.group !== 'lab' || v == null) return;
      if (!out.has(code)) out.set(code, []);
      out.get(code)!.push({ at: s.at, v: v as number });
    }));
    return out;
  }, [data]);
  const toast = useToast();
  if (!data) return null;
  const remove = async (id: string) => { try { await call('vitals.delete', { id }); toast('Results removed'); } catch (e: any) { toast(e.message, 'crit'); } };
  const latest: VitalValues = Object.fromEntries([...series].map(([c, xs]) => [c, xs[xs.length - 1].v]));
  const fio2 = data.sets.find(s => s.values.fio2 != null && s.values.pao2 != null);
  const derived = derivedLabs({ ...latest, ...(fio2 ? { fio2: fio2.values.fio2, pao2: fio2.values.pao2 } : {}) });
  const panels = PANELS.map(p => ({ ...p, codes: p.codes.filter(c => series.has(c)) })).filter(p => p.codes.length);
  const flagged = [...series.keys()].filter(c => labFlag(c, latest[c], ageMonths));
  const labSets = data.sets.filter(s => Object.keys(s.values).some(k => VITALS[k as VitalCode]?.group === 'lab')).slice(0, 6);

  return (
    <div className="card p-5">
      <CardHeader title="Laboratory" info="Latest value of each analyte. H/L use typical paediatric reference ranges for this age — your laboratory's own ranges take precedence."
        right={<div className="flex gap-2">
          {panels.length > 0 && <Button size="sm" variant="ghost" onClick={() => setTable(!table)}><Table2 size={14} />{table ? 'Tiles' : 'Table'}</Button>}
          {editable && <Button size="sm" variant="primary" onClick={() => setOpen(true)}><Plus size={14} />Add results</Button>}
        </div>} />
      {!panels.length ? (
        <div className="flex items-center gap-3 rounded-xl bg-panel-2 px-4 py-3 text-[12.5px] text-ink-3">
          <FlaskConical size={16} />No laboratory results yet{editable ? ' — tap a panel or paste the lab report.' : '.'}
        </div>
      ) : table ? (
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead><tr className="text-left text-ink-3"><th className="py-1.5 pr-3 font-medium">Analyte</th>{labSets.map(s => <th key={s.id} className="tnum px-2 py-1.5 font-medium whitespace-nowrap">{when(s.at)}{editable && <button className="ml-1 text-ink-3 hover:text-crit-ink" title="Remove these results (kept in the audit log)" onClick={() => remove(s.id)}>×</button>}</th>)}</tr></thead>
            <tbody>
              {panels.flatMap(p => p.codes).map(c => (
                <tr key={c} className="border-t border-line">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{VITALS[c].short} <span className="text-ink-3">{VITALS[c].unit}</span></td>
                  {labSets.map(s => { const v = s.values[c]; const f = labFlag(c, v, ageMonths); return <td key={s.id} className={cx('tnum px-2 py-1.5', f && FLAG_STYLE[f], f && 'font-semibold')}>{v != null ? `${fmt(c, v)}${f ? ` ${f}` : ''}` : ''}</td>; })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {flagged.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {flagged.map(c => { const f = labFlag(c, latest[c], ageMonths)!; return <Chip key={c} tone={f.length === 2 ? 'crit' : 'warn'}>{VITALS[c].short} {fmt(c, latest[c]!)} {f}</Chip>; })}
            </div>
          )}
          {panels.map(p => (
            <div key={p.id}>
              <p className="mb-1.5 text-[11.5px] font-medium tracking-wide text-ink-3 uppercase">{p.label}</p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2">
                {p.codes.map(c => {
                  const xs = series.get(c)!, last = xs[xs.length - 1], f = labFlag(c, last.v, ageMonths);
                  return (
                    <div key={c} className={cx('flex min-w-0 flex-col gap-0.5 rounded-xl px-3 py-2', f ? FLAG_BG[f] : 'bg-panel-2')} title={`Reference ${rangeLabel(c, ageMonths) ?? '—'} ${VITALS[c].unit}`}>
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate text-[11px] text-ink-3">{VITALS[c].short} <span className="opacity-70">{VITALS[c].unit}</span></span>
                        {f && <span className={cx('text-[10.5px] font-bold', FLAG_STYLE[f])}>{f}</span>}
                      </div>
                      <div className="flex items-end justify-between gap-2">
                        <span className={cx('tnum text-[18px] leading-tight font-semibold', f && FLAG_STYLE[f])}>{fmt(c, last.v)}</span>
                        <MiniTrend values={xs.slice(-8).map(x => x.v)} flag={f} />
                      </div>
                      <span className="tnum truncate text-[10.5px] text-ink-3">{when(last.at)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {derived.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {derived.map(d => <div key={d.id} className="inset px-3 py-2 text-[12.5px]" title={d.note}><span className="text-ink-3">{d.label}</span> <b className="tnum">{d.value}</b> <span className="text-ink-3">{d.unit}</span></div>)}
            </div>
          )}
        </div>
      )}
      {open && <LabEntryModal admissionId={admissionId} ageMonths={ageMonths} previous={latest} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function LabEntryModal({ admissionId, ageMonths, previous, onClose }: { admissionId: string; ageMonths: number | null; previous: VitalValues; onClose: () => void }) {
  const toast = useToast();
  const [panels, setPanels] = useState<LabPanel[]>(['cbc']);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [at, setAt] = useState(nowLocal());
  const [paste, setPaste] = useState('');
  const [parsed, setParsed] = useState<{ values: ParsedLab[]; unmatched: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const togglePanel = (p: LabPanel) => setPanels(ps => (ps.includes(p) ? ps.filter(x => x !== p) : [...ps, p]));
  const shown = PANELS.filter(p => panels.includes(p.id));
  const filled = Object.entries(vals).filter(([, v]) => v.trim() !== '');
  const readPaste = () => {
    const r = parseLabText(paste);
    setParsed(r);
    if (!r.values.length) return;
    setVals(v => ({ ...v, ...Object.fromEntries(r.values.map(x => [x.code, String(x.value)])) }));
    const hit = PANELS.filter(p => p.codes.some(c => r.values.some(x => x.code === c))).map(p => p.id);
    setPanels(ps => [...new Set([...ps, ...hit])]);
  };
  const copyPrevious = () => {
    const codes = shown.flatMap(p => p.codes).filter(c => previous[c] != null);
    setVals(v => ({ ...v, ...Object.fromEntries(codes.map(c => [c, String(previous[c])])) }));
  };
  const save = async () => {
    setErr(null);
    if (!filled.length) return setErr('Enter at least one result.');
    try {
      await call('vitals.add', { admissionId, at, context: 'routine', values: Object.fromEntries(filled.map(([c, v]) => [c, Number(v)])) });
      toast(`${filled.length} result${filled.length > 1 ? 's' : ''} saved`); onClose();
    } catch (e: any) { setErr(e.message); }
  };
  return (
    <Modal open onClose={onClose} title="Add laboratory results" subtitle="Tap the panels you have, then type the values — or paste the lab report and check what was read." width={760}
      footer={<><span className="mr-auto text-[12px] text-ink-3">{filled.length} value{filled.length === 1 ? '' : 's'}</span><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save results</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-1 flex-wrap gap-1.5">
            {PANELS.map(p => (
              <button key={p.id} type="button" onClick={() => togglePanel(p.id)}
                className={cx('h-8 rounded-full border px-3.5 text-[13px] transition', panels.includes(p.id) ? 'border-accent bg-accent-soft font-medium text-accent-ink' : 'border-line bg-panel-2 text-ink-2 hover:text-ink')}>{p.label}</button>
            ))}
          </div>
          <Field label="Sample time" className="w-[210px]"><input id="lab-at" type="datetime-local" className="field tnum" value={at} onChange={e => setAt(e.target.value)} /></Field>
        </div>

        {shown.map(p => (
          <div key={p.id}>
            <p className="mb-1.5 text-[11.5px] font-medium tracking-wide text-ink-3 uppercase">{p.label}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {p.codes.map(c => {
                const v = vals[c] ?? '', n = v.trim() === '' ? null : Number(v), f = labFlag(c, n, ageMonths);
                const note = parsed?.values.find(x => x.code === c)?.note;
                return (
                  <label key={c} className="flex flex-col gap-1">
                    <span className="flex items-center justify-between text-[11.5px] text-ink-3"><span>{VITALS[c].label}</span>{f && <span className={cx('font-bold', FLAG_STYLE[f])}>{f}</span>}</span>
                    <div className="relative">
                      <input id={`lab-${c}`} className={cx('field tnum pr-16', f && f.length === 2 && 'border-crit')} inputMode="decimal" value={v} placeholder={rangeLabel(c, ageMonths) ?? ''}
                        onChange={e => setVals(x => ({ ...x, [c]: e.target.value }))} />
                      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[11px] text-ink-3">{VITALS[c].unit}</span>
                    </div>
                    {note && <span className="text-[10.5px] text-info-ink">{note}</span>}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
        {shown.length > 0 && Object.keys(previous).length > 0 && <Button size="sm" variant="ghost" className="self-start" onClick={copyPrevious}><Copy size={13} />Copy previous values for these panels</Button>}

        <div className="inset flex flex-col gap-2 p-3.5">
          <span className="flex items-center gap-1.5 text-[12.5px] font-medium"><ClipboardPaste size={14} />Paste a lab report</span>
          <textarea id="lab-paste" className="field min-h-[96px] font-mono text-[12px]" placeholder={'Hb 11.2 g/dL\nTLC 12,500 /cmm\nPlatelets 2.1 lakh\nCreatinine 0.6 mg/dL\nNa 134  K 3.2'} value={paste} onChange={e => setPaste(e.target.value)} />
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" disabled={!paste.trim()} onClick={readPaste}>Read values</Button>
            {parsed && <span className="text-[12px] text-ink-3">{parsed.values.length} read{parsed.unmatched.length ? ` · ${parsed.unmatched.length} line${parsed.unmatched.length > 1 ? 's' : ''} not understood` : ''} — check them above before saving.</span>}
          </div>
          {!!parsed?.unmatched.length && <p className="text-[11.5px] text-warn-ink">Not read: {parsed.unmatched.slice(0, 6).join(' · ')}</p>}
        </div>
        <ErrorNote text={err} />
      </div>
    </Modal>
  );
}
