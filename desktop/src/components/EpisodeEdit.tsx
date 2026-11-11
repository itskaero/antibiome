// Correct a therapy episode's times after the fact: an antimicrobial charted late, a stop that was
// missed, a ventilation period that started earlier. The server checks the admission window and
// overlaps and records old → new in the audit log.
import { useState } from 'react';
import { call } from '@/lib/api';
import { Button, ErrorNote, Field, Modal, Toggle, useToast } from '@/components/ui';
import { ABX_INTENTS, RESP_LABEL, type RespLevel } from '@shared/reference';
import { DAY_MS, ms } from '@shared/time';
import type { Episode } from '@shared/types';

export const episodeName = (e: Episode) => (e.kind === 'resp' ? RESP_LABEL[e.detail as RespLevel] ?? e.detail : e.detail);

export function EpisodeEditModal({ episode, onClose }: { episode: Episode; onClose: () => void }) {
  const toast = useToast();
  const [start, setStart] = useState(episode.startAt.slice(0, 16));
  const [running, setRunning] = useState(!episode.endAt);
  const [end, setEnd] = useState((episode.endAt ?? '').slice(0, 16));
  const [intent, setIntent] = useState<string>(episode.intent ?? 'empiric');
  const [every, setEvery] = useState(episode.intervalHours != null ? String(episode.intervalHours) : '');
  const [dose, setDose] = useState(episode.dose ?? '');
  const [err, setErr] = useState<string | null>(null);
  const days = !running && end && start ? Math.max(0, (ms(end) - ms(start)) / DAY_MS) : null;
  const save = async () => {
    setErr(null);
    if (!running && !end) return setErr('Give a stop time, or tick "Still running".');
    try {
      const changed = await call<boolean>('episode.update', { id: episode.id, startAt: start, endAt: running ? null : end, ...(episode.kind === 'abx' ? { intent, intervalHours: every ? Number(every) : null, dose: dose.trim() || null } : {}) });
      toast(changed ? `${episodeName(episode)} times updated` : 'Nothing changed');
      onClose();
    } catch (e: any) { setErr(e.message); }
  };
  return (
    <Modal open onClose={onClose} title={`Edit ${episodeName(episode)}`} subtitle="Correct when this started or stopped. The change and the previous times are kept in the audit log." width={520}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Started"><input id="ep-start" type="datetime-local" className="field tnum" value={start} onChange={e => setStart(e.target.value)} /></Field>
        <Toggle checked={running} onChange={setRunning} label="Still running" />
        {!running && <Field label="Stopped" hint={days != null ? `${days < 1 ? `${Math.round(days * 24)} h` : `${days.toFixed(1)} days`}` : undefined}><input id="ep-end" type="datetime-local" className="field tnum" value={end} onChange={e => setEnd(e.target.value)} /></Field>}
        {episode.kind === 'abx' && (
          <Field label="Intent">
            <select id="ep-intent" className="field" value={intent} onChange={e => setIntent(e.target.value)}>
              {ABX_INTENTS.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </Field>
        )}
        {episode.kind === 'abx' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Every (hours)" hint="Sets when the next dose is due"><input id="ep-every" className="field tnum" inputMode="decimal" value={every} onChange={e => setEvery(e.target.value)} placeholder="e.g. 8" /></Field>
            <Field label="Dose" hint="As prescribed, e.g. 40 mg/kg"><input id="ep-dose" className="field" value={dose} onChange={e => setDose(e.target.value)} maxLength={60} /></Field>
          </div>
        )}
        <ErrorNote text={err} />
      </div>
    </Modal>
  );
}
