import { useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, BedDouble, Clock, DoorOpen, FlaskConical, HeartPulse, LogIn, Pencil, Pill, Plus, Stethoscope, Trash2, TriangleAlert, Wind,
} from 'lucide-react';
import { call } from '@/lib/api';
import { go, useApi } from '@/lib/hooks';
import { cx, losLabel } from '@/lib/format';
import { Button, CardHeader, ChoiceChips, Chip, Empty, ErrorNote, Field, Modal, RespChip, RespSegment, useToast } from '@/components/ui';
import { DxPicker } from '@/components/DxPicker';
import { CultureForm } from '@/components/CultureForm';
import {
  ABX_INTENTS, COMPLICATIONS, DISPOSITIONS, PRESCRIBABLE_ANTIMICROBIALS, PROCEDURES, RESP_LABEL, VASOACTIVES, awareGroup, dxLabel, type RespLevel,
} from '@shared/reference';
import { DAY_MS, fmtAge, fmtDateTime, ms, nowLocal, parse } from '@shared/time';
import type { Admission, ClinicalEvent, Episode } from '@shared/types';

interface Detail {
  admission: Admission; label: string; identifiers: { mrn: string; name: string | null; dob: string | null } | null;
  episodes: Episode[]; events: ClinicalEvent[]; cultures: any[]; losDays: number; peakSupport: RespLevel;
  issues: { id: string; message: string; severity: string }[]; previousAdmissions: { admit_at: string; discharge_at: string | null }[];
}

