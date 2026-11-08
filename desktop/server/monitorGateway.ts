// ═══════════════════════════════════════════════════════════
//  Live monitor gateway — takes the central station's place on the monitor network.
//
//  Each bedside monitor connects to TCP port (basePort + bed number) on 192.168.10.251. The
//  gateway listens on those ports, decodes the stream (shared/monitor/protocol.ts), answers with
//  the same keep-alive the M3100 central station sends, and publishes the latest values and new
//  waveform samples to the window a few times a second.
//
//  Read-only by design: it never writes to the monitors beyond the keep-alive (and the optional
//  clock synchronisation the central station also sends). Values are held in memory only; the
//  optional raw recording is for protocol verification and stays in the app's data folder.
// ═══════════════════════════════════════════════════════════
import { EventEmitter } from 'node:events';
import { createServer, type Server, type Socket } from 'node:net';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { DEFAULT_BASE_PORT, FrameReader, HEARTBEAT, WAVE_RATE, decode, encodeTimeSync, type NumericValue, type PatientInfo } from '../shared/monitor/protocol';
import { DEMO_PATIENTS, drift, patientFrame, secondOfData } from '../shared/monitor/simulator';

export const MONITOR_ADDRESS = '192.168.10.251';

export interface MonitorConfig { basePort: number; maxBed: number; host: string; heartbeat: boolean; timeSync: boolean }
export const DEFAULT_MONITOR_CONFIG: MonitorConfig = { basePort: DEFAULT_BASE_PORT, maxBed: 64, host: '0.0.0.0', heartbeat: true, timeSync: false };

export type Param = 'spo2' | 'pr' | 'hr' | 'sys' | 'dia' | 'mean' | 't1' | 't2';
export const TREND_PARAMS: Param[] = ['spo2', 'pr', 'hr', 't1', 'sys'];

export interface BedSnapshot {
  bed: number; source: 'network' | 'demo'; remote: string | null; connected: boolean;
  connectedAt: number | null; lastFrameAt: number | null; stale: boolean;
  patient: PatientInfo | null;
  values: Partial<Record<Param, NumericValue>>;
  probeOff: boolean; leadsOff: boolean; framesRejected: number;
}
export interface WaveChunk { pleth?: number[]; ecg?: number[]; resp?: number[] }
export interface MonitorUpdate { at: number; beds: BedSnapshot[]; waves: Record<number, WaveChunk>; rates: typeof WAVE_RATE }
export interface TrendPoint { t: number; min: number; max: number; mean: number }
export interface MonitorStatus {
  running: boolean; demo: boolean; config: MonitorConfig; listening: number; failed: { port: number; error: string }[];
  addresses: string[]; hasMonitorAddress: boolean; recording: boolean; error: string | null;
}

const STALE_MS = 5000;
const TREND_MINUTES = 12 * 60;

interface Bed extends BedSnapshot { waves: Required<WaveChunk>; trend: Map<Param, TrendPoint[]>; minute: Map<Param, number[]>; socket: Socket | null }

export function lanIPv4(): string[] {
  return Object.values(networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a!.address);
}

export class MonitorGateway extends EventEmitter {
  private servers: Server[] = [];
  private beds = new Map<number, Bed>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private demoTimer: ReturnType<typeof setInterval> | null = null;
  private demoT = 0;
  private recordDir: string | null = null;
  private failed: { port: number; error: string }[] = [];
  private lastError: string | null = null;
  config: MonitorConfig = { ...DEFAULT_MONITOR_CONFIG };

  constructor(private now: () => number = Date.now) {
    super();
    this.timers.push(setInterval(() => this.publish(), 250));
    this.timers.push(setInterval(() => this.rollMinute(), 60_000));
  }

  status(): MonitorStatus {
    const addresses = lanIPv4();
    return {
      running: this.servers.length > 0, demo: !!this.demoTimer, config: this.config, listening: this.servers.length, failed: this.failed,
      addresses, hasMonitorAddress: addresses.includes(MONITOR_ADDRESS), recording: !!this.recordDir, error: this.lastError,
    };
  }

  /** Listen on basePort+1 … basePort+maxBed. Ports that are taken (the original central station) are reported, not fatal. */
  async start(config: Partial<MonitorConfig> = {}): Promise<MonitorStatus> {
    await this.stop();
    this.config = { ...DEFAULT_MONITOR_CONFIG, ...config };
    const { basePort, maxBed, host } = this.config;
    if (!Number.isInteger(basePort) || basePort < 1 || basePort + maxBed > 65535 || !Number.isInteger(maxBed) || maxBed < 1 || maxBed > 250) {
      throw new Error('Monitor ports must be between 1 and 65535 (base port + bed number).');
    }
    this.failed = []; this.lastError = null;
    await Promise.all(Array.from({ length: maxBed }, (_, i) => i + 1).map(bed => new Promise<void>(resolve => {
      const port = basePort + bed;
      const server = createServer(sock => this.accept(sock, bed));
      server.once('error', (e: NodeJS.ErrnoException) => {
        this.failed.push({ port, error: e.code === 'EADDRINUSE' ? 'in use — is the original central station (CMS) running?' : e.code === 'EACCES' ? 'not permitted' : e.message });
        resolve();
      });
      server.listen({ port, host, exclusive: true }, () => { this.servers.push(server); server.on('error', err => console.error('[monitor]', err)); resolve(); });
    })));
    if (!this.servers.length) this.lastError = this.failed[0] ? `Could not listen on any monitor port (port ${this.failed[0].port}: ${this.failed[0].error}).` : 'Could not listen.';
    this.failed.sort((a, b) => a.port - b.port);
    return this.status();
  }

