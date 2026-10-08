// Renderer-side API client.
//  - On the PICU PC: the preload bridge (IPC) is the only door to data.
//  - On a phone (browser over the hospital Wi-Fi): HTTPS to the PC with the paired device's
//    credential; the session token lives in memory only, so closing the tab ends the session.
import { isRead } from '@shared/apiMethods';

declare global {
  interface Window {
    antibiome?: {
      call: (method: string, params?: unknown) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
      onChanged?: (fn: () => void) => () => void;
    };
  }
}

export const isPhone = () => !window.antibiome;

const listeners = new Set<() => void>();
/** Subscribe to "data changed" — every successful mutation (here or on another device) reloads views. */
export const onDataChanged = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const notifyDataChanged = () => listeners.forEach(fn => fn());
window.antibiome?.onChanged?.(notifyDataChanged);

// ── Phone transport ──────────────────────────────────────────

const DEVICE_KEY = 'antibiome-device';
export interface PairedDevice { deviceId: string; secret: string; name: string }
export const getDevice = (): PairedDevice | null => { try { return JSON.parse(localStorage.getItem(DEVICE_KEY) ?? 'null'); } catch { return null; } };
export const forgetDevice = () => { try { localStorage.removeItem(DEVICE_KEY); } catch { /* ignore */ } sessionToken = null; closeEvents(); };

let sessionToken: string | null = null;
let lastLocalChange = 0;
let events: EventSource | null = null;
const closeEvents = () => { events?.close(); events = null; };
/** Live updates from the PC: opened once signed in, reconnects automatically. */
export function openEvents() {
  if (!isPhone() || !sessionToken || events) return;
  events = new EventSource(`/events?s=${encodeURIComponent(sessionToken)}`);
  // The PC echoes this phone's own changes back; those already triggered a reload here.
  events.onmessage = () => { if (Date.now() - lastLocalChange > 1500) notifyDataChanged(); };
  events.onerror = () => { if (events?.readyState === EventSource.CLOSED) closeEvents(); };
}

export async function pairDevice(code: string, name: string): Promise<PairedDevice> {
  const res = await fetch('/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name }), cache: 'no-store', credentials: 'omit' });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error ?? 'Pairing failed');
  try { localStorage.setItem(DEVICE_KEY, JSON.stringify(j.data)); } catch { throw new Error('This browser blocks storage (private mode?) — use a normal tab to pair.'); }
  return j.data;
}

async function httpCall(method: string, params?: unknown): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const dev = getDevice();
  if (!dev) { window.dispatchEvent(new Event('antibiome:unpaired')); return { ok: false, error: 'This phone is not paired' }; }
  let res: Response;
  try {
    res = await fetch('/api', {
      method: 'POST', cache: 'no-store', credentials: 'omit',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': dev.deviceId, 'X-Device-Secret': dev.secret, ...(sessionToken ? { 'X-Session': sessionToken } : {}) },
      body: JSON.stringify({ method, params }),
    });
  } catch { return { ok: false, error: 'Cannot reach the PICU PC — check the Wi-Fi and that the app is running.' }; }
  const j = await res.json().catch(() => ({ ok: false, error: `The PC answered ${res.status}` }));
  if (j.error === 'DEVICE_NOT_PAIRED') { forgetDevice(); window.dispatchEvent(new Event('antibiome:unpaired')); return { ok: false, error: 'This phone is no longer paired' }; }
  if (j.session && j.session !== sessionToken) { closeEvents(); sessionToken = j.session; }
  return j;
}

export async function call<T = any>(method: string, params?: unknown): Promise<T> {
  // The PC's echo of this change can arrive before the response, so mark it as ours up front.
  if (!isRead(method)) lastLocalChange = Date.now();
  const res = window.antibiome ? await window.antibiome.call(method, params) : await httpCall(method, params);
  if (!res.ok) {
    if (res.error === 'SESSION_EXPIRED') { closeEvents(); window.dispatchEvent(new Event('antibiome:locked')); }
    throw new Error(res.error === 'SESSION_EXPIRED' ? 'Session locked — sign in again' : res.error);
  }
  if (!isRead(method)) { lastLocalChange = Date.now(); notifyDataChanged(); }
  return res.data as T;
}
