import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Activity, ArrowLeft, BellRing, CheckCircle2, CircleAlert, ClipboardPlus, FolderOpen, HeartPulse, LayoutGrid, Link2, Maximize2, Minimize2,
  PlayCircle, Plus, Radio, Settings2, ShieldAlert, StopCircle, Thermometer, Trash2, Wifi, WifiOff, X,
} from 'lucide-react';
import { call, isPhone } from '@/lib/api';
import { go, useApi } from '@/lib/hooks';
import { cx } from '@/lib/format';
import { ageFrom, setMonitorFocus, useMonitorBeds, type BedEvent, type BedSnapshot, type MonitorStatus, type Param, type PortPlan, type ReceiverConfig, type TrendPoint } from '@/lib/monitor';
import { BodyMap, RangeBars, SENSOR_SPOTS, TickGauge, VitalTile, Waveform, WAVE_COLOR } from '@/components/monitor';
import { Button, Chip, Empty, Field, Modal, PageHeader, RespChip, Toggle, useToast } from '@/components/ui';
import { ContinuousTabs } from '@/vendor/watermelon/continuous-tabs';
import { fmtAge, nowLocal } from '@shared/time';
import { dxLabel } from '@shared/reference';
import { censusBedFor } from '@shared/monitor/beds';
import { pewsSuggest } from '@shared/pews';
import { PewsChip } from '@/components/Bedside';
import type { CensusRow } from './types';

type DriverInfo = { id: string; label: string; description: string; defaultPorts: PortPlan; bedInData: boolean };
type Status = MonitorStatus & { enabled: boolean; recordDir: string; drivers: DriverInfo[]; config: ReceiverConfig[]; bedMap: Record<string, string>; captureMinutes: number };
type NV = NonNullable<BedSnapshot['values'][Param]>;

const val = (v?: NV | null) => (v?.value ?? null);
const outside = (v?: NV | null) => v?.value != null && v.alarmOn && ((v.high != null && v.value > v.high) || (v.low != null && v.value < v.low));
const show = (v: number | null, digits = 0) => (v == null ? '--' : digits ? v.toFixed(digits) : String(Math.round(v)));
const bedTitle = (b: BedSnapshot) => (b.source === 'demo' ? `Demo ${b.bed}` : `Bed ${b.bed}`);
const href = (b: BedSnapshot) => `monitor/${encodeURIComponent(b.id)}`;
const sinceLabel = (t: number | null) => {
  if (!t) return '—';
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
};
const durLabel = (ms: number) => { const s = Math.round(ms / 1000); return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${s % 60 ? `${s % 60} s` : ''}`.trim() : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`; };
/** The live heart / breathing rate alone would score more than the last charted PEWS: prompt a rescore. */
const rescore = (b: BedSnapshot, adm: CensusRow | null) => {
  if (!adm || b.stale) return false;
  const s = pewsSuggest({ hr: val(b.values.pr) ?? val(b.values.hr) ?? undefined, rr: val(b.values.rr) ?? undefined }, adm.admission.ageMonths);
  const sum = s.cardiovascular + s.respiratory;
  return sum > 0 && (adm.pews?.score == null || sum > adm.pews.score);
};
const anyAlarm = (b: BedSnapshot) => (['spo2', 'pr', 'hr', 't1'] as Param[]).some(p => outside(b.values[p]));

function useMonitorContext() {
  const status = useApi<Status>('desktop.monitorStatus');
  const census = useApi<{ rows: CensusRow[] }>('census.list');
  useEffect(() => { const t = setInterval(status.reload, 5000); return () => clearInterval(t); }, [status.reload]);
  const byBed = useMemo(() => new Map((census.data?.rows ?? []).filter(r => r.admission.bed).map(r => [String(r.admission.bed), r])), [census.data]);
  const admFor = (b: BedSnapshot) => { const cb = censusBedFor(status.data?.bedMap ?? {}, b.id, b.bed, b.source === 'demo'); return cb ? byBed.get(cb) ?? null : null; };
  return { status, census, admFor };
}

export function LiveMonitor({ args, isAdmin, canChart }: { args: string[]; isAdmin: boolean; canChart: boolean }) {
  const { beds } = useMonitorBeds();
  const ctx = useMonitorContext();
  const status = ctx.status;
  if (args[0] === 'wall') return <WallView beds={beds} admFor={ctx.admFor} />;
  if (args[0]) {
    const id = decodeURIComponent(args[0]);
    const focus = beds.find(b => b.id === id);
    if (!focus) return <Empty icon={<WifiOff size={18} />} title="No data from this monitor yet"><Button size="sm" onClick={() => go('monitor')}><ArrowLeft size={14} />All monitors</Button></Empty>;
    return <BedFocus b={focus} adm={ctx.admFor(focus)} census={ctx.census.data?.rows ?? []} mapped={status.data?.bedMap[focus.id] ?? null} canChart={canChart} />;
  }

  const live = beds.filter(b => !b.stale).length;
  const failing = (status.data?.receivers ?? []).filter(r => r.enabled && r.failed.length);
  if (isPhone()) return <PhoneOverview beds={beds} admFor={ctx.admFor} status={status.data ?? undefined} />;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon={<HeartPulse className="text-accent-ink" size={22} />} title="Live monitor"
        subtitle="Vital signs streamed from the bedside monitors on the unit network. A secondary display — alarms stay on the monitors."
        chips={<>
          <Chip tone={status.data?.running ? 'good' : 'neutral'} dot>{status.data?.running ? `Receiving · ${status.data.receivers.reduce((n, r) => n + r.listening.length, 0)} ports` : 'Receiving off'}</Chip>
          {status.data?.demo && <Chip tone="info" dot>Demo beds</Chip>}
          <Chip tone="accent">{live} live / {beds.length} monitors</Chip>
          {beds.some(anyAlarm) && <Chip tone="crit" dot>{beds.filter(anyAlarm).length} outside limits</Chip>}
          {status.data?.recording && <Chip tone="crit" dot>Recording raw data</Chip>}
        </>}
        actions={status.data && <>
          {beds.length > 0 && <Button size="sm" variant="ghost" onClick={() => go('monitor/wall')}><LayoutGrid size={15} />Wall view</Button>}
          <ReceiverControls s={status.data} isAdmin={isAdmin} reload={status.reload} />
        </>} />

      <SafetyNote />
      {status.data && !beds.length && <Setup s={status.data} />}
      {status.data?.conflicts?.map(c => (
        <p key={`${c.receiverId}:${c.bed}`} className="flex items-center gap-2 rounded-xl border border-crit/30 bg-crit-soft px-3 py-2 text-[12.5px] text-crit-ink">
          <CircleAlert size={14} />Two monitors use bed {c.bed} ({c.remotes.join(' and ')}) — they push each other off. Change the bed number on one of them.
        </p>
      ))}
      {status.data && <NetworkCheck s={status.data} live={live} />}
      {failing.map(r => (
        <p key={r.id} className="flex items-center gap-2 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2 text-[12.5px] text-warn-ink">
          <CircleAlert size={14} />{r.name}: {r.failed.length} port{r.failed.length > 1 ? 's' : ''} could not be opened ({r.failed.slice(0, 3).map(f => f.port).join(', ')}{r.failed.length > 3 ? '…' : ''}) — {r.failed[0].error}
        </p>
      ))}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {beds.map((b, i) => <BedCard key={b.id} b={b} i={i} adm={ctx.admFor(b)} multiReceiver={(status.data?.config.length ?? 0) > 1} />)}
      </div>
    </div>
  );
}