export function PatientPage({ id, canEdit, isAdmin }: { id: string; canEdit: boolean; isAdmin: boolean }) {
  const { data: d, error } = useApi<Detail>('admission.get', { id });
  const [discharge, setDischarge] = useState(false);
  const [edit, setEdit] = useState(false);
  const [culture, setCulture] = useState<{ open: boolean; existing?: any }>({ open: false });
  const toast = useToast();
  if (error) return <ErrorNote text={error} />;
  if (!d) return null;
  const a = d.admission;
  const active = !a.dischargeAt;
  const editable = canEdit && active;
  const open = d.episodes.filter(e => !e.endAt);
  const resp = (open.find(e => e.kind === 'resp')?.detail ?? 'RA') as RespLevel;

  const act = async (method: string, params: any, msg: string) => {
    try { await call(method, params); toast(msg); } catch (e: any) { toast(e.message, 'crit'); }
  };

  return (
    <div className="flex flex-col gap-5">
      <button onClick={() => go('census')} className="no-print flex w-fit items-center gap-1.5 text-[12.5px] text-ink-3 hover:text-ink"><ArrowLeft size={14} />Census board</button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <span className={cx('tnum grid h-14 w-14 place-items-center rounded-2xl text-[18px] font-semibold', resp === 'MV' ? 'bg-crit-soft text-crit-ink' : 'bg-accent-soft text-accent-ink')}>{a.bed ?? <BedDouble size={20} />}</span>
          <div>
            <h1 className="text-[24px] font-semibold tracking-tight">{dxLabel(a.primaryDx)}</h1>
            <p className="mt-0.5 text-[13.5px] text-ink-3">
              {d.identifiers ? <><span className="text-ink-2">{d.identifiers.name ?? 'Unnamed'}</span> · {d.identifiers.mrn} · </> : null}
              {d.label} · {fmtAge(a.ageMonths)} · {a.sex === 'M' ? 'Male' : 'Female'}{a.weightKg ? ` · ${a.weightKg} kg` : ''}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Chip tone={active ? 'accent' : a.disposition === 'Died' ? 'crit' : 'good'} dot>{active ? 'In PICU' : `Discharged → ${a.disposition}`}</Chip>
              <Chip><Clock size={12} />{losLabel(d.losDays)} stay</Chip>
              <Chip><LogIn size={12} />{a.source} · {a.admissionType}</Chip>
              {a.secondaryDx.map(c => <Chip key={c}>{dxLabel(c)}</Chip>)}
              {a.shockOnArrival && <Chip tone="crit">Shock on arrival</Chip>}
              {a.comaOnArrival && <Chip tone="warn">Coma on arrival</Chip>}
              {a.malnutrition && <Chip tone="warn">Severe malnutrition</Chip>}
              {a.chronicCondition && <Chip>Chronic condition</Chip>}
              {d.previousAdmissions.length > 0 && <Chip tone="info">{d.previousAdmissions.length} previous admission{d.previousAdmissions.length > 1 ? 's' : ''}</Chip>}
            </div>
          </div>
        </div>
        <div className="no-print flex gap-2">
          {editable && <Button onClick={() => setEdit(true)}><Pencil size={14} />Edit</Button>}
          {editable && <Button variant="primary" onClick={() => setDischarge(true)}><DoorOpen size={15} />Discharge</Button>}
          {!active && isAdmin && <Button onClick={() => act('admission.reopen', { id }, 'Admission re-opened')}>Re-open</Button>}
        </div>
      </div>

      {d.issues.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-2xl border border-warn/30 bg-warn-soft px-4 py-3 text-[12.5px] text-warn-ink">
          <span className="flex items-center gap-2 font-semibold"><TriangleAlert size={14} />Data-quality warnings</span>
          {d.issues.map(i => <span key={i.id}>• {i.message}</span>)}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1.35fr]">
        <div className="flex flex-col gap-3">
          <div className="card p-5">
            <CardHeader title="Current support & therapy" info="Changes are time-stamped now; correct times on the timeline if entered late." />
            <div className="flex flex-col gap-4">
              <Field label="Respiratory support">
                {editable ? <RespSegment value={resp} onChange={l => act('resp.set', { admissionId: id, level: l }, `${RESP_LABEL[resp]} → ${RESP_LABEL[l]}`)} /> : <RespChip level={resp} />}
              </Field>
              <Field label="Vasoactives">
                {editable
                  ? <ChoiceChips multi size="sm" options={VASOACTIVES} value={open.filter(e => e.kind === 'vaso').map(e => e.detail)}
                      onChange={(next: string[]) => {
                        const cur = open.filter(e => e.kind === 'vaso').map(e => e.detail);
                        const added = next.find(x => !cur.includes(x)), removed = cur.find(x => !next.includes(x));
                        if (added) act('drug.toggle', { admissionId: id, kind: 'vaso', drug: added, on: true }, `Started ${added}`);
                        if (removed) act('drug.toggle', { admissionId: id, kind: 'vaso', drug: removed, on: false }, `Stopped ${removed}`);
                      }} />
                  : <span className="text-[13px] text-ink-2">{open.filter(e => e.kind === 'vaso').map(e => e.detail).join(', ') || 'None'}</span>}
              </Field>
              <Antimicrobials episodes={d.episodes.filter(e => e.kind === 'abx')} editable={editable} onStart={(drug, intent) => act('drug.toggle', { admissionId: id, kind: 'abx', drug, on: true, intent }, `Started ${drug}`)}
                onStop={drug => act('drug.toggle', { admissionId: id, kind: 'abx', drug, on: false }, `Stopped ${drug}`)} />
            </div>
          </div>

          {editable && (
            <div className="card p-5">
              <CardHeader title="Record an event" />
              <div className="flex flex-col gap-3">
                <Field label="Procedure"><ChoiceChips size="sm" options={PROCEDURES} value={null} onChange={v => act('event.add', { admissionId: id, type: 'procedure', label: v }, `${v} recorded`)} /></Field>
                <Field label="Complication / QI event"><ChoiceChips size="sm" options={COMPLICATIONS} value={null} onChange={v => act('event.add', { admissionId: id, type: 'complication', label: v }, `${v} recorded`)} /></Field>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" onClick={() => act('event.add', { admissionId: id, type: 'culture_sent', label: 'Blood culture sent' }, 'Culture sent recorded')}><FlaskConical size={14} />Culture sent</Button>
                  <Button size="sm" onClick={() => setCulture({ open: true })}><Plus size={14} />Culture result</Button>
                  <Button size="sm" onClick={() => act('event.add', { admissionId: id, type: 'deterioration', label: 'Clinical deterioration' }, 'Deterioration recorded')}><AlertTriangle size={14} />Deterioration</Button>
                </div>
              </div>
            </div>
          )}

          <div className="card p-5">
            <CardHeader title="Cultures" right={canEdit && <Button size="sm" variant="ghost" onClick={() => setCulture({ open: true })}><Plus size={14} />Add</Button>} />
            {d.cultures.length ? (
              <div className="flex flex-col divide-y divide-line">
                {d.cultures.map(c => (
                  <button key={c.id} onClick={() => canEdit && setCulture({ open: true, existing: c })} className="flex items-center justify-between gap-3 py-2.5 text-left">
                    <span>
                      <span className="block text-[13px] font-medium"><i>{c.organism ?? 'No growth'}</i></span>
                      <span className="block text-[11.5px] text-ink-3">{c.specimen} · {c.collectedAt.slice(0, 10)} · {c.antibiotics.length} AST results</span>
                    </span>
                    {c.mdr ? <Chip tone="crit">MDR</Chip> : c.organism ? <Chip tone="good">Not MDR</Chip> : <Chip>Negative</Chip>}
                  </button>
                ))}
              </div>
            ) : <p className="text-[12.5px] text-ink-3">No cultures linked to this admission.</p>}
          </div>
        </div>

        <Timeline d={d} canEdit={canEdit} onDelete={(kind, eid) => act(kind === 'event' ? 'event.delete' : 'episode.delete', { id: eid }, 'Entry removed')} />
      </div>

      <DischargeModal open={discharge} onClose={() => setDischarge(false)} d={d} />
      <EditModal open={edit} onClose={() => setEdit(false)} a={a} />
      <CultureForm open={culture.open} onClose={() => setCulture({ open: false })} admissionId={id} existing={culture.existing} />
    </div>
  );
}

