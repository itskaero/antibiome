// ═══════════════════════════════════════════════════════════
//  Live monitor gateway — takes the central station's place on the monitor network.
//
//  Nothing about the network is fixed in code. The gateway runs any number of *receivers*, each
//  configured with a driver (the monitor protocol, shared/monitor/drivers), a listening address and a
//  port plan (base + bed, an explicit port list, or one port where the data names the bed). It
//  answers with the driver's keep-alive / acknowledgements and publishes the latest values,
//  waveform samples and events to the window a few times a second.
//
//  Read-only by design: it never writes to a monitor beyond what that monitor's own central station
//  sends. Values are held in memory only; the optional raw recording is for protocol verification
//  and stays in the app's data folder.
// ═══════════════════════════════════════════════════════════
import { EventEmitter } from 'node:events';
import { createServer, type Server, type Socket } from 'node:net';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { DEFAULT_BASE_PORT, WAVE_RATE, type NumericValue, type PatientInfo } from '../shared/monitor/protocol';
import { DEMO_PATIENTS, drift, patientFrame, secondOfData } from '../shared/monitor/simulator';
import { driverById, type MonitorEvent, type Param, type PortPlan } from '../shared/monitor/drivers';

export type { Param } from '../shared/monitor/drivers';

export interface ReceiverConfig {
  id: string; name: string; driver: string; enabled: boolean;
  /** Address to listen on: 0.0.0.0 = every network adapter. */
  host: string;
  ports: PortPlan;
  /** The address the monitors send to (shown as a setup check), e.g. 192.168.10.251. Optional. */
  expectedAddress?: string;
  timeSync: boolean;
}
export const DEFAULT_RECEIVER: ReceiverConfig = {
  id: 'r1', name: 'Bedside monitors', driver: 'ddt', enabled: true, host: '0.0.0.0',
  ports: { mode: 'base+bed', base: DEFAULT_BASE_PORT, maxBed: 64 }, expectedAddress: '192.168.10.251', timeSync: false,
};

export const TREND_PARAMS: Param[] = ['spo2', 'pr', 'hr', 'rr', 't1', 'sys'];

export interface BedSnapshot {
  /** Stable key: `${receiverId}:${bed}`. */
  id: string; receiverId: string; receiverName: string; bed: number;
  source: 'network' | 'demo'; remote: string | null; connected: boolean;
  connectedAt: number | null; lastFrameAt: number | null; stale: boolean;
  patient: PatientInfo | null;
  values: Partial<Record<Param, NumericValue>>;
  probeOff: boolean; leadsOff: boolean; framesRejected: number;
  /** Events in the last hour (for badges); the full list comes from events(). */
  recentEvents: number;
}
export interface WaveChunk { pleth?: number[]; ecg?: number[]; resp?: number[] }
export interface MonitorUpdate { at: number; beds: BedSnapshot[]; waves: Record<string, WaveChunk>; rates: typeof WAVE_RATE }
export interface TrendPoint { t: number; min: number; max: number; mean: number }
export type MonitorEventKind = 'desat' | 'high' | 'low' | 'probe-off' | 'leads-off' | 'disconnected';
export interface BedEvent { kind: MonitorEventKind; param?: Param; start: number; end: number | null; worst?: number; limit?: number }
/** One TCP connection from a monitor (kept so an administrator can see who tried to connect, and what happened). */
export interface ConnectionRecord { at: number; remote: string | null; port: number; bed: number | null; framesOk: number; framesRejected: number; bytes: number; closedAt: number | null; unknownProtocol: boolean }
/** Two monitors sending as the same bed (same port / bed number) from different addresses. */
export interface BedConflict { receiverId: string; bed: number; remotes: string[]; at: number }
export interface ReceiverStatus { id: string; name: string; driver: string; enabled: boolean; listening: number[]; failed: { port: number; error: string }[]; expectedAddress?: string; hasExpectedAddress: boolean | null; connections: number; recent: ConnectionRecord[] }
export interface MonitorStatus { running: boolean; demo: boolean; receivers: ReceiverStatus[]; addresses: string[]; recording: boolean; conflicts: BedConflict[]; seenRemotes: string[] }

