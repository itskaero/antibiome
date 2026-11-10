// Bedside tools shared by the PC and the phone: PEWS (chip + quick score), antimicrobial dose timing,
// the weight-based emergency drug sheet / infusion calculator, and the SBAR handover.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Check, Clock, Copy, Printer, Share2, Syringe, Zap } from 'lucide-react';
import { call, isPhone } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { cx } from '@/lib/format';
import { Button, CardHeader, Chip, useToast } from '@/components/ui';
import { PEWS_EXTRAS, PEWS_ITEMS, emptyPews, pewsTotal, type PewsDraft } from '@shared/scores';
import { PEWS_ACTION, pewsLevel, pewsSuggest, type PewsLevel, type PewsStatus, type PewsThresholds } from '@shared/pews';
import { doseFromRate, emergencySheet, infusionRate, makeUp, type DrugTable, type Infusion } from '@shared/drugs';
import type { DoseDue } from '@shared/doses';
import { nowLocal } from '@shared/time';
import type { VitalValues } from '@shared/vitals';

// ── PEWS ─────────────────────────────────────────────────────

const LEVEL_TONE: Record<PewsLevel, 'good' | 'warn' | 'crit' | 'neutral'> = { routine: 'good', senior: 'warn', doctor: 'crit', urgent: 'crit' };

export function PewsChip({ p, compact }: { p?: PewsStatus | null; compact?: boolean }) {
  if (!p) return null;
  if (p.score == null) return <Chip tone="warn" dot>PEWS due</Chip>;
  const Arrow = p.trend === 'up' ? ArrowUp : p.trend === 'down' ? ArrowDown : null;
  return (
    <Chip tone={LEVEL_TONE[p.level!]} dot={p.level === 'urgent'}>
      <span className="tnum font-semibold">PEWS {p.score}</span>{Arrow && <Arrow size={11} />}
      {!compact && p.overdue && <span className="opacity-80">· due</span>}
    </Chip>
  );
}

export function EscalationNote({ level }: { level: PewsLevel }) {
  if (level === 'routine') return null;
  return (
    <p className={cx('flex items-start gap-2 rounded-xl border px-3 py-2 text-[13px]', level === 'senior' ? 'border-warn/30 bg-warn-soft text-warn-ink' : 'border-crit/40 bg-crit-soft text-crit-ink')}>
      <AlertTriangle size={15} className="mt-0.5 shrink-0" /><span><b>{PEWS_ACTION[level].label}.</b> {PEWS_ACTION[level].action}</span>
    </p>
  );
}