function Antimicrobials({ episodes, editable, onStart, onStop }: { episodes: Episode[]; editable: boolean; onStart: (d: string, intent: string) => void; onStop: (d: string) => void }) {
  const [drug, setDrug] = useState('');
  const [intent, setIntent] = useState<string>('empiric');
  const open = episodes.filter(e => !e.endAt);
  const days = (e: Episode) => Math.floor((Date.now() - ms(e.startAt)) / DAY_MS) + 1;
  return (
    <Field label="Antimicrobials">
      <div className="flex flex-col gap-1.5">
        {open.map(e => (
          <div key={e.id} className="flex items-center justify-between rounded-xl bg-panel-2 px-3 py-2">
            <span className="flex items-center gap-2 text-[13px]"><Pill size={14} className="text-ink-3" />{e.detail}
              <span className="text-[11.5px] text-ink-3">day {days(e)} · {e.intent ?? 'empiric'} · {awareGroup(e.detail)}</span></span>
            {editable && <Button size="sm" variant="ghost" onClick={() => onStop(e.detail)}>Stop</Button>}
          </div>
        ))}
        {!open.length && <span className="text-[12.5px] text-ink-3">None running.</span>}
        {editable && (
          <div className="mt-1 flex items-center gap-2">
            <select className="field h-8 flex-1 text-[12.5px]" value={drug} onChange={e => setDrug(e.target.value)}>
              <option value="">Start an antimicrobial…</option>
              {PRESCRIBABLE_ANTIMICROBIALS.filter(x => !open.some(e => e.detail === x)).map(x => <option key={x}>{x}</option>)}
            </select>
            <select className="field h-8 w-32 text-[12.5px]" value={intent} onChange={e => setIntent(e.target.value)}>
              {ABX_INTENTS.map(i => <option key={i}>{i}</option>)}
            </select>
            <Button size="sm" disabled={!drug} onClick={() => { onStart(drug, intent); setDrug(''); }}>Start</Button>
          </div>
        )}
      </div>
    </Field>
  );
}

// ── Timeline (grouped by day, after the "Activity" reference) ─────────