const STALE_MS = 5000;
const CONN_LOG = 50;
/** A connection that sends data but no valid frame for this long is speaking another protocol. */
export const UNKNOWN_PROTOCOL_MS = 30_000;
/** Conflicts and "seen" addresses are reported for this long after they last happened. */
const RECENT_MS = 10 * 60_000;
const TREND_MINUTES = 12 * 60;
const EVENTS_KEPT = 300;
const MIN_EVENT_MS = 10_000;   // a breach must last this long to count as an event
const LIMIT_PARAMS: Param[] = ['spo2', 'pr', 'hr', 'rr'];

interface Bed extends BedSnapshot {
  waves: Required<WaveChunk>; trend: Map<Param, TrendPoint[]>; minute: Map<Param, number[]>; socket: Socket | null;
  events: BedEvent[]; open: Map<string, BedEvent>;
}

export function lanIPv4(): string[] {
  return Object.values(networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a!.address);
}

/** Ports a receiver listens on and the bed each one implies (null = the data names the bed). */
export function portsOf(plan: PortPlan): { port: number; bed: number | null }[] {
  switch (plan.mode) {
    case 'base+bed': return Array.from({ length: plan.maxBed }, (_, i) => ({ port: plan.base + i + 1, bed: i + 1 }));
    case 'list': return Object.entries(plan.map).map(([p, bed]) => ({ port: Number(p), bed: Number(bed) }));
    case 'single': return [{ port: plan.port, bed: null }];
  }
}

export function validateReceiver(r: ReceiverConfig): string | null {
  if (!r.id || !/^[\w-]{1,24}$/.test(r.id)) return 'Receiver id must be letters, digits or dashes.';
  if (!driverById(r.driver)) return `Unknown monitor protocol "${r.driver}".`;
  if (!r.name?.trim()) return 'Give the receiver a name.';
  const ports = portsOf(r.ports);
  if (!ports.length) return 'Add at least one port.';
  if (r.ports.mode === 'base+bed' && (r.ports.maxBed < 1 || r.ports.maxBed > 250)) return 'Highest bed number must be 1–250.';
  for (const { port, bed } of ports) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) return `Port ${port} is not between 1 and 65535.`;
    if (bed != null && (!Number.isInteger(bed) || bed < 1 || bed > 250)) return `Bed ${bed} must be a whole number 1–250.`;
  }
  if (new Set(ports.map(p => p.port)).size !== ports.length) return 'A port is listed twice.';
  if (!/^[\d.:a-fA-F]+$/.test(r.host)) return 'Listen address must be an IP address (0.0.0.0 for all adapters).';
  return null;
}

export class MonitorGateway extends EventEmitter {
  private servers = new Map<string, { server: Server; port: number }[]>();
  private failed = new Map<string, { port: number; error: string }[]>();
  private receivers: ReceiverConfig[] = [];
  private beds = new Map<string, Bed>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private demoTimer: ReturnType<typeof setInterval> | null = null;
  private demoT = 0;
  private recordDir: string | null = null;
  private conns = new Map<string, ConnectionRecord[]>();
  private conflicts = new Map<string, BedConflict>();

  constructor(public now: () => number = Date.now) {
    super();
    this.timers.push(setInterval(() => this.publish(), 250));
    this.timers.push(setInterval(() => this.rollMinute(), 60_000));
  }

