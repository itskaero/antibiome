// A monitor driver turns one TCP byte stream into monitor events. Drivers are pure (no Node APIs),
// so they run in the gateway, in tests and in the simulator alike. Adding a monitor brand means
// adding a driver here and registering it in ./index.ts — nothing else in the app changes.
import type { NumericValue, PatientInfo } from '../protocol';

export type Param = 'spo2' | 'pr' | 'hr' | 'rr' | 'sys' | 'dia' | 'mean' | 't1' | 't2';

export type MonitorEvent =
  | { kind: 'patient'; bed: number | null; patient: PatientInfo }
  /** Numeric readings. Only the params present are updated. */
  | { kind: 'values'; bed: number | null; values: Partial<Record<Param, NumericValue>>; probeOff?: boolean; leadsOff?: boolean }
  | { kind: 'wave'; bed: number | null; wave: 'ecg' | 'pleth' | 'resp'; samples: Uint8Array };

export interface DriverReader {
  /** Feed received bytes; returns the events decoded so far and any bytes to send back (acknowledgements). */
  push(chunk: Uint8Array): { events: MonitorEvent[]; reply?: Uint8Array[] };
  /** Messages dropped as malformed (checksum, framing). */
  rejected: number;
}

export interface DriverOptions { timeSync: boolean; now: Date }

export interface MonitorDriver {
  id: string;
  label: string;
  description: string;
  /** Suggested port layout for a new receiver using this driver. */
  defaultPorts: PortPlan;
  /** True when every message names its own bed, so one port can serve the whole unit. */
  bedInData: boolean;
  createReader(): DriverReader;
  /** Sent periodically on each open connection (the central station's keep-alive). */
  keepAlive?: { intervalMs: number; bytes: () => Uint8Array };
  /** Sent once when a monitor connects. */
  onConnect?(opts: DriverOptions): Uint8Array[];
}

/** How a receiver's ports map to beds. */
export type PortPlan =
  | { mode: 'base+bed'; base: number; maxBed: number }   // bed n connects to base + n
  | { mode: 'list'; map: Record<string, number> }        // explicit port → bed
  | { mode: 'single'; port: number };                    // one port; bed comes from the data
