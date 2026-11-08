// Live bedside-monitor data in the window. Values go through React state (a few updates a second);
// waveform samples go into plain queues that the canvas drains at display rate, so drawing never
// re-renders React.
import { useEffect, useState } from 'react';
import type { BedSnapshot, MonitorUpdate } from '../../server/monitorGateway';

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

function onUpdate(u: MonitorUpdate) {
  beds = u.beds; rates = u.rates; lastUpdate = Date.now();
  for (const [bed, w] of Object.entries(u.waves)) {
    for (const kind of ['ecg', 'pleth', 'resp'] as const) {
      const src = w[kind]; if (!src?.length) continue;
      const q = waveQueue(bed, kind);
      for (let i = 0; i < src.length; i++) q.push(src[i]);
      if (q.length > rates[kind] * 4) q.splice(0, q.length - rates[kind] * 2); // tab was hidden: catch up
    }
  }
  subs.forEach(f => f());
}

/** Subscribe to the live feed. The IPC listener is attached while any component uses it. */
export function useMonitorBeds() {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick(n => n + 1);
    subs.add(f);
    if (!unsubscribe && window.antibiome?.onMonitor) unsubscribe = window.antibiome.onMonitor(onUpdate);
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