  status(): MonitorStatus {
    const addresses = lanIPv4();
    return {
      running: [...this.servers.values()].some(s => s.length > 0), demo: !!this.demoTimer, addresses, recording: !!this.recordDir,
      receivers: this.receivers.map(r => ({
        id: r.id, name: r.name, driver: r.driver, enabled: r.enabled,
        listening: (this.servers.get(r.id) ?? []).map(s => s.port).sort((a, b) => a - b),
        failed: this.failed.get(r.id) ?? [], expectedAddress: r.expectedAddress || undefined,
        hasExpectedAddress: r.expectedAddress ? addresses.includes(r.expectedAddress) || r.host === r.expectedAddress : null,
        connections: [...this.beds.values()].filter(b => b.receiverId === r.id && b.connected).length,
        recent: [...(this.conns.get(r.id) ?? [])].reverse(),
      })),
      conflicts: [...this.conflicts.values()].filter(c => this.now() - c.at < RECENT_MS),
      seenRemotes: [...new Set([...this.conns.values()].flat().filter(c => c.remote && (c.closedAt == null || this.now() - c.closedAt < RECENT_MS)).map(c => c.remote!))].sort(),
    };
  }

  /** Apply a full receiver configuration: stops removed/changed receivers, starts enabled ones. */
  async configure(receivers: ReceiverConfig[]): Promise<MonitorStatus> {
    for (const r of receivers) { const err = validateReceiver(r); if (err) throw new Error(`${r.name || r.id}: ${err}`); }
    if (new Set(receivers.map(r => r.id)).size !== receivers.length) throw new Error('Two receivers have the same id.');
    await this.stop();
    this.receivers = receivers.map(r => ({ ...r }));
    for (const r of this.receivers.filter(x => x.enabled)) await this.startReceiver(r);
    return this.status();
  }

  async stop() {
    for (const b of this.beds.values()) if (b.source === 'network') { b.socket?.destroy(); b.socket = null; b.connected = false; }
    const all = [...this.servers.values()].flat();
    await Promise.all(all.map(s => new Promise<void>(r => s.server.close(() => r()))));
    this.servers.clear(); this.failed.clear();
  }

  private async startReceiver(r: ReceiverConfig) {
    const list: { server: Server; port: number }[] = [], failed: { port: number; error: string }[] = [];
    await Promise.all(portsOf(r.ports).map(({ port, bed }) => new Promise<void>(resolve => {
      const server = createServer(sock => this.accept(r, sock, bed, port));
      server.once('error', (e: NodeJS.ErrnoException) => {
        failed.push({ port, error: e.code === 'EADDRINUSE' ? 'in use — is another central station (e.g. CMS.exe) running?' : e.code === 'EACCES' ? 'not permitted' : e.code === 'EADDRNOTAVAIL' ? `this PC does not have the address ${r.host}` : e.message });
        resolve();
      });
      server.listen({ port, host: r.host, exclusive: true }, () => { list.push({ server, port }); server.on('error', err => console.error('[monitor]', err)); resolve(); });
    })));
    this.servers.set(r.id, list);
    this.failed.set(r.id, failed.sort((a, b) => a.port - b.port));
  }

  setDemo(on: boolean) {
    if (this.demoTimer) { clearInterval(this.demoTimer); this.demoTimer = null; }
    for (const [k, b] of this.beds) if (b.source === 'demo') this.beds.delete(k);
    if (!on) return;
    const driver = driverById('ddt')!;
    const readers = new Map(DEMO_PATIENTS.map(p => [p.bed, driver.createReader()]));
    const feed = () => {
      for (const p of DEMO_PATIENTS) {
        const sim = drift(p, this.demoT);
        const frames = this.demoT === 0 ? [patientFrame(sim)] : [];
        frames.push(...secondOfData(sim, this.demoT, { probeOff: p.bed === 3 && this.demoT % 90 > 75 }));
        for (const f of frames) this.ingestEvents({ id: 'demo', name: 'Demo' }, p.bed, readers.get(p.bed)!.push(f).events, 'demo', 'demo');
      }
      this.demoT++;
    };
    feed();
    this.demoTimer = setInterval(feed, 1000);
  }

  setRecording(dir: string | null) {
    if (dir) mkdirSync(dir, { recursive: true });
    this.recordDir = dir;
  }