function SafetyNote() {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-line bg-panel-2 px-3.5 py-2.5 text-[12.5px] text-ink-2">
      <ShieldAlert size={15} className="mt-0.5 shrink-0 text-warn-ink" />
      <span>For viewing trends away from the bedside — not an alarm system. Values marked <b>unverified</b> come from a protocol field that has not yet been confirmed against the monitor's screen.</span>
    </p>
  );
}

// ── Receiver controls, settings & first-run checklist ────────

function ReceiverControls({ s, isAdmin, reload }: { s: Status; isAdmin: boolean; reload: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const run = async (method: string, params: unknown, msg?: string) => {
    try { await call(method, params); if (msg) toast(msg); } catch (e: any) { toast(e.message, 'crit'); }
    reload();
  };
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => run('desktop.monitorDemo', { on: !s.demo })}><PlayCircle size={15} />{s.demo ? 'Hide demo' : 'Demo'}</Button>
      {isAdmin && <Button size="sm" variant="ghost" onClick={() => setOpen(true)}><Settings2 size={15} />Receivers</Button>}
      {isAdmin && (s.enabled
        ? <Button size="sm" variant="danger" onClick={() => run('desktop.monitorConfigure', { enabled: false }, 'Receiving stopped')}><StopCircle size={15} />Stop</Button>
        : <Button size="sm" variant="primary" onClick={() => run('desktop.monitorConfigure', { enabled: true }, 'Receiving started')}><Radio size={15} />Start receiving</Button>)}
      {open && <ReceiversModal s={s} onClose={() => { setOpen(false); reload(); }} />}
    </>
  );
}

const portsText = (p: PortPlan) => p.mode === 'list' ? Object.entries(p.map).map(([port, bed]) => `${port}=${bed}`).join(', ') : '';
const parsePorts = (text: string): Record<string, number> => Object.fromEntries(text.split(/[,\n]+/).map(x => x.trim()).filter(Boolean).map(x => { const [p, b] = x.split(/[=:→\s]+/); return [String(Number(p)), Number(b)]; }));
const newId = (list: ReceiverConfig[]) => { let i = list.length + 1; while (list.some(r => r.id === `r${i}`)) i++; return `r${i}`; };

