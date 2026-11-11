// Scalis / M3100 central-station protocol ("DDT"), see ../protocol.ts and docs/MONITOR_PROTOCOL.md.
import { DEFAULT_BASE_PORT, FrameReader, HEARTBEAT, decode, encodeTimeSync } from '../protocol';
import type { MonitorDriver, MonitorEvent } from './types';

export const ddtDriver: MonitorDriver = {
  id: 'ddt',
  label: 'Scalis / M3100 (DDT)',
  description: 'Bedside monitors that report to an M3100 central station. Each monitor connects on port 510 + its bed number.',
  defaultPorts: { mode: 'base+bed', base: DEFAULT_BASE_PORT, maxBed: 64 },
  bedInData: true,
  keepAlive: { intervalMs: 1000, bytes: () => HEARTBEAT },
  onConnect: ({ timeSync, now }) => (timeSync ? [encodeTimeSync(now)] : []),
  createReader() {
    const frames = new FrameReader();
    return {
      get rejected() { return frames.rejected; },
      push(chunk) {
        const events: MonitorEvent[] = [];
        for (const body of frames.push(chunk)) {
          const d = decode(body);
          switch (d.kind) {
            case 'patient': events.push({ kind: 'patient', bed: d.bed, patient: d.patient }); break;
            case 'pleth':
              events.push({ kind: 'values', bed: d.bed, values: { spo2: d.spo2, pr: d.pr }, probeOff: d.probeOff });
              events.push({ kind: 'wave', bed: d.bed, wave: 'pleth', samples: d.wave });
              break;
            case 'ecg':
              events.push({ kind: 'values', bed: d.bed, values: { hr: d.hr }, leadsOff: d.leadsOff });
              events.push({ kind: 'wave', bed: d.bed, wave: 'ecg', samples: d.waves.lead2 });
              events.push({ kind: 'wave', bed: d.bed, wave: 'resp', samples: d.waves.resp });
              break;
            case 'nibp': events.push({ kind: 'values', bed: d.bed, values: { sys: d.sys, dia: d.dia, mean: d.mean } }); break;
            case 'temp': events.push({ kind: 'values', bed: d.bed, values: { t1: d.t1, t2: d.t2 } }); break;
          }
        }
        return { events };
      },
    };
  },
};