  trend(id: string): Partial<Record<Param, TrendPoint[]>> {
    const b = this.beds.get(id);
    if (!b) return {};
    const out: Partial<Record<Param, TrendPoint[]>> = {};
    for (const p of TREND_PARAMS) {
      const cur = b.minute.get(p) ?? [];
      out[p] = [...(b.trend.get(p) ?? []), ...(cur.length ? [point(this.now(), cur)] : [])];
    }
    return out;
  }

  events(id: string): BedEvent[] {
    const b = this.beds.get(id);
    return b ? [...b.events, ...b.open.values()].filter(e => e.end != null || this.now() - e.start >= MIN_EVENT_MS || e.kind !== 'desat' && e.kind !== 'high' && e.kind !== 'low').sort((a, c) => c.start - a.start) : [];
  }

  /** Median of each verified value over the last `minutes` (for proposing a chart entry). */
  recentMedian(id: string, minutes = 5): Partial<Record<Param, number>> {
    const b = this.beds.get(id); if (!b) return {};
    const out: Partial<Record<Param, number>> = {};
    for (const p of TREND_PARAMS) {
      const vals = [...(b.trend.get(p) ?? []).filter(x => this.now() - x.t <= minutes * 60_000).map(x => x.mean), ...(b.minute.get(p) ?? [])];
      if (vals.length) { vals.sort((x, y) => x - y); out[p] = vals[Math.floor(vals.length / 2)]; }
    }
    return out;
  }

  snapshot(): BedSnapshot[] {
    const now = this.now();
    return [...this.beds.values()].sort((a, b) => a.receiverName.localeCompare(b.receiverName) || a.bed - b.bed).map(b => ({
      id: b.id, receiverId: b.receiverId, receiverName: b.receiverName, bed: b.bed, source: b.source, remote: b.remote, connected: b.connected,
      connectedAt: b.connectedAt, lastFrameAt: b.lastFrameAt, stale: !b.lastFrameAt || now - b.lastFrameAt > STALE_MS, patient: b.patient,
      values: b.values, probeOff: b.probeOff, leadsOff: b.leadsOff, framesRejected: b.framesRejected,
      recentEvents: this.events(b.id).filter(e => now - e.start < 3_600_000).length,
    }));
  }

  dispose() { this.timers.forEach(clearInterval); this.setDemo(false); return this.stop(); }

  // ── internals ──────────────────────────────────────────────

  private bed(r: { id: string; name: string }, n: number, source: 'network' | 'demo'): Bed {
    const id = `${r.id}:${n}`;
    let b = this.beds.get(id);
    if (!b) {
      b = { id, receiverId: r.id, receiverName: r.name, bed: n, source, remote: null, connected: false, connectedAt: null, lastFrameAt: null, stale: true,
        patient: null, values: {}, probeOff: false, leadsOff: false, framesRejected: 0, recentEvents: 0,
        waves: { pleth: [], ecg: [], resp: [] }, trend: new Map(), minute: new Map(), socket: null, events: [], open: new Map() };
      this.beds.set(id, b);
    }
    return b;
  }