function ReceiversModal({ s, onClose }: { s: Status; onClose: () => void }) {
  const toast = useToast();
  const [list, setList] = useState<ReceiverConfig[]>(() => s.config.map(r => ({ ...r, ports: { ...r.ports } as PortPlan })));
  const [listText, setListText] = useState<Record<string, string>>(() => Object.fromEntries(s.config.map(r => [r.id, portsText(r.ports)])));
  const set = (i: number, patch: Partial<ReceiverConfig>) => setList(l => l.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const driverOf = (id: string) => s.drivers.find(d => d.id === id);
  const add = () => {
    const d = s.drivers[0];
    const id = newId(list);
    setList(l => [...l, { id, name: `Receiver ${l.length + 1}`, driver: d.id, enabled: true, host: '0.0.0.0', ports: d.defaultPorts, timeSync: false }]);
  };
  const save = async () => {
    const receivers = list.map(r => (r.ports.mode === 'list' ? { ...r, ports: { mode: 'list' as const, map: parsePorts(listText[r.id] ?? '') } } : r));
    try { await call('desktop.monitorSaveReceivers', { receivers }); toast('Receivers saved'); onClose(); }
    catch (e: any) { toast(e.message, 'crit'); }
  };
  const statusOf = (id: string) => s.receivers.find(r => r.id === id);
  return (
    <Modal open onClose={onClose} title="Monitor receivers" subtitle="Where the bedside monitors send their data, and which protocol they speak. Nothing is fixed in code." width={720}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="flex flex-col gap-4">
        {list.map((r, i) => {
          const d = driverOf(r.driver), st = statusOf(r.id);
          return (
            <div key={r.id} className="inset flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Toggle checked={r.enabled} onChange={v => set(i, { enabled: v })} label={r.enabled ? 'On' : 'Off'} />
                  {st && r.enabled && <Chip tone={st.failed.length ? 'warn' : st.listening.length ? 'good' : 'neutral'} dot>{st.listening.length} listening{st.failed.length ? ` · ${st.failed.length} failed` : ''} · {st.connections} connected</Chip>}
                </div>
                <Button size="sm" variant="ghost" onClick={() => setList(l => l.filter((_, j) => j !== i))}><Trash2 size={14} />Remove</Button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Name"><input id={`rc-name-${r.id}`} className="field" value={r.name} onChange={e => set(i, { name: e.target.value })} /></Field>
                <Field label="Monitor protocol" hint={d?.description}>
                  <select id={`rc-driver-${r.id}`} className="field" value={r.driver} onChange={e => { const nd = driverOf(e.target.value)!; set(i, { driver: nd.id, ports: nd.defaultPorts }); setListText(t => ({ ...t, [r.id]: portsText(nd.defaultPorts) })); }}>
                    {s.drivers.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </select>
                </Field>
                <Field label="Ports">
                  <select id={`rc-mode-${r.id}`} className="field" value={r.ports.mode} onChange={e => {
                    const mode = e.target.value as PortPlan['mode'];
                    set(i, { ports: mode === 'base+bed' ? { mode, base: 510, maxBed: 64 } : mode === 'single' ? { mode, port: 2575 } : { mode, map: {} } });
                  }}>
                    <option value="base+bed">One port per bed (base + bed number)</option>
                    <option value="list">A list of ports, each for one bed</option>
                    <option value="single" disabled={!d?.bedInData}>One port; the data names the bed</option>
                  </select>
                </Field>
                {r.ports.mode === 'base+bed' && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Base port" hint={`Bed 4 → ${r.ports.base + 4}`}><input id={`rc-base-${r.id}`} className="field tnum" inputMode="numeric" value={r.ports.base} onChange={e => set(i, { ports: { ...(r.ports as any), base: Number(e.target.value) || 0 } })} /></Field>
                    <Field label="Highest bed"><input id={`rc-max-${r.id}`} className="field tnum" inputMode="numeric" value={r.ports.maxBed} onChange={e => set(i, { ports: { ...(r.ports as any), maxBed: Number(e.target.value) || 0 } })} /></Field>
                  </div>
                )}
                {r.ports.mode === 'single' && <Field label="Port"><input id={`rc-port-${r.id}`} className="field tnum" inputMode="numeric" value={r.ports.port} onChange={e => set(i, { ports: { mode: 'single', port: Number(e.target.value) || 0 } })} /></Field>}
                {r.ports.mode === 'list' && <Field label="Port = bed" hint="For example: 514=4, 523=13"><input id={`rc-list-${r.id}`} className="field tnum" value={listText[r.id] ?? ''} onChange={e => setListText(t => ({ ...t, [r.id]: e.target.value }))} /></Field>}
                <Field label="Listen on" hint="0.0.0.0 = every network adapter"><input id={`rc-host-${r.id}`} className="field tnum" value={r.host} onChange={e => set(i, { host: e.target.value })} /></Field>
                <Field label="Address the monitors send to" hint="Optional — shown as a setup check"><input id={`rc-exp-${r.id}`} className="field tnum" value={r.expectedAddress ?? ''} placeholder="e.g. 192.168.10.251" onChange={e => set(i, { expectedAddress: e.target.value })} /></Field>
              </div>
              {r.driver === 'ddt' && <Toggle checked={r.timeSync} onChange={v => set(i, { timeSync: v })} label="Set the monitors' clocks when they connect" />}
            </div>
          );
        })}
        <Button variant="subtle" onClick={add}><Plus size={15} />Add receiver</Button>
        <Connections s={s} />
        <div className="inset flex flex-wrap items-center justify-between gap-3 p-3.5 text-[12.5px]">
          <span><span className="block font-medium">Propose readings for the chart</span><span className="text-ink-3">For beds linked to a census patient. A clinician confirms each one on the patient page.</span></span>
          <select id="capture-every" className="field h-9 w-auto" defaultValue={String(s.captureMinutes)} onChange={async e => { try { await call('desktop.monitorCapture', { minutes: Number(e.target.value) }); toast('Saved'); } catch (x: any) { toast(x.message, 'crit'); } }}>
            <option value="0">Off</option><option value="15">Every 15 min</option><option value="30">Every 30 min</option><option value="60">Every hour</option><option value="120">Every 2 h</option><option value="240">Every 4 h</option>
          </select>
        </div>
        <div className="inset flex flex-col gap-2 p-3.5 text-[12.5px]">
          <span className="font-medium">Protocol verification</span>
          <span className="text-ink-3">Saves the raw stream from each port to the data folder so new fields can be confirmed. The files contain patient names — keep them on this PC.</span>
          <div className="flex gap-2">
            <Button size="sm" onClick={async () => { await call('desktop.monitorRecord', { on: !s.recording }); onClose(); }}>{s.recording ? 'Stop recording' : 'Record raw data'}</Button>
            <Button size="sm" variant="ghost" onClick={() => call('desktop.monitorOpenRecordings')}><FolderOpen size={14} />Open folder</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Setup({ s }: { s: Status }) {
  const enabled = s.config.filter(r => r.enabled);
  const steps: { ok: boolean; title: string; detail: string }[] = [
    ...enabled.filter(r => r.expectedAddress).map(r => {
      const st = s.receivers.find(x => x.id === r.id);
      return { ok: !!st?.hasExpectedAddress, title: `${r.name}: this PC has ${r.expectedAddress}`, detail: st?.hasExpectedAddress ? 'Found on a network adapter.' : `This PC has ${s.addresses.join(', ') || 'no network address'}. Add ${r.expectedAddress} (Network adapter → IPv4 → Advanced → Add).` };
    }),
    { ok: s.running, title: 'Receiving is on', detail: s.running ? s.receivers.filter(r => r.enabled).map(r => `${r.name}: ${r.listening.length} ports`).join(' · ') : 'An administrator presses "Start receiving". Close any other central station that uses the same ports first.' },
    { ok: false, title: 'Monitors connect', detail: 'Monitors reconnect within a few seconds. Allow the app through Windows Firewall if asked.' },
  ];
  return (
    <div className="card p-5">
      <h3 className="mb-3 flex items-center gap-2 text-[14.5px] font-semibold"><Wifi size={16} className="text-ink-3" />No monitors yet</h3>
      <ol className="flex flex-col gap-3">
        {steps.map((st, i) => (
          <li key={i} className="flex gap-3">
            {st.ok ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-good-ink" /> : <span className="tnum mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border border-line-2 text-[10.5px] text-ink-3">{i + 1}</span>}
            <span><span className="block text-[13px] font-medium">{st.title}</span><span className="block text-[12.5px] text-ink-3">{st.detail}</span></span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[12.5px] text-ink-3">Press <b>Demo</b> to see the screen with synthetic beds.</p>
    </div>
  );
}

// ── Who connected, and a network check for missing monitors ──

const since = (t: number) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };

function Connections({ s }: { s: Status }) {
  const rows = s.receivers.flatMap(r => (r.recent ?? []).map(c => ({ ...c, receiver: r.name }))).sort((a, b) => b.at - a.at).slice(0, 30);
  return (
    <div className="inset flex flex-col gap-2 p-3.5 text-[12.5px]">
      <span className="font-medium">Recent connections</span>
      <span className="text-ink-3">Every monitor that reached this PC, newest first. A monitor missing from here is not reaching this PC at all — see the network check on the Live monitor page.</span>
      {!rows.length ? <span className="text-ink-3">None yet.</span> : (
        <table className="w-full text-[12px]">
          <thead><tr className="text-left text-ink-3"><th className="py-1 font-medium">From</th><th className="font-medium">Port</th><th className="font-medium">Bed</th><th className="font-medium">Frames</th><th className="font-medium">When</th><th className="font-medium">State</th></tr></thead>
          <tbody className="tnum">
            {rows.map((c, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-1 font-mono">{c.remote ?? '?'}</td><td>{c.port}</td><td>{c.bed ?? '—'}</td>
                <td>{c.framesOk}{c.framesRejected ? <span className="text-warn-ink"> / {c.framesRejected} bad</span> : ''}</td>
                <td className="text-ink-3">{since(c.at)}</td>
                <td>{c.unknownProtocol ? <Chip tone="crit">Unknown protocol</Chip> : c.closedAt == null ? <Chip tone="good" dot>Open</Chip> : <span className="text-ink-3">closed after {Math.max(1, Math.round((c.closedAt - c.at) / 1000))} s</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const NET_STEPS = [
  { label: 'List every monitor on the network (cmd)', cmd: 'for /L %i in (1,1,40) do @ping -n 1 -w 300 192.168.10.%i | find "TTL"' },
  { label: 'Then show their hardware addresses', cmd: 'arp -a' },
  { label: 'Record which central address the missing monitors call — cmd as administrator, wait 2 min, then stop', cmd: 'netsh trace start capture=yes Ethernet.Type=ARP maxSize=20 tracefile=C:\\arp.etl' },
  { label: 'Stop the recording (send C:\\arp.etl to whoever supports the unit)', cmd: 'netsh trace stop' },
];

function NetworkCheck({ s, live }: { s: Status; live: number }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const seen = s.seenRemotes?.length ?? 0;
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast('Copied'); } catch { toast('Select the text and copy it', 'crit'); } };
  if (!s.running) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        {seen > live && <span className="flex items-center gap-1.5 rounded-xl border border-warn/30 bg-warn-soft px-3 py-1.5 text-warn-ink"><CircleAlert size={14} />{seen - live} monitor{seen - live > 1 ? 's' : ''} connected recently but {seen - live > 1 ? 'are' : 'is'} not sending — see Receivers → Recent connections.</span>}
        <button className="text-ink-3 underline hover:text-ink" onClick={() => setOpen(!open)}>{open ? 'Hide network check' : 'A monitor is missing?'}</button>
      </div>
      {open && (
        <div className="card flex flex-col gap-3 p-4 text-[12.5px]">
          <p className="text-ink-2">A monitor that never appears is not reaching this PC. Usually it is calling a <b>different central address</b> (another central station's IP), uses a <b>bed number another monitor already has</b>, or its cable is on another switch. Its switch light blinking while nothing arrives here points to the first. Run these on this PC:</p>
          {NET_STEPS.map(x => (
            <div key={x.cmd} className="flex flex-col gap-1">
              <span className="text-ink-3">{x.label}</span>
              <div className="flex items-center gap-2"><code className="flex-1 overflow-x-auto rounded-lg bg-panel-2 px-2.5 py-1.5 font-mono text-[11.5px] whitespace-nowrap">{x.cmd}</code><Button size="sm" variant="ghost" onClick={() => copy(x.cmd)}>Copy</Button></div>
            </div>
          ))}
          <p className="text-ink-3">If they call another address (for example 192.168.10.250), add it to this PC (Network adapter → IPv4 → Advanced → Add, mask 255.255.255.0) and add a receiver for it under <b>Receivers</b>. Bed numbers above {Math.max(...s.config.map(r => r.ports.mode === 'base+bed' ? r.ports.maxBed : 0), 0) || 64} need a larger range on the receiver.</p>
        </div>
      )}
    </div>
  );
}

// ── Overview card ────────────────────────────────────────────

function BedCard({ b, i, adm, multiReceiver }: { b: BedSnapshot; i: number; adm: CensusRow | null; multiReceiver: boolean }) {
  const v = b.values;
  const alarm = anyAlarm(b);
  return (
    <motion.button initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.03 }} onClick={() => go(href(b))}
      className={cx('card group flex flex-col gap-3 p-4 text-left transition hover:border-line-2', alarm && 'border-crit/50', b.stale && 'opacity-70')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="tnum rounded-md bg-panel-3 px-1.5 py-0.5 text-[11px] font-semibold text-ink-2">{bedTitle(b)}</span>
            <span className="truncate text-[14px] font-semibold">{b.patient?.name ?? 'Unnamed patient'}</span>
          </div>
          <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">
            {adm ? `${adm.name ?? adm.label} · ${dxLabel(adm.admission.primaryDx)}` : b.source === 'demo' ? 'Synthetic data' : 'Not matched to a census bed'}
            {multiReceiver && ` · ${b.receiverName}`}
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <ConnDot b={b} />
          {adm?.pews && <PewsChip p={adm.pews} compact />}
          {rescore(b, adm) && <Chip tone="warn">Rescore PEWS</Chip>}
          {b.recentEvents > 0 && <span className="flex items-center gap-1 text-[11px] text-warn-ink"><BellRing size={11} />{b.recentEvents} in 1 h</span>}
        </div>
      </div>
      <div className="grid grid-cols-[1.25fr_1fr_1fr] gap-2">
        <MiniStat label="SpO₂" unit="%" v={v.spo2} big tone="teal" />
        <MiniStat label="PR" unit="bpm" v={v.pr} />
        <MiniStat label="Temp" unit="°C" v={v.t1} digits={1} />
      </div>
      <div className="overflow-hidden rounded-xl bg-[#0b1214]">
        {b.probeOff ? <div className="grid h-[52px] place-items-center text-[11.5px] text-white/50">SpO₂ probe off</div> : <Waveform bed={b.id} kind="pleth" height={52} speed={90} />}
      </div>
    </motion.button>
  );
}

function MiniStat({ label, unit, v, digits = 0, big, tone }: { label: string; unit: string; v?: NV; digits?: number; big?: boolean; tone?: 'teal' }) {
  const value = val(v), bad = outside(v);
  const filled = !bad && tone === 'teal' && value != null;
  return (
    <div className={cx('rounded-2xl px-3 py-2', bad ? 'bg-crit-soft text-crit-ink' : filled ? 'text-white' : 'bg-panel-2')}
      style={filled ? { background: 'linear-gradient(140deg,#2dd4bf,#0891b2)' } : undefined}>
      <div className={cx('text-[11px] font-medium', filled ? 'text-white/85' : 'text-ink-3')}>{label}</div>
      <div className="flex items-baseline gap-1"><span className={cx('tnum font-semibold leading-tight', big ? 'text-[28px]' : 'text-[22px]')}>{show(value, digits)}</span><span className="text-[11px] opacity-70">{unit}</span></div>
    </div>
  );
}

function ConnDot({ b }: { b: BedSnapshot }) {
  return b.stale
    ? <Chip tone="warn" dot>{b.connected ? 'No data' : 'Offline'}</Chip>
    : <span className="flex items-center gap-1.5 text-[11.5px] text-good-ink"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-good" /></span>Live</span>;
}

// ── Central-station wall view ────────────────────────────────

function WallView({ beds, admFor }: { beds: BedSnapshot[]; admFor: (b: BedSnapshot) => CensusRow | null }) {
  const [full, setFull] = useState(false);
  useEffect(() => {
    // Keep the screen on while the wall is showing (where the platform allows it).
    let lock: any = null;
    (navigator as any).wakeLock?.request?.('screen').then((l: any) => { lock = l; }).catch(() => {});
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.fullscreenElement) go('monitor'); };
    window.addEventListener('keydown', esc);
    const fs = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', fs);
    return () => { lock?.release?.().catch?.(() => {}); window.removeEventListener('keydown', esc); document.removeEventListener('fullscreenchange', fs); };
  }, []);
  const cols = beds.length <= 1 ? 1 : beds.length <= 4 ? 2 : beds.length <= 9 ? 3 : 4;
  const toggleFull = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else document.documentElement.requestFullscreen?.().catch(() => {}); };
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#05080a] p-3 text-white">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-white/80"><LayoutGrid size={15} />Central station · {beds.filter(b => !b.stale).length} live / {beds.length}</span>
        <span className="hidden text-[11.5px] text-white/45 md:block">Secondary display — alarms stay on the bedside monitors</span>
        <div className="flex gap-1">
          <button onClick={toggleFull} className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white" title={full ? 'Exit full screen' : 'Full screen'}>{full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
          <button onClick={() => go('monitor')} className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white" title="Close (Esc)"><X size={16} /></button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: 'minmax(0, 1fr)' }}>
        {beds.map(b => <WallTile key={b.id} b={b} adm={admFor(b)} waveH={cols <= 2 ? [120, 96] : cols === 3 ? [76, 60] : [56, 44]} />)}
      </div>
    </div>
  );
}

function WallTile({ b, adm, waveH }: { b: BedSnapshot; adm: CensusRow | null; waveH: [number, number] }) {
  const v = b.values, alarm = anyAlarm(b);
  const Num = ({ label, value, color, unit, warn, digits = 0, small }: { label: string; value: number | null; color: string; unit: string; warn?: boolean; digits?: number; small?: boolean }) => (
    <div className={cx('flex flex-col rounded-lg px-2 py-1', warn && 'animate-pulse bg-red-500/25')}>
      <span className="text-[10.5px] font-semibold tracking-wide" style={{ color }}>{label}</span>
      <span className={cx('tnum leading-none font-semibold', small ? 'text-[22px]' : 'text-[38px]')} style={{ color }}>{show(value, digits)}<span className="ml-0.5 text-[11px] opacity-60">{unit}</span></span>
    </div>
  );
  return (
    <button onClick={() => go(href(b))} className={cx('relative flex min-h-0 flex-col overflow-hidden rounded-xl border bg-[#0b1214] p-2 text-left', alarm ? 'border-red-500/70' : 'border-white/10')}>
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="min-w-0 truncate text-[12.5px] font-semibold">{bedTitle(b)} · <span className="text-white/70">{b.patient?.name ?? adm?.name ?? 'Unnamed'}</span></span>
        <span className={cx('h-2 w-2 shrink-0 rounded-full', b.stale ? 'bg-amber-400' : 'bg-emerald-400')} />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-2">
        <div className="flex min-h-0 flex-col justify-center">
          {b.leadsOff ? <div className="py-3 text-[11px] text-white/40">ECG · leads off</div> : <Waveform bed={b.id} kind="ecg" height={waveH[0]} speed={130} label="II" />}
          {b.probeOff ? <div className="py-3 text-[11px] text-white/40">Pleth · probe off</div> : <Waveform bed={b.id} kind="pleth" height={waveH[1]} speed={100} label="Pleth" />}
        </div>
        <div className="flex flex-col justify-center gap-1">
          <Num label={b.leadsOff ? 'PR' : 'HR'} value={b.leadsOff ? val(v.pr) : val(v.hr) ?? val(v.pr)} color={WAVE_COLOR.ecg} unit="bpm" warn={outside(v.hr) || outside(v.pr)} />
          <Num label="SpO₂" value={val(v.spo2)} color={WAVE_COLOR.pleth} unit="%" warn={outside(v.spo2)} />
          <div className="flex gap-1">
            <Num label="T" value={val(v.t1)} color="#fbbf24" unit="°" digits={1} small warn={outside(v.t1)} />
            <Num label="NIBP" value={val(v.sys)} color="#e5e7eb" unit="" small />
          </div>
        </div>
      </div>
      {b.stale && <div className="absolute inset-0 grid place-items-center bg-black/55 text-[13px] text-white/80">{b.connected ? 'No data' : 'Offline'} · {sinceLabel(b.lastFrameAt)}</div>}
    </button>
  );
}

// ── Focus view (one bed) ─────────────────────────────────────

const EVENT_LABEL: Record<BedEvent['kind'], string> = { desat: 'Desaturation', high: 'Above limit', low: 'Below limit', 'probe-off': 'SpO₂ probe off', 'leads-off': 'ECG leads off', disconnected: 'Monitor disconnected' };
const PARAM_LABEL: Partial<Record<Param, string>> = { spo2: 'SpO₂', pr: 'Pulse', hr: 'HR', rr: 'RR', t1: 'Temp', sys: 'NIBP sys' };

function BedFocus({ b, adm, census, mapped, canChart }: { b: BedSnapshot; adm: CensusRow | null; census: CensusRow[]; mapped: string | null; canChart: boolean }) {
  const toast = useToast();
  const v = b.values;
  useEffect(() => { setMonitorFocus(b.id); return () => setMonitorFocus(null); }, [b.id]);
  const phone = isPhone();
  const trend = useApi<Partial<Record<Param, TrendPoint[]>>>('desktop.monitorTrend', { id: b.id });
  const events = useApi<BedEvent[]>('desktop.monitorEvents', { id: b.id });
  useEffect(() => { const t = setInterval(() => { trend.reload(); events.reload(); }, 30_000); return () => clearInterval(t); }, [trend.reload, events.reload]);
  const [trendParam, setTrendParam] = useState<'pr' | 'spo2' | 'hr' | 't1'>('pr');
  const [range, setRange] = useState<'1h' | '4h' | '12h'>('4h');
  const [chartOpen, setChartOpen] = useState(false);
  const ageMonths = ageFrom(b.patient?.birthDate);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const nibp = [val(v.sys), val(v.dia)];
  const sensors = [
    { id: 'ecg', label: 'ECG', ...SENSOR_SPOTS.ecg, on: !b.leadsOff && !b.stale },
    { id: 'spo2', label: 'SpO₂', ...SENSOR_SPOTS.spo2, on: !b.probeOff && !b.stale },
    { id: 'nibp', label: 'NIBP', ...SENSOR_SPOTS.nibp, on: val(v.sys) != null },
    { id: 'temp', label: 'Temp', ...SENSOR_SPOTS.temp, on: val(v.t1) != null },
  ];
  const trendDefs = { pr: { label: 'Pulse rate', unit: 'bpm', color: 'var(--series-3)' }, spo2: { label: 'SpO₂', unit: '%', color: '#06b6d4' }, hr: { label: 'Heart rate', unit: 'bpm', color: '#34d399' }, t1: { label: 'Temperature', unit: '°C', color: '#f59e0b' } } as const;
  const rangeMs = { '1h': 3_600_000, '4h': 4 * 3_600_000, '12h': 12 * 3_600_000 }[range];
  const tp = (trend.data?.[trendParam] ?? []).filter(p => Date.now() - p.t <= rangeMs);
  const avg = tp.length ? Math.round(tp.reduce((s, p) => s + p.mean, 0) / tp.length * 10) / 10 : null;
  const evs = events.data ?? [];
  const mapTo = async (bed: string | null) => { try { await call('desktop.monitorMapBed', { id: b.id, censusBed: bed }); toast(bed ? `Linked to census bed ${bed}` : 'Link cleared'); } catch (e: any) { toast(e.message, 'crit'); } };
  const beds = [...new Set(census.map(r => r.admission.bed).filter(Boolean) as string[])].sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <button onClick={() => go('monitor')} className="mb-2 flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink"><ArrowLeft size={14} />All monitors</button>
            <p className="text-[13px] text-ink-3">{greeting},</p>
            <h1 className={cx('truncate leading-tight font-semibold tracking-tight', phone ? 'text-[24px]' : 'text-[30px]')}>{b.patient?.name ?? (adm ? adm.name ?? adm.label : 'Unnamed patient')}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Chip tone="accent">{bedTitle(b)}</Chip>
              <ConnDot b={b} />
              {b.remote && b.source === 'network' && <Chip>{b.receiverName} · {b.remote}</Chip>}
            </div>
          </div>
          {canChart && adm && <Button variant="primary" onClick={() => setChartOpen(true)}><ClipboardPlus size={16} />Record in chart</Button>}
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Fact value={ageMonths != null ? fmtAge(ageMonths) : '—'} label="Age" />
          <Fact value={b.patient?.admitDate ? new Date(`${b.patient.admitDate}T00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'} label="Admitted (monitor)" />
          <Fact value={sinceLabel(b.connectedAt)} label="Connected" />
          <Fact value={b.lastFrameAt ? sinceLabel(b.lastFrameAt) : '—'} label="Last data" />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <VitalTile tone={outside(v.t1) ? 'alert' : 'teal'} title="Temperature" sub={v.t1?.high != null ? `Limits ${v.t1.low}–${v.t1.high} °C` : undefined} value={show(val(v.t1), 1)} unit="°C">
            <TickGauge value={val(v.t1)} min={34} max={41} />
          </VitalTile>
          <VitalTile tone={outside(v.spo2) ? 'alert' : 'sky'} title="Oxygen saturation" sub={v.spo2?.low != null ? `Alarm below ${v.spo2.low}%` : undefined} value={show(val(v.spo2))} unit="%" />
          <VitalTile title="Pulse rate" sub={b.probeOff ? 'Probe off' : v.pr?.high != null ? `Limits ${v.pr.low}–${v.pr.high}` : undefined} value={show(val(v.pr))} unit="bpm"
            badge={outside(v.pr) ? <Chip tone="crit">Outside limits</Chip> : undefined} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <VitalTile title={<span className="flex items-center gap-1.5"><HeartPulse size={14} />Heart rate (ECG)</span>} sub={b.leadsOff ? 'Leads off' : undefined} value={show(val(v.hr))} unit="bpm" badge={v.hr?.confidence === 'provisional' ? <Chip tone="warn">Unverified</Chip> : undefined} />
          <VitalTile title="Blood pressure (NIBP)" sub={val(v.mean) != null ? `Mean ${val(v.mean)} mmHg` : 'No reading yet'} value={nibp[0] == null ? '--/--' : `${nibp[0]}/${show(nibp[1])}`} unit="mmHg" badge={v.sys?.confidence === 'provisional' ? <Chip tone="warn">Unverified</Chip> : undefined} />
        </div>

        <div className="overflow-hidden rounded-[20px] border border-line bg-[#0b1214] p-3">
          <div className="mb-1 flex items-center justify-between px-1 text-[11.5px] text-white/60"><span className="flex items-center gap-1.5"><Activity size={13} />Live waveforms</span><span>{b.stale ? 'Paused — no data' : phone ? '≈ 1–2 s behind the monitor' : '≈ 0.5 s behind the monitor'}</span></div>
          {b.leadsOff ? <Flat label="ECG II · leads off" color={WAVE_COLOR.ecg} /> : <Waveform bed={b.id} kind="ecg" height={96} speed={140} label="ECG II" />}
          {b.probeOff ? <Flat label="Pleth · probe off" color={WAVE_COLOR.pleth} /> : <Waveform bed={b.id} kind="pleth" height={80} speed={110} label="Pleth" />}
          <Waveform bed={b.id} kind="resp" height={56} speed={45} label="Resp" />
        </div>

        <div className="card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-[14.5px] font-semibold">{trendDefs[trendParam].label}</h3>
              <p className="tnum text-[12px] text-ink-3">{avg != null ? `${avg} ${trendDefs[trendParam].unit} average · min–max per bar` : 'Min–max per bar'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ContinuousTabs tabs={[{ id: '1h', label: '1 h' }, { id: '4h', label: '4 h' }, { id: '12h', label: '12 h' }]} value={range} onChange={x => setRange(x as typeof range)} />
              <ContinuousTabs tabs={[{ id: 'pr', label: 'Pulse' }, { id: 'spo2', label: 'SpO₂' }, { id: 't1', label: 'Temp' }, { id: 'hr', label: 'HR' }]} value={trendParam} onChange={x => setTrendParam(x as typeof trendParam)} />
            </div>
          </div>
          <RangeBars points={tp} binMinutes={range === '1h' ? 2 : range === '4h' ? 5 : 15} color={trendDefs[trendParam].color} unit={trendDefs[trendParam].unit} />
        </div>

        <div className="card p-5">
          <h3 className="mb-3 flex items-center gap-2 text-[14.5px] font-semibold"><BellRing size={15} className="text-ink-3" />Events <span className="text-[12px] font-normal text-ink-3">· outside this monitor's own limits for 10 s or more, sensors and connection</span></h3>
          {!evs.length ? <p className="text-[12.5px] text-ink-3">No events since the monitor connected.</p> : (
            <ul className="flex flex-col divide-y divide-line">
              {evs.slice(0, 30).map((e, i) => (
                <li key={i} className="flex items-center gap-3 py-2 text-[13px]">
                  <span className={cx('h-2 w-2 shrink-0 rounded-full', e.kind === 'desat' || e.kind === 'high' || e.kind === 'low' ? 'bg-crit' : 'bg-warn')} />
                  <span className="tnum w-14 shrink-0 text-ink-3">{new Date(e.start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="min-w-0 flex-1">{EVENT_LABEL[e.kind]}{e.param && ` · ${PARAM_LABEL[e.param] ?? e.param}`}{e.worst != null && <span className="text-ink-3"> · worst {e.worst}{e.limit != null && ` (limit ${e.limit})`}</span>}</span>
                  <span className="tnum shrink-0 text-ink-3">{e.end == null ? <Chip tone="crit" dot>ongoing</Chip> : durLabel(e.end - e.start)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 xl:sticky xl:top-0 xl:self-start">
        <div className="card flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-[13.5px] font-semibold"><Link2 size={14} className="text-ink-3" />Census patient</h3>
            {b.source === 'network' && canChart && !phone && (
              <select id="map-bed" className="field h-8 w-auto py-0 text-[12.5px]" value={mapped ?? ''} onChange={e => mapTo(e.target.value || null)} title="Which census bed this monitor belongs to">
                <option value="">Bed {b.bed} (same number)</option>
                {beds.filter(x => x !== String(b.bed)).map(x => <option key={x} value={x}>Census bed {x}</option>)}
              </select>
            )}
          </div>
          {adm ? (
            <button onClick={() => go(`patient/${adm.admission.id}`)} className="flex flex-col gap-2 text-left">
              <span className="text-[14px] font-semibold">{adm.name ?? adm.label}</span>
              <span className="text-[12.5px] text-ink-3">{dxLabel(adm.admission.primaryDx)} · bed {adm.admission.bed}</span>
              <span className="flex flex-wrap gap-1.5"><RespChip level={adm.resp.level} />{adm.vaso.map(x => <Chip key={x.id} tone="crit">{x.agent}</Chip>)}{adm.abx.map(x => <Chip key={x.id} tone="info">{x.drug}</Chip>)}</span>
            </button>
          ) : <p className="text-[12.5px] text-ink-3">{b.source === 'demo' ? 'Demo beds are not linked to patients.' : `No patient in census bed ${mapped ?? b.bed}. Pick the right bed above.`}</p>}
        </div>
        {!phone && <div className="xl:h-[540px]"><BodyMap sensors={sensors}>
          <div className="absolute top-4 right-4 left-4 flex items-center justify-between text-[12px] text-ink-3"><span>Sensors</span><span>{sensors.filter(s => s.on).length} of {sensors.length} live</span></div>
          <div className="card absolute right-4 bottom-14 w-[140px] p-3">
            <div className="text-[12.5px] font-semibold">Oxygen level</div>
            <div className="mt-2 text-[11px] text-ink-3">SpO₂</div>
            <div className="flex items-baseline gap-1"><span className="tnum text-[30px] leading-none font-semibold">{show(val(v.spo2))}</span><span className="text-[12px] text-ink-3">%</span></div>
          </div>
          <div className="absolute bottom-4 left-4 flex flex-wrap gap-1.5">
            {sensors.map(s => <Chip key={s.id} tone={s.on ? 'good' : 'neutral'} dot>{s.label}</Chip>)}
          </div>
        </BodyMap></div>}
      </div>

      {chartOpen && adm && <RecordModal b={b} adm={adm} onClose={() => setChartOpen(false)} />}
    </div>
  );
}

const Fact = ({ value, label }: { value: string; label: string }) => (
  <div><div className="tnum text-[22px] font-semibold tracking-tight">{value}</div><div className="text-[12px] text-ink-3">{label}</div></div>
);
const Flat = ({ label, color }: { label: string; color: string }) => (
  <div className="relative h-[56px]"><span className="absolute top-1 left-2 text-[10.5px] font-semibold" style={{ color }}>{label}</span><div className="absolute top-1/2 right-2 left-2 border-t border-dashed" style={{ borderColor: color, opacity: 0.35 }} /></div>
);

// ── Copy current readings into the patient's vitals ──────────

function RecordModal({ b, adm, onClose }: { b: BedSnapshot; adm: CensusRow; onClose: () => void }) {
  const toast = useToast();
  const v = b.values;
  const rows = [
    { code: 'spo2', label: 'SpO₂', value: val(v.spo2), unit: '%', verified: v.spo2?.confidence !== 'provisional' },
    { code: 'hr', label: 'Heart rate (from pulse rate)', value: val(v.pr), unit: '/min', verified: v.pr?.confidence !== 'provisional' },
    { code: 'rr', label: 'Respiratory rate', value: val(v.rr), unit: '/min', verified: v.rr?.confidence !== 'provisional' },
    { code: 'temp', label: 'Temperature', value: val(v.t1), unit: '°C', verified: v.t1?.confidence !== 'provisional' },
    { code: 'sbp', label: 'Systolic BP', value: val(v.sys), unit: 'mmHg', verified: v.sys?.confidence !== 'provisional' },
    { code: 'dbp', label: 'Diastolic BP', value: val(v.dia), unit: 'mmHg', verified: v.dia?.confidence !== 'provisional' },
  ].filter(r => r.value != null);
  const [pick, setPick] = useState(() => new Set(rows.filter(r => r.verified).map(r => r.code)));
  const save = async () => {
    const values = Object.fromEntries(rows.filter(r => pick.has(r.code)).map(r => [r.code, r.value]));
    try { await call('vitals.add', { admissionId: adm.admission.id, at: nowLocal(), context: 'routine', values }); toast(`Vitals recorded for ${adm.name ?? adm.label}`); onClose(); }
    catch (e: any) { toast(e.message, 'crit'); }
  };
  return (
    <Modal open onClose={onClose} title="Record in chart" subtitle={`${bedTitle(b)} → ${adm.name ?? adm.label}. Check the monitor shows the same values before saving.`} width={520}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!pick.size} onClick={save}>Save {pick.size} value{pick.size === 1 ? '' : 's'}</Button></>}>
      {!rows.length ? <p className="text-[13px] text-ink-3">No readings to record right now.</p> : (
        <div className="flex flex-col gap-1.5">
          {rows.map(r => (
            <label key={r.code} className="flex cursor-pointer items-center gap-3 rounded-xl border border-line px-3 py-2.5 hover:bg-panel-2">
              <input type="checkbox" checked={pick.has(r.code)} onChange={e => { const n = new Set(pick); if (e.target.checked) n.add(r.code); else n.delete(r.code); setPick(n); }} />
              <span className="flex-1 text-[13px]">{r.label}{!r.verified && <span className="ml-2 text-[11.5px] text-warn-ink">unverified decoding</span>}</span>
              <span className="tnum text-[14px] font-semibold">{r.value}<span className="ml-1 text-[11.5px] font-normal text-ink-3">{r.unit}</span></span>
            </label>
          ))}
        </div>
      )}
      <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-ink-3"><Thermometer size={12} />Saved as a routine set at the current time; the usual range checks apply.</p>
    </Modal>
  );
}

// ── Phone: a list of beds, alarms first; tap for waveforms ───

function PhoneOverview({ beds, admFor, status }: { beds: BedSnapshot[]; admFor: (b: BedSnapshot) => CensusRow | null; status?: Status }) {
  const sorted = [...beds].sort((a, b) => Number(anyAlarm(b)) - Number(anyAlarm(a)) || Number(a.stale) - Number(b.stale));
  const alarms = beds.filter(anyAlarm).length;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight">Live monitor</h1>
        <p className="text-[12px] text-ink-3">{beds.filter(b => !b.stale).length} live of {beds.length} monitors{alarms ? ` · ${alarms} outside limits` : ''}. A second screen, not an alarm system.</p>
      </div>
      {!beds.length && (
        <Empty icon={<WifiOff size={18} />} title={status?.running ? 'Waiting for monitors' : 'Receiving is off'}>
          <p className="text-[12.5px] text-ink-3">{status?.running ? 'The PICU PC is listening; no monitor has sent data yet.' : 'Turn on receiving on the PICU PC (Live monitor → Start receiving).'}</p>
        </Empty>
      )}
      {sorted.map(b => <PhoneBedTile key={b.id} b={b} adm={admFor(b)} />)}
    </div>
  );
}

function PhoneBedTile({ b, adm }: { b: BedSnapshot; adm: CensusRow | null }) {
  const v = b.values, alarm = anyAlarm(b);
  const cell = (label: string, x: NV | undefined, unit: string, digits = 0) => (
    <div className={cx('rounded-xl px-2 py-1.5', outside(x) ? 'bg-crit-soft text-crit-ink' : 'bg-panel-2')}>
      <div className="text-[10.5px] text-ink-3">{label}</div>
      <div className="tnum text-[20px] leading-tight font-semibold">{show(val(x), digits)}<span className="ml-0.5 text-[10px] font-normal opacity-70">{unit}</span></div>
    </div>
  );
  const bp = val(v.sys) == null ? '--/--' : `${val(v.sys)}/${show(val(v.dia))}`;
  return (
    <button onClick={() => go(href(b))} className={cx('card flex flex-col gap-2.5 p-3.5 text-left', alarm && 'border-crit/60 ring-1 ring-crit/25', b.stale && 'opacity-70')}>
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="flex items-center gap-2"><span className="tnum rounded-md bg-panel-3 px-1.5 py-0.5 text-[11px] font-semibold">{bedTitle(b)}</span><span className="truncate text-[14px] font-semibold">{adm ? adm.name ?? adm.label : b.patient?.name ?? (b.source === 'demo' ? 'Synthetic data' : 'Not matched to census')}</span></span>
          {adm && <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">{dxLabel(adm.admission.primaryDx)}</span>}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1"><ConnDot b={b} />{adm?.pews && <PewsChip p={adm.pews} compact />}{b.recentEvents > 0 && <span className="flex items-center gap-1 text-[11px] text-warn-ink"><BellRing size={11} />{b.recentEvents} in 1 h</span>}</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {cell('SpO₂', v.spo2, '%')}{cell('Pulse', v.pr, 'bpm')}{cell('HR', v.hr, 'bpm')}
        {cell('RR', v.rr, '/min')}{cell('Temp', v.t1, '°C', 1)}
        <div className="rounded-xl bg-panel-2 px-2 py-1.5"><div className="text-[10.5px] text-ink-3">NIBP</div><div className="tnum text-[17px] leading-tight font-semibold">{bp}</div></div>
      </div>
      {(b.probeOff || b.leadsOff) && <span className="text-[11.5px] text-warn-ink">{[b.probeOff && 'SpO₂ probe off', b.leadsOff && 'ECG leads off'].filter(Boolean).join(' · ')}</span>}
      {rescore(b, adm) && <span className="flex items-center gap-1.5 text-[12px] font-medium text-warn-ink"><CircleAlert size={13} />Rescore PEWS — the live rates suggest it has risen</span>}
    </button>
  );
}
