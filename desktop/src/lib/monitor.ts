// Live bedside-monitor data in the window. Values go through React state (a few updates a second);
// waveform samples go into plain queues that the canvas drains at display rate, so drawing never
// re-renders React.
import { useEffect, useState } from 'react';
import type { BedSnapshot, MonitorUpdate } from '../../server/monitorGateway';
import { getDevice, isPhone, sessionHeaders } from './api';

export type { BedSnapshot, MonitorStatus, TrendPoint, Param, BedEvent, ReceiverConfig, ReceiverStatus } from '../../server/monitorGateway';
export type { PortPlan } from '../../shared/monitor/drivers';
export type WaveKind = 'ecg' | 'pleth' | 'resp';

const queues = new Map<string, number[]>();
let beds: BedSnapshot[] = [];
let rates: MonitorUpdate['rates'] = { ecg: 256, pleth: 256, resp: 128 };
let lastUpdate = 0;
const subs = new Set<() => void>();
let unsubscribe: (() => void) | null = null;

/** Samples waiting to be drawn for one bed's waveform (drained by <Waveform>). */
export const waveQueue = (id: string, kind: WaveKind) => {
  const k = `${id}|${kind}`;
  let q = queues.get(k); if (!q) queues.set(k, q = []);
  return q;
};
export const waveRate = (kind: WaveKind) => rates[kind];

function onUpdate(u: Partial<MonitorUpdate> & { waves?: MonitorUpdate['waves'] }) {
  if (u.beds) beds = u.beds;
  if (u.rates) rates = u.rates as MonitorUpdate['rates'];
  lastUpdate = Date.now();
  for (const [bed, w] of Object.entries(u.waves ?? {})) {
    for (const kind of ['ecg', 'pleth', 'resp'] as const) {
      const src = w[kind]; if (!src?.length) continue;
      const q = waveQueue(bed, kind);
      for (let i = 0; i < src.length; i++) q.push(src[i]);
      if (q.length > rates[kind] * 4) q.splice(0, q.length - rates[kind] * 2); // tab was hidden: catch up
    }
  }
  subs.forEach(f => f());
}

// ── Phone feed ──
// Phones get the same updates over a server-sent event stream: numbers for every bed once a second, and
// waveforms only for the bed on screen (setMonitorFocus), at a reduced rate.
let focusBed: string | null = null;
let phoneStream: EventSource | null = null;
let phoneRetry: ReturnType<typeof setTimeout> | null = null;
let phoneFails = 0;
let phoneWanted = false;
async function openPhoneStream() {
  if (!phoneWanted || phoneStream) return;
  const dev = getDevice(), headers = sessionHeaders();
  if (!dev || !headers) return;
  const r = await fetch('/events-ticket', { method: 'POST', cache: 'no-store', credentials: 'omit', headers }).then(x => x.json()).catch(() => null);
  if (!phoneWanted || phoneStream) return;
  if (!r?.ok) { schedulePhone(); return; }
  const es = new EventSource(`/monitor?t=${encodeURIComponent(r.data)}${focusBed ? `&bed=${encodeURIComponent(focusBed)}` : ''}`);
  phoneStream = es;
  es.onmessage = e => { phoneFails = 0; try { onUpdate(JSON.parse(e.data)); } catch { /* ignore a bad frame */ } };
  es.onerror = () => { if (phoneStream === es) { es.close(); phoneStream = null; schedulePhone(); } };
}
function schedulePhone() {
  if (phoneRetry || !phoneWanted) return;
  phoneFails++;
  phoneRetry = setTimeout(() => { phoneRetry = null; openPhoneStream(); }, Math.min(30_000, 1500 * 2 ** Math.min(4, phoneFails - 1)));
}
function closePhoneStream() { phoneStream?.close(); phoneStream = null; if (phoneRetry) { clearTimeout(phoneRetry); phoneRetry = null; } }
function startPhone() {
  phoneWanted = true; openPhoneStream();
  const vis = () => { if (document.hidden) closePhoneStream(); else openPhoneStream(); };
  document.addEventListener('visibilitychange', vis);
  return () => { phoneWanted = false; closePhoneStream(); document.removeEventListener('visibilitychange', vis); };
}
/** Which bed's waveforms the phone should receive (null = numbers only). No effect on the PC. */
export function setMonitorFocus(id: string | null) {
  if (!isPhone() || focusBed === id) return;
  focusBed = id;
  for (const k of [...queues.keys()]) if (!id || !k.startsWith(`${id}|`)) queues.delete(k);
  if (phoneWanted) { closePhoneStream(); openPhoneStream(); }
}

/** Subscribe to the live feed. The IPC listener (or the phone's stream) is attached while any component uses it. */
export function useMonitorBeds() {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick(n => n + 1);
    subs.add(f);
    if (!unsubscribe) {
      if (window.antibiome?.onMonitor) unsubscribe = window.antibiome.onMonitor(onUpdate);
      else if (isPhone()) unsubscribe = startPhone();
    }
    return () => { subs.delete(f); if (!subs.size && unsubscribe) { unsubscribe(); unsubscribe = null; } };
  }, []);
  return { beds, lastUpdate };
}

export const ageFrom = (birthDate: string | null | undefined, now = new Date()) => {
  if (!birthDate) return null;
  const b = new Date(`${birthDate}T00:00`);
  if (Number.isNaN(b.getTime()) || b.getFullYear() <= 2000 && b.getMonth() === 0 && b.getDate() === 1) return null; // 2000-01-01 = monitor default
  return (now.getFullYear() - b.getFullYear()) * 12 + now.getMonth() - b.getMonth() - (now.getDate() < b.getDate() ? 1 : 0);
};
