// Monitor settings and routes, kept out of electron/main.ts so they can be tested with an in-memory
// database. Receivers and the monitor→census bed map are stored as JSON settings.
import { getSetting, setSetting, type DB } from './db';
import { DRIVER_INFO } from '../shared/monitor/drivers';
import { MonitorGateway, receiversFromLegacy, validateReceiver, type ReceiverConfig } from './monitorGateway';
import type { Role } from '../shared/types';

export interface MonitorServiceEnv {
  requireRole: (...roles: Role[]) => void;
  audit: (summary: string) => void;
  recordDir: string;
  openFolder?: (dir: string) => unknown;
}

const VIEW: Role[] = ['admin', 'clinician', 'viewer'];

export function loadReceivers(db: DB): ReceiverConfig[] {
  const raw = getSetting(db, 'monitorReceivers');
  if (raw) { try { const r = JSON.parse(raw); if (Array.isArray(r)) return r; } catch { /* fall through to legacy */ } }
  const base = getSetting(db, 'monitorBasePort'), max = getSetting(db, 'monitorMaxBed');
  return receiversFromLegacy(base ? Number(base) : null, max ? Number(max) : null, getSetting(db, 'monitorTimeSync') === '1');
}
export function loadBedMap(db: DB): Record<string, string> {
  try { return JSON.parse(getSetting(db, 'monitorBedMap', '{}')) ?? {}; } catch { return {}; }
}

export function createMonitorService(db: DB, gateway: MonitorGateway, env: MonitorServiceEnv) {
  const enabled = () => getSetting(db, 'monitorEnabled') === '1';
  const status = () => ({ ...gateway.status(), enabled: enabled(), drivers: DRIVER_INFO, config: loadReceivers(db), bedMap: loadBedMap(db), recordDir: env.recordDir });
  const start = () => gateway.configure(enabled() ? loadReceivers(db) : []);

  const routes: Record<string, (p: any) => unknown> = {
    'desktop.monitorStatus': () => { env.requireRole(...VIEW); return status(); },
    'desktop.monitorSnapshot': () => { env.requireRole(...VIEW); return gateway.snapshot(); },
    'desktop.monitorTrend': (p: { id: string }) => { env.requireRole(...VIEW); return gateway.trend(String(p.id)); },
    'desktop.monitorEvents': (p: { id: string }) => { env.requireRole(...VIEW); return gateway.events(String(p.id)); },
    /** Turn receiving on or off with the saved receivers. */
    'desktop.monitorConfigure': async (p: { enabled: boolean }) => {
      env.requireRole('admin');
      setSetting(db, 'monitorEnabled', p.enabled ? '1' : '0');
      await start();
      const st = status();
      env.audit(p.enabled ? `Live monitor receiving turned on (${st.receivers.filter(r => r.enabled).map(r => `${r.name}: ${r.listening.length} ports`).join('; ')})` : 'Live monitor receiving turned off');
      return st;
    },
    /** Replace the receiver list (validated), then restart if receiving is on. */
    'desktop.monitorSaveReceivers': async (p: { receivers: ReceiverConfig[] }) => {
      env.requireRole('admin');
      const list = (p.receivers ?? []).map(r => ({ ...r, name: String(r.name ?? '').trim(), host: String(r.host ?? '0.0.0.0').trim() || '0.0.0.0', expectedAddress: r.expectedAddress?.trim() || undefined, timeSync: !!r.timeSync, enabled: r.enabled !== false }));
      for (const r of list) { const err = validateReceiver(r); if (err) throw new Error(`${r.name || r.id}: ${err}`); }
      if (new Set(list.map(r => r.id)).size !== list.length) throw new Error('Two receivers have the same id.');
      setSetting(db, 'monitorReceivers', JSON.stringify(list));
      await start();
      env.audit(`Monitor receivers updated: ${list.map(r => `${r.name} (${r.driver}, ${r.enabled ? 'on' : 'off'})`).join('; ') || 'none'}`);
      return status();
    },
    /** Point a monitor bed at a census bed (null = use the same number). */
    'desktop.monitorMapBed': (p: { id: string; censusBed: string | null }) => {
      env.requireRole('admin', 'clinician');
      const map = loadBedMap(db), id = String(p.id);
      if (!/^[\w-]+:\d+$/.test(id)) throw new Error('Unknown monitor bed');
      const bed = p.censusBed == null ? null : String(p.censusBed).trim();
      if (bed) map[id] = bed.slice(0, 12); else delete map[id];
      setSetting(db, 'monitorBedMap', JSON.stringify(map));
      env.audit(bed ? `Monitor ${id} mapped to census bed ${bed}` : `Monitor ${id} mapping cleared`);
      return map;
    },
    'desktop.monitorDemo': (p: { on: boolean }) => { env.requireRole('admin', 'clinician'); gateway.setDemo(!!p.on); return status(); },
    'desktop.monitorRecord': (p: { on: boolean }) => {
      env.requireRole('admin');
      gateway.setRecording(p.on ? env.recordDir : null);
      env.audit(p.on ? 'Raw monitor recording started (protocol verification)' : 'Raw monitor recording stopped');
      return status();
    },
    'desktop.monitorOpenRecordings': () => { env.requireRole('admin'); return env.openFolder?.(env.recordDir); },
  };
  return { routes, start, status };
}

export { censusBedFor } from '../shared/monitor/beds';
