// Renderer-side API client. The only door to data is the preload bridge.
declare global {
  interface Window { antibiome?: { call: (method: string, params?: unknown) => Promise<{ ok: boolean; data?: unknown; error?: string }> } }
}

const listeners = new Set<() => void>();
/** Subscribe to "data changed" — every successful mutation notifies all views to reload. */
export const onDataChanged = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const notifyDataChanged = () => listeners.forEach(fn => fn());

const READ_PREFIXES = ['auth.status', 'census.list', 'patient.lookup', 'admission.get', 'culture.list', 'micro.summary', 'dashboard.get',
  'stewardship.get', 'quality.list', 'activity.list', 'recent.list', 'users.list', 'settings.get', 'desktop.info', 'export.deidentified'];

export async function call<T = any>(method: string, params?: unknown): Promise<T> {
  if (!window.antibiome) throw new Error('Antibiome must be run as the desktop app.');
  const res = await window.antibiome.call(method, params);
  if (!res.ok) {
    if (res.error === 'SESSION_EXPIRED') window.dispatchEvent(new Event('antibiome:locked'));
    throw new Error(res.error === 'SESSION_EXPIRED' ? 'Session locked — sign in again' : res.error);
  }
  if (!READ_PREFIXES.includes(method)) notifyDataChanged();
  return res.data as T;
}