  async stop() {
    for (const b of this.beds.values()) if (b.source === 'network') { b.socket?.destroy(); b.socket = null; b.connected = false; }
    await Promise.all(this.servers.map(s => new Promise<void>(r => s.close(() => r()))));
    this.servers = [];
  }

  setDemo(on: boolean) {
    if (this.demoTimer) { clearInterval(this.demoTimer); this.demoTimer = null; }
    for (const [k, b] of this.beds) if (b.source === 'demo') this.beds.delete(k);
    if (!on) return;
    const feed = () => {
      for (const p of DEMO_PATIENTS) {
        // Demo beds use 100+ so they can never be confused with a real monitor's bed number.
        const sim = drift({ ...p, bed: 100 + p.bed }, this.demoT);
        const frames = this.demoT === 0 ? [patientFrame(sim)] : [];
        frames.push(...secondOfData(sim, this.demoT, { probeOff: p.bed === 3 && this.demoT % 90 > 75 }));
        for (const f of frames) this.ingest(sim.bed, f.subarray(2), 'demo', 'demo');
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

  trend(bed: number): Partial<Record<Param, TrendPoint[]>> {
    const b = this.beds.get(bed);
    if (!b) return {};
    const out: Partial<Record<Param, TrendPoint[]>> = {};
    for (const p of TREND_PARAMS) {
      const cur = b.minute.get(p) ?? [];
      out[p] = [...(b.trend.get(p) ?? []), ...(cur.length ? [point(this.now(), cur)] : [])];
    }
    return out;
  }

  snapshot(): BedSnapshot[] {
    const now = this.now();
    return [...this.beds.values()].sort((a, b) => a.bed - b.bed).map(b => ({
      bed: b.bed, source: b.source, remote: b.remote, connected: b.connected, connectedAt: b.connectedAt, lastFrameAt: b.lastFrameAt,
      stale: !b.lastFrameAt || now - b.lastFrameAt > STALE_MS, patient: b.patient, values: b.values, probeOff: b.probeOff, leadsOff: b.leadsOff,
      framesRejected: b.framesRejected,
    }));
  }

  dispose() { this.timers.forEach(clearInterval); this.setDemo(false); return this.stop(); }

  // ── internals ──────────────────────────────────────────────

  private bed(n: number, source: 'network' | 'demo'): Bed {
    let b = this.beds.get(n);
    if (!b) {
      b = { bed: n, source, remote: null, connected: false, connectedAt: null, lastFrameAt: null, stale: true, patient: null, values: {}, probeOff: false,
        leadsOff: false, framesRejected: 0, waves: { pleth: [], ecg: [], resp: [] }, trend: new Map(), minute: new Map(), socket: null };
      this.beds.set(n, b);
    }
    return b;
  }

  private accept(sock: Socket, bedFromPort: number) {
    const b = this.bed(bedFromPort, 'network');
    b.socket?.destroy(); // a monitor that reconnects replaces its old connection
    Object.assign(b, { socket: sock, remote: sock.remoteAddress?.replace(/^::ffff:/, '') ?? null, connected: true, connectedAt: this.now(), source: 'network' });
    sock.setNoDelay(true);
    sock.setKeepAlive(true, 10_000);
    const reader = new FrameReader();
    let hb: ReturnType<typeof setInterval> | null = null;
    if (this.config.heartbeat) hb = setInterval(() => { if (!sock.destroyed) sock.write(HEARTBEAT); }, 1000);
    if (this.config.timeSync) sock.write(encodeTimeSync(new Date(this.now())));
    sock.on('data', (chunk: Buffer) => {
      if (this.recordDir) { try { appendFileSync(join(this.recordDir, `bed-${String(bedFromPort).padStart(2, '0')}.bin`), chunk); } catch { /* disk full: keep monitoring */ } }
      const frames = reader.push(chunk);
      b.framesRejected = reader.rejected;
      for (const f of frames) this.ingest(bedFromPort, f, 'network', b.remote);
    });
    const done = () => { if (hb) clearInterval(hb); if (b.socket === sock) { b.socket = null; b.connected = false; } };
    sock.on('close', done);
    sock.on('error', done);
  }

  /** Feed one decoded frame body into a bed's state. Exposed for tests and the demo. */
  ingest(bedNo: number, body: Uint8Array, source: 'network' | 'demo', remote: string | null) {
    const d = decode(body);
    const b = this.bed(bedNo, source);
    if (source === 'demo') Object.assign(b, { connected: true, remote, connectedAt: b.connectedAt ?? this.now() });
    b.lastFrameAt = this.now();
    switch (d.kind) {
      case 'patient': b.patient = d.patient; break;
      case 'pleth':
        b.values.spo2 = d.spo2; b.values.pr = d.pr; b.probeOff = d.probeOff;
        push(b.waves.pleth, d.wave); this.sample(b, 'spo2', d.spo2.value); this.sample(b, 'pr', d.pr.value);
        break;
      case 'ecg':
        b.values.hr = d.hr; b.leadsOff = d.leadsOff;
        push(b.waves.ecg, d.waves.lead2); push(b.waves.resp, d.waves.resp); this.sample(b, 'hr', d.hr.value);
        break;
      case 'nibp': b.values.sys = d.sys; b.values.dia = d.dia; b.values.mean = d.mean; this.sample(b, 'sys', d.sys.value); break;
      case 'temp': b.values.t1 = d.t1; b.values.t2 = d.t2; this.sample(b, 't1', d.t1.value); break;
    }
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
    const waves: Record<number, WaveChunk> = {};
    for (const b of this.beds.values()) {
      if (b.waves.pleth.length || b.waves.ecg.length) waves[b.bed] = { pleth: b.waves.pleth, ecg: b.waves.ecg, resp: b.waves.resp };
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