  private accept(r: ReceiverConfig, sock: Socket, bedFromPort: number | null, port: number) {
    const driver = driverById(r.driver)!;
    const reader = driver.createReader();
    const remote = sock.remoteAddress?.replace(/^::ffff:/, '') ?? null;
    const touched = new Set<Bed>();
    const rec: ConnectionRecord = { at: this.now(), remote, port, bed: bedFromPort, framesOk: 0, framesRejected: 0, bytes: 0, closedAt: null, unknownProtocol: false };
    const log = this.conns.get(r.id) ?? []; log.push(rec); if (log.length > CONN_LOG) log.splice(0, log.length - CONN_LOG); this.conns.set(r.id, log);
    // With a port-per-bed plan the bed is known now; otherwise the first message names it.
    const claim = (n: number) => {
      const b = this.bed(r, n, 'network');
      if (!touched.has(b)) {
        // A different address sending as the same bed while the first is still connected: two monitors share a bed number.
        if (b.socket && b.socket !== sock && !b.socket.destroyed && b.remote && remote && b.remote !== remote) {
          const key = `${r.id}:${n}`, prev = this.conflicts.get(key);
          this.conflicts.set(key, { receiverId: r.id, bed: n, remotes: [...new Set([...(prev?.remotes ?? []), b.remote, remote])].sort(), at: this.now() });
        }
        if (b.socket && b.socket !== sock && bedFromPort != null) b.socket.destroy(); // a monitor that reconnects replaces its old connection
        Object.assign(b, { socket: bedFromPort != null ? sock : b.socket, remote, connected: true, connectedAt: this.now(), source: 'network' as const });
        this.closeEvent(b, 'disconnected');
        touched.add(b);
      }
      return b;
    };
    if (bedFromPort != null) claim(bedFromPort);
    sock.setNoDelay(true);
    sock.setKeepAlive(true, 10_000);
    const ka = driver.keepAlive ? setInterval(() => { if (!sock.destroyed) sock.write(driver.keepAlive!.bytes()); }, driver.keepAlive.intervalMs) : null;
    for (const m of driver.onConnect?.({ timeSync: r.timeSync, now: new Date(this.now()) }) ?? []) sock.write(m);
    sock.on('data', (chunk: Buffer) => {
      if (this.recordDir) { try { appendFileSync(join(this.recordDir, `${r.id}-port-${port}.bin`), chunk); } catch { /* disk full: keep monitoring */ } }
      const { events, reply } = reader.push(chunk);
      for (const m of reply ?? []) sock.write(m);
      rec.bytes += chunk.length; rec.framesOk += events.length; rec.framesRejected = reader.rejected;
      if (rec.bed == null && events[0]?.bed != null) rec.bed = events[0].bed;
      if (!rec.framesOk && rec.bytes > 0 && this.now() - rec.at >= UNKNOWN_PROTOCOL_MS) rec.unknownProtocol = true;
      for (const ev of events) {
        const n = bedFromPort ?? ev.bed;
        if (n == null || n < 1 || n > 250) continue;
        const b = claim(n);
        b.framesRejected = reader.rejected;
        this.apply(b, ev);
      }
    });
    const done = () => {
      if (ka) clearInterval(ka);
      if (rec.closedAt == null) { rec.closedAt = this.now(); if (!rec.framesOk && rec.bytes > 0 && rec.closedAt - rec.at >= UNKNOWN_PROTOCOL_MS) rec.unknownProtocol = true; }
      for (const b of touched) if (b.socket === sock || bedFromPort == null) { b.socket = null; b.connected = false; this.openEvent(b, 'disconnected'); }
    };
    sock.on('close', done);
    sock.on('error', done);
  }

  /** Feed decoded events for one bed. Exposed for tests and the demo. */
  ingestEvents(r: { id: string; name: string }, bedNo: number, events: MonitorEvent[], source: 'network' | 'demo', remote: string | null) {
    const b = this.bed(r, bedNo, source);
    if (source === 'demo') Object.assign(b, { connected: true, remote, connectedAt: b.connectedAt ?? this.now() });
    for (const ev of events) this.apply(b, ev);
  }

  private apply(b: Bed, ev: MonitorEvent) {
    b.lastFrameAt = this.now();
    switch (ev.kind) {
      case 'patient': b.patient = ev.patient; break;
      case 'wave': push(b.waves[ev.wave], ev.samples); break;
      case 'values':
        Object.assign(b.values, ev.values);
        if (ev.probeOff != null) { b.probeOff = ev.probeOff; ev.probeOff ? this.openEvent(b, 'probe-off') : this.closeEvent(b, 'probe-off'); }
        if (ev.leadsOff != null) { b.leadsOff = ev.leadsOff; ev.leadsOff ? this.openEvent(b, 'leads-off') : this.closeEvent(b, 'leads-off'); }
        for (const [p, v] of Object.entries(ev.values) as [Param, NumericValue][]) {
          this.sample(b, p, v.value);
          if (LIMIT_PARAMS.includes(p)) this.checkLimits(b, p, v);
        }
        break;
    }
  }