interface TItem { at: string; icon: React.ReactNode; tone: string; text: React.ReactNode; del?: ['event' | 'episode', string] }
function Timeline({ d, canEdit, onDelete }: { d: Detail; canEdit: boolean; onDelete: (kind: 'event' | 'episode', id: string) => void }) {
  const items = useMemo(() => {
    const a = d.admission, out: TItem[] = [];
    out.push({ at: a.admitAt, icon: <LogIn size={13} />, tone: 'text-accent-ink', text: <><b>Admitted</b> from {a.source} with {dxLabel(a.primaryDx)}</> });
    d.episodes.forEach(e => {
      const cfg = e.kind === 'resp' ? { icon: <Wind size={13} />, tone: e.detail === 'MV' ? 'text-crit-ink' : 'text-info-ink', name: RESP_LABEL[e.detail as RespLevel] }
        : e.kind === 'vaso' ? { icon: <HeartPulse size={13} />, tone: 'text-accent-ink', name: e.detail }
        : { icon: <Pill size={13} />, tone: 'text-ink-2', name: e.detail };
      out.push({ at: e.startAt, icon: cfg.icon, tone: cfg.tone, del: ['episode', e.id],
        text: <><b>{e.kind === 'resp' ? `${cfg.name} started` : `Started ${cfg.name}`}</b>{e.kind === 'abx' && <span className="text-ink-3"> · {e.intent}</span>}</> });
      if (e.endAt) out.push({ at: e.endAt, icon: cfg.icon, tone: 'text-ink-3', text: <>{e.kind === 'resp' ? `${cfg.name} ended` : `Stopped ${cfg.name}`}<span className="text-ink-3"> · {fmtDur(ms(e.endAt) - ms(e.startAt))}{e.endReason ? ` · ${e.endReason}` : ''}</span></> });
    });
    d.events.forEach(e => out.push({ at: e.at, del: ['event', e.id], icon: e.type === 'complication' || e.type === 'deterioration' ? <AlertTriangle size={13} /> : e.type === 'culture_sent' ? <FlaskConical size={13} /> : <Stethoscope size={13} />,
      tone: e.type === 'complication' || e.type === 'deterioration' ? 'text-warn-ink' : 'text-ink-2', text: <><b>{e.label}</b>{e.note && <span className="text-ink-3"> · {e.note}</span>}</> }));
    d.cultures.forEach(c => out.push({ at: c.collectedAt.length === 10 ? `${c.collectedAt}T00:00` : c.collectedAt, icon: <FlaskConical size={13} />, tone: c.mdr ? 'text-crit-ink' : 'text-ink-2',
      text: <><b>{c.specimen} culture</b>: <i>{c.organism ?? 'no growth'}</i>{c.mdr && <span className="text-crit-ink"> · MDR</span>}</> }));
    if (a.dischargeAt) out.push({ at: a.dischargeAt, icon: <DoorOpen size={13} />, tone: a.disposition === 'Died' ? 'text-crit-ink' : 'text-good-ink', text: <><b>{a.disposition === 'Died' ? 'Died' : `Discharged to ${a.disposition}`}</b></> });
    return out.sort((x, y) => y.at.localeCompare(x.at));
  }, [d]);

  const groups = useMemo(() => {
    const g: { day: string; items: TItem[] }[] = [];
    items.forEach(i => { const day = i.at.slice(0, 10); if (g[g.length - 1]?.day !== day) g.push({ day, items: [] }); g[g.length - 1].items.push(i); });
    return g;
  }, [items]);

  return (
    <div className="card p-5">
      <CardHeader title="Timeline" info="Admission, support, therapy, events and cultures — newest first." right={<span className="text-[12px] text-ink-3">{items.length} entries</span>} />
      {!items.length && <Empty title="Nothing recorded" />}
      <div className="flex flex-col gap-3">
        {groups.map(g => {
          const day = Math.floor((ms(g.day) - ms(d.admission.admitAt.slice(0, 10))) / DAY_MS) + 1;
          return (
            <div key={g.day} className="rounded-2xl border border-line bg-panel-2/40">
              <div className="flex items-center justify-between px-4 py-2 text-[12px] text-ink-3">
                <span className="font-medium text-ink-2">{parse(g.day).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</span>
                <span>PICU day {day}</span>
              </div>
              <div className="mx-1.5 mb-1.5 flex flex-col rounded-xl bg-panel">
                {g.items.map((i, k) => (
                  <div key={k} className="group flex items-center gap-3 border-b border-line px-3 py-2.5 text-[13px] last:border-0">
                    <span className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-panel-2', i.tone)}>{i.icon}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-2">{i.text}</span>
                    <span className="tnum shrink-0 text-[11.5px] text-ink-3">{i.at.slice(11, 16)}</span>
                    {canEdit && i.del && (
                      <button onClick={() => confirm('Remove this entry? It is kept in the audit log.') && onDelete(i.del![0], i.del![1])}
                        className="shrink-0 text-ink-3 opacity-0 transition group-hover:opacity-100 hover:text-crit-ink" aria-label="Remove"><Trash2 size={13} /></button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
const fmtDur = (msv: number) => { const h = msv / 3_600_000; return h < 48 ? `${Math.round(h)} h` : `${(h / 24).toFixed(1)} d`; };

function DischargeModal({ open, onClose, d }: { open: boolean; onClose: () => void; d: Detail }) {
  const [disposition, setDisposition] = useState<string | null>(null);
  const [at, setAt] = useState(nowLocal());
  const [dx, setDx] = useState<string | null>(d.admission.primaryDx);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const openEps = d.episodes.filter(e => !e.endAt);
  const save = async () => {
    setErr(null);
    try { await call('admission.discharge', { id: d.admission.id, at, disposition, finalPrimaryDx: dx }); toast('Discharge recorded'); onClose(); }
    catch (e: any) { setErr(e.message); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Discharge" subtitle="About 20 seconds: outcome, time, and confirm the final diagnosis."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!disposition} onClick={save}>Record discharge</Button></>}>
      <div className="flex flex-col gap-5">
        <Field label="Outcome" required><ChoiceChips options={DISPOSITIONS} value={disposition} onChange={setDisposition} labels={{ Ward: 'To ward', Home: 'Home', Transfer: 'Transferred', LAMA: 'LAMA', Died: 'Died' }} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={disposition === 'Died' ? 'Time of death' : 'Discharge time'}><input type="datetime-local" className="field" value={at} onChange={e => setAt(e.target.value)} /></Field>
          <Field label="Final primary diagnosis"><DxPicker value={dx} onChange={setDx} /></Field>
        </div>
        {!!openEps.length && (
          <div className="inset p-3 text-[12.5px] text-ink-2">
            These will be closed at {fmtDateTime(at)}: {openEps.map(e => (e.kind === 'resp' ? RESP_LABEL[e.detail as RespLevel] : e.detail)).join(', ')}.
          </div>
        )}
        <ErrorNote text={err} />
      </div>
    </Modal>
  );
}

function EditModal({ open, onClose, a }: { open: boolean; onClose: () => void; a: Admission }) {
  const [f, setF] = useState({ bed: a.bed ?? '', weightKg: a.weightKg ? String(a.weightKg) : '', admitAt: a.admitAt, primaryDx: a.primaryDx as string | null, notes: a.notes ?? '' });
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const save = async () => {
    try { await call('admission.update', { id: a.id, ...f }); toast('Admission updated'); onClose(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Edit admission" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Bed"><input className="field" value={f.bed} onChange={e => setF({ ...f, bed: e.target.value })} /></Field>
        <Field label="Weight kg"><input className="field tnum" type="number" step="0.1" value={f.weightKg} onChange={e => setF({ ...f, weightKg: e.target.value })} /></Field>
        <Field label="Admitted at"><input className="field" type="datetime-local" value={f.admitAt} onChange={e => setF({ ...f, admitAt: e.target.value })} /></Field>
        <Field label="Primary diagnosis" className="col-span-3"><DxPicker value={f.primaryDx} onChange={c => setF({ ...f, primaryDx: c })} /></Field>
        <Field label="Notes" className="col-span-3" hint="Avoid identifiable details — notes are excluded from analytics and exports."><textarea className="field" rows={3} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <div className="mt-3"><ErrorNote text={err} /></div>
    </Modal>
  );
}