/** Three taps: behaviour (never guessed), cardiovascular and respiratory pre-filled from the numbers. */
export function QuickPews({ admissionId, ageMonths, latest, onSaved }: { admissionId: string; ageMonths: number; latest?: VitalValues | null; onSaved?: () => void }) {
  const thresholds = useApi<PewsThresholds>('pews.thresholds');
  const toast = useToast();
  const sug = useMemo(() => latest ? pewsSuggest(latest, ageMonths) : null, [latest, ageMonths]);
  const [d, setD] = useState<PewsDraft>(() => ({ ...emptyPews(), cardiovascular: sug?.cardiovascular ?? null, respiratory: sug?.respiratory ?? null }));
  const [saved, setSaved] = useState<PewsLevel | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (sug) setD(x => ({ ...x, cardiovascular: x.cardiovascular ?? sug.cardiovascular, respiratory: x.respiratory ?? sug.respiratory })); }, [sug]);
  const total = pewsTotal(d);
  const maxItem = Math.max(d.behaviour ?? 0, d.cardiovascular ?? 0, d.respiratory ?? 0);
  const level = total == null ? null : pewsLevel(total, thresholds.data ?? undefined, maxItem);
  const save = async () => {
    if (total == null) return;
    setBusy(true);
    try { await call('vitals.add', { admissionId, at: nowLocal(), context: 'routine', values: { pews: total } }); toast(`PEWS ${total} saved`); setSaved(level); setD(emptyPews()); onSaved?.(); }
    catch (e: any) { toast(e.message, 'crit'); } finally { setBusy(false); }
  };
  return (
    <div className="card flex flex-col gap-3 p-4">
      <CardHeader title="PEWS" info="Brighton Paediatric Early Warning Score. Heart rate, breathing rate and oxygen pre-fill the minimum score; check colour, CRT and work of breathing yourself." right={total != null && <PewsChip p={{ score: total, at: null, prev: null, trend: null, level, overdue: false, hoursSince: 0 }} compact />} />
      {PEWS_ITEMS.map(item => (
        <div key={item.key} className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink-2">{item.label}</span>
          <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label={item.label}>
            {item.options.map((o, i) => {
              const on = (d as any)[item.key] === i;
              return (
                <button key={i} role="radio" aria-checked={on} title={o} onClick={() => setD({ ...d, [item.key]: i })}
                  className={cx('flex min-h-[52px] flex-col items-center justify-center rounded-xl border px-1 py-1 text-center', on ? (i >= 3 ? 'border-crit bg-crit-soft text-crit-ink' : i === 2 ? 'border-warn bg-warn-soft text-warn-ink' : 'border-accent bg-accent-soft text-accent-ink') : 'border-line text-ink-2')}>
                  <span className="tnum text-[17px] font-semibold leading-none">{i}</span>
                  <span className="mt-0.5 line-clamp-2 text-[9.5px] leading-tight opacity-80">{o.split(/[,;]/)[0]}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        {PEWS_EXTRAS.map(x => (
          <label key={x.key} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[12px]">
            <input type="checkbox" checked={(d as any)[x.key]} onChange={e => setD({ ...d, [x.key]: e.target.checked })} />{x.label} (+2)
          </label>
        ))}
      </div>
      {sug && sug.reasons.length > 0 && <p className="text-[11.5px] text-ink-3">From the latest numbers: {sug.reasons.join('; ')}.</p>}
      {level && level !== 'routine' && <EscalationNote level={level} />}
      <Button variant="primary" className="h-11" disabled={busy || total == null} onClick={save}>{total == null ? 'Score all three' : `Save PEWS ${total}`}</Button>
      {saved && saved !== 'routine' && !level && <EscalationNote level={saved} />}
    </div>
  );
}

// ── Antimicrobial doses ──────────────────────────────────────

export const dueLabel = (due?: DoseDue | null) => {
  if (!due?.nextDue) return null;
  if (due.overdueMin) return `overdue ${due.overdueMin >= 90 ? `${Math.round(due.overdueMin / 60)} h` : `${due.overdueMin} min`}`;
  return `due ${due.nextDue.slice(11, 16)}`;
};
export function DueChip({ due }: { due?: DoseDue | null }) {
  const l = dueLabel(due);
  if (!l) return null;
  return <Chip tone={due!.overdueMin ? 'crit' : (due!.dueInMin ?? 99) <= 60 ? 'warn' : 'neutral'} dot={!!due!.overdueMin}><Clock size={11} />{l}</Chip>;
}

/** One tap: a dose was given now (or at an edited time). */
export function GivenButton({ episodeId, drug, onDone, size = 'sm' }: { episodeId: string; drug: string; onDone?: () => void; size?: 'sm' | 'md' }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const give = async () => {
    const at = nowLocal();
    if (!confirm(`${drug}: record a dose given at ${at.slice(11, 16)}?`)) return;
    setBusy(true);
    try { await call('dose.given', { episodeId, at }); toast(`${drug} given at ${at.slice(11, 16)}`); onDone?.(); } catch (e: any) { toast(e.message, 'crit'); } finally { setBusy(false); }
  };
  return <Button size={size} variant="primary" disabled={busy} onClick={give}><Check size={14} />Given</Button>;
}

// ── Drugs: emergency sheet and infusions ─────────────────────

type DrugTableResp = { table: DrugTable; custom: boolean; reviewed: { by: string; at: string } | null };
const fmtDose = (n: number, unit: string) => `${n} ${unit}`;

export function DrugsCard({ weightKg, ageMonths, running = [] }: { weightKg: number | null; ageMonths: number | null; running?: string[] }) {
  const t = useApi<DrugTableResp>('drugs.table');
  const [tab, setTab] = useState<'emergency' | 'infusions'>('emergency');
  if (!t.data) return null;
  const sheet = emergencySheet(weightKg, ageMonths, t.data.table);
  return (
    <div className="card flex flex-col gap-3 p-4 print:break-inside-avoid">
      <CardHeader title={<span className="flex items-center gap-2"><Syringe size={15} className="text-accent-ink" />Drugs</span>}
        right={!isPhone() && <Button size="sm" variant="ghost" onClick={() => call('desktop.print')}><Printer size={14} />Print</Button>} />
      {!t.data.reviewed && <p className="rounded-xl border border-warn/30 bg-warn-soft px-3 py-2 text-[12px] text-warn-ink">Defaults from APLS / PALS — <b>not yet reviewed by your unit</b>. Check every dose against your protocol; an administrator can review the table in Settings.</p>}
      {!sheet ? <p className="text-[13px] text-ink-3">Record a weight (or age) to calculate doses.</p> : (<>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={sheet.estimated ? 'warn' : 'accent'}>{sheet.estimated ? `Estimated ${sheet.weightKg} kg — record a real weight` : `${sheet.weightKg} kg`}</Chip>
          <div className="ml-auto flex rounded-xl bg-panel-2 p-0.5 text-[12.5px]" role="tablist">
            {(['emergency', 'infusions'] as const).map(x => <button key={x} role="tab" aria-selected={tab === x} onClick={() => setTab(x)} className={cx('rounded-lg px-3 py-1.5', tab === x ? 'bg-panel font-semibold shadow-sm' : 'text-ink-3')}>{x === 'emergency' ? 'Emergency' : 'Infusions'}</button>)}
          </div>
        </div>
        {tab === 'emergency' ? (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-3 gap-1.5 text-center">
              <div className="rounded-xl bg-crit-soft px-2 py-2 text-crit-ink"><div className="text-[10.5px] opacity-80">Defibrillation</div><div className="tnum text-[18px] font-semibold"><Zap size={13} className="inline" />{sheet.defibJ} J</div></div>
              <div className="rounded-xl bg-panel-2 px-2 py-2"><div className="text-[10.5px] text-ink-3">Cardioversion</div><div className="tnum text-[16px] font-semibold">{sheet.cardioversionJ[0]}→{sheet.cardioversionJ[1]} J</div></div>
              {sheet.ett && <div className="rounded-xl bg-panel-2 px-2 py-2"><div className="text-[10.5px] text-ink-3">ETT (cuffed / uncuffed)</div><div className="tnum text-[16px] font-semibold">{sheet.ett.cuffed} / {sheet.ett.uncuffed}</div><div className="text-[10.5px] text-ink-3">{sheet.ett.lengthCm} cm at lips</div></div>}
            </div>
            <table className="w-full text-[12.5px]">
              <tbody>
                {sheet.lines.map(l => (
                  <tr key={l.id} className="border-t border-line align-top">
                    <td className="py-1.5 pr-2"><div className="font-semibold">{l.name}</div><div className="text-[11px] text-ink-3">{l.indication} · {l.route}</div></td>
                    <td className="tnum py-1.5 text-right whitespace-nowrap"><div className="font-semibold">{fmtDose(l.dose, l.unit)}{l.capped && <span className="ml-1 text-[10.5px] font-normal text-warn-ink">max</span>}</div>
                      {l.volumeMl != null && l.unit !== 'mL' && <div className="text-[11px] text-ink-2">{l.volumeMl} mL of {l.preparation}</div>}
                      {l.unit === 'mL' && l.preparation && <div className="text-[11px] text-ink-3">{l.preparation}</div>}
                      {l.note && <div className="text-[10.5px] text-ink-3">{l.note}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Infusions table={t.data.table} weightKg={sheet.weightKg} running={running} />}
      </>)}
    </div>
  );
}

function Infusions({ table, weightKg, running }: { table: DrugTable; weightKg: number; running: string[] }) {
  const first = table.infusions.find(i => running.includes(i.name)) ?? table.infusions[0];
  const [id, setId] = useState(first.id);
  const inf = table.infusions.find(i => i.id === id) ?? first;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {table.infusions.map(i => (
          <button key={i.id} onClick={() => setId(i.id)} className={cx('h-9 rounded-full border px-3 text-[12.5px]', i.id === inf.id ? 'border-accent bg-accent-soft font-semibold text-accent-ink' : 'border-line text-ink-2')}>
            {i.name}{running.includes(i.name) && <span className="ml-1 text-[10px] text-good-ink">● running</span>}
          </button>
        ))}
      </div>
      <InfusionCalc key={inf.id + weightKg} inf={inf} weightKg={weightKg} />
    </div>
  );
}

function InfusionCalc({ inf, weightKg }: { inf: Infusion; weightKg: number }) {
  const mu = makeUp(inf, weightKg);
  const [mode, setMode] = useState<'std' | 'custom'>('std');
  const [mg, setMg] = useState(String(mu.mg));
  const [vol, setVol] = useState(String(mu.volumeMl));
  const [dose, setDose] = useState(String(inf.start));
  const [rate, setRate] = useState('');
  const conc = mode === 'std' ? mu.mcgPerMl : (Number(mg) * 1000) / (Number(vol) || 1);
  const ok = conc > 0 && Number.isFinite(conc);
  const fromDose = ok && dose !== '' ? infusionRate(Number(dose), inf.unit, weightKg, conc) : null;
  const fromRate = ok && rate !== '' ? doseFromRate(Number(rate), inf.unit, weightKg, conc) : null;
  const outOfRange = (x: number | null) => x != null && (x < inf.range[0] || x > inf.range[1]);
  return (
    <div className="flex flex-col gap-2.5 rounded-xl bg-panel-2 p-3">
      <div className="flex gap-1.5 text-[12px]">
        <button onClick={() => setMode('std')} className={cx('rounded-lg px-2.5 py-1', mode === 'std' ? 'bg-panel font-semibold' : 'text-ink-3')}>Standard syringe</button>
        <button onClick={() => setMode('custom')} className={cx('rounded-lg px-2.5 py-1', mode === 'custom' ? 'bg-panel font-semibold' : 'text-ink-3')}>My syringe</button>
      </div>
      {mode === 'std' ? (
        <p className="text-[12.5px]"><b className="tnum">{mu.mg} mg</b> {inf.name} made up to <b>{mu.volumeMl} mL</b> with {mu.diluent} → <b className="tnum">1 mL/h = {mu.oneMlPerH} {inf.unit}</b></p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11.5px] text-ink-3">Drug (mg)<input className="field tnum h-10" inputMode="decimal" value={mg} onChange={e => setMg(e.target.value)} /></label>
          <label className="text-[11.5px] text-ink-3">Total volume (mL)<input className="field tnum h-10" inputMode="decimal" value={vol} onChange={e => setVol(e.target.value)} /></label>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11.5px] text-ink-3">Dose ({inf.unit})<input className="field tnum h-11 text-[17px]" inputMode="decimal" value={dose} onChange={e => { setDose(e.target.value); setRate(''); }} /></label>
        <label className="text-[11.5px] text-ink-3">Rate (mL/h)<input className="field tnum h-11 text-[17px]" inputMode="decimal" value={rate} onChange={e => { setRate(e.target.value); setDose(''); }} placeholder={fromDose != null ? String(fromDose) : ''} /></label>
      </div>
      <p className="tnum text-[14px]">
        {fromDose != null && <><b>{fromDose} mL/h</b> for {dose} {inf.unit}</>}
        {fromRate != null && <><b>{fromRate} {inf.unit}</b> at {rate} mL/h</>}
      </p>
      {(outOfRange(Number(dose) || null) || outOfRange(fromRate)) && <p className="text-[12px] text-warn-ink">Outside the usual range {inf.range[0]}–{inf.range[1]} {inf.unit}.</p>}
      <p className="text-[11px] text-ink-3">Usual range {inf.range[0]}–{inf.range[1]} {inf.unit}. Rates to 2 decimals — set the pump to what it can deliver.</p>
    </div>
  );
}

// ── Handover ─────────────────────────────────────────────────

export interface HandoverRow { admissionId: string; bed: string | null; s: string[]; b: string[]; a: string[]; r: string[]; todo: string | null; text: string; name: string | null; label: string; pews: PewsStatus }

export function HandoverCard({ h, canWrite }: { h: HandoverRow; canWrite: boolean }) {
  const toast = useToast();
  const [todo, setTodo] = useState('');
  const share = async (text: string) => {
    if (isPhone() && (navigator as any).share) { try { await (navigator as any).share({ text }); return; } catch { /* cancelled */ } }
    try { await navigator.clipboard.writeText(text); toast('Copied — paste it into WhatsApp or SMS'); } catch { toast('Select the text and copy it', 'crit'); }
  };
  const saveTodo = async () => {
    try { await call('event.add', { admissionId: h.admissionId, type: 'note', label: 'Handover', note: todo.trim() }); toast('Added to the handover'); setTodo(''); } catch (e: any) { toast(e.message, 'crit'); }
  };
  const block = (k: string, lines: string[]) => (
    <div className="flex gap-2.5"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-accent-soft text-[12px] font-bold text-accent-ink">{k}</span>
      <ul className="flex min-w-0 flex-col gap-0.5 text-[13px]">{lines.length ? lines.map((l, i) => <li key={i}>{l}</li>) : <li className="text-ink-3">—</li>}</ul></div>
  );
  return (
    <article className="card flex flex-col gap-3 p-4 print:break-inside-avoid">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0"><div className="text-[15px] font-semibold">Bed {h.bed ?? '—'} <span className="font-normal text-ink-3">· {h.name ?? h.label}</span></div></div>
        <div className="flex shrink-0 items-center gap-1.5"><PewsChip p={h.pews} compact /><Button size="sm" variant="ghost" onClick={() => share(h.text)} aria-label="Share">{isPhone() ? <Share2 size={14} /> : <Copy size={14} />}</Button></div>
      </header>
      {block('S', h.s)}{block('B', h.b)}{block('A', h.a)}
      <div className={cx(h.r.length > 0 && 'rounded-xl bg-warn-soft/60 p-2')}>{block('R', h.r.length ? h.r : ['Continue current plan'])}</div>
      {canWrite && (
        <div className="flex gap-2 print:hidden">
          <input className="field h-10 flex-1 text-[14px]" value={todo} onChange={e => setTodo(e.target.value)} placeholder="To do for the next shift…" maxLength={300} aria-label="To do for the next shift" />
          <Button disabled={!todo.trim()} onClick={saveTodo}>Add</Button>
        </div>
      )}
    </article>
  );
}

export function HandoverList({ admissionId, canWrite }: { admissionId?: string; canWrite: boolean }) {
  const { data } = useApi<HandoverRow[]>('handover.list', admissionId ? { admissionId } : {});
  const toast = useToast();
  if (!data) return null;
  const all = data.map(h => h.text).join('\n\n');
  const shareAll = async () => {
    const text = `Handover ${nowLocal().replace('T', ' ')}\n\n${all}`;
    if (isPhone() && (navigator as any).share) { try { await (navigator as any).share({ text }); return; } catch { /* cancelled */ } }
    try { await navigator.clipboard.writeText(text); toast('Copied the whole handover'); } catch { toast('Could not copy', 'crit'); }
  };
  return (
    <div className="flex flex-col gap-3">
      {!admissionId && data.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Button size="sm" onClick={shareAll}>{isPhone() ? <Share2 size={14} /> : <Copy size={14} />}{isPhone() ? 'Share all' : 'Copy all'}</Button>
          {!isPhone() && <Button size="sm" variant="ghost" onClick={() => call('desktop.print')}><Printer size={14} />Print</Button>}
          <span className="text-[11.5px] text-ink-3">Shared text has bed numbers, never names.</span>
        </div>
      )}
      <div className={cx('grid gap-3', !admissionId && 'grid-cols-1 2xl:grid-cols-2')}>{data.map(h => <HandoverCard key={h.admissionId} h={h} canWrite={canWrite} />)}</div>
    </div>
  );
}