  private checkLimits(b: Bed, p: Param, v: NumericValue) {
    const value = v.value;
    const low = value != null && v.alarmOn && v.low != null && value < v.low;
    const high = value != null && v.alarmOn && v.high != null && value > v.high;
    const lowKind = p === 'spo2' ? 'desat' : 'low';
    if (low) this.openEvent(b, lowKind, p, value!, v.low ?? undefined, 'min'); else this.closeEvent(b, lowKind, p);
    if (high) this.openEvent(b, 'high', p, value!, v.high ?? undefined, 'max'); else this.closeEvent(b, 'high', p);
  }

  private openEvent(b: Bed, kind: MonitorEventKind, param?: Param, value?: number, limit?: number, dir?: 'min' | 'max') {
    const key = `${kind}:${param ?? ''}`;
    const cur = b.open.get(key);
    if (cur) { if (value != null && cur.worst != null) cur.worst = dir === 'min' ? Math.min(cur.worst, value) : Math.max(cur.worst, value); return; }
    b.open.set(key, { kind, param, start: this.now(), end: null, worst: value, limit });
  }

  private closeEvent(b: Bed, kind: MonitorEventKind, param?: Param) {
    const key = `${kind}:${param ?? ''}`;
    const cur = b.open.get(key);
    if (!cur) return;
    b.open.delete(key);
    cur.end = this.now();
    // Brief threshold crossings are noise; keep breaches that lasted, and every connection/sensor event.
    if (['desat', 'high', 'low'].includes(kind) && cur.end - cur.start < MIN_EVENT_MS) return;
    b.events.push(cur);
    if (b.events.length > EVENTS_KEPT) b.events.splice(0, b.events.length - EVENTS_KEPT);
  }

  private sample(b: Bed, p: Param, v: number | null) {
    if (v == null || !TREND_PARAMS.includes(p)) return;
    let m = b.minute.get(p); if (!m) b.minute.set(p, m = []);
    m.push(v);
  }

  private rollMinute() {
    const t = this.now();
    for (const b of this.beds.values()) for (const p of TREND_PARAMS) {
      const m = b.minute.get(p);
      if (!m?.length) continue;
      let tr = b.trend.get(p); if (!tr) b.trend.set(p, tr = []);
      tr.push(point(t, m)); if (tr.length > TREND_MINUTES) tr.splice(0, tr.length - TREND_MINUTES);
      b.minute.set(p, []);
    }
  }

  private publish() {
    if (!this.beds.size || !this.listenerCount('update')) return;
    const waves: Record<string, WaveChunk> = {};
    for (const b of this.beds.values()) {
      if (b.waves.pleth.length || b.waves.ecg.length) waves[b.id] = { pleth: b.waves.pleth, ecg: b.waves.ecg, resp: b.waves.resp };
      b.waves = { pleth: [], ecg: [], resp: [] };
    }
    const update: MonitorUpdate = { at: this.now(), beds: this.snapshot(), waves, rates: WAVE_RATE };
    this.emit('update', update);
  }
}

function push(target: number[], src: Uint8Array) {
  for (let i = 0; i < src.length; i++) target.push(src[i]);
  if (target.length > 4096) target.splice(0, target.length - 4096); // window hidden: drop, never grow
}
function point(t: number, vals: number[]): TrendPoint {
  let min = Infinity, max = -Infinity, sum = 0;
  for (const v of vals) { if (v < min) min = v; if (v > max) max = v; sum += v; }
  return { t, min, max, mean: Math.round((sum / vals.length) * 10) / 10 };
}

/** Old single-receiver settings (v0.2) → one receiver. */
export function receiversFromLegacy(basePort: number | null, maxBed: number | null, timeSync: boolean): ReceiverConfig[] {
  return [{ ...DEFAULT_RECEIVER, ports: { mode: 'base+bed', base: basePort ?? DEFAULT_BASE_PORT, maxBed: maxBed ?? 64 }, timeSync }];
}
