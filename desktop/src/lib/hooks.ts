import { useCallback, useEffect, useRef, useState } from 'react';
import { call, onDataChanged } from './api';

/** Load data from the API and reload automatically whenever any mutation succeeds. */
export function useApi<T>(method: string | null, params?: unknown) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify(params ?? null);
  const seq = useRef(0);
  const load = useCallback(() => {
    if (!method) return;
    const id = ++seq.current;
    setLoading(true);
    call<T>(method, params).then(d => { if (id === seq.current) { setData(d); setError(null); } })
      .catch(e => { if (id === seq.current) setError(e.message); })
      .finally(() => { if (id === seq.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, key]);
  useEffect(() => { load(); return onDataChanged(load); }, [load]);
  return { data, error, loading, reload: load };
}

/** Minimal hash router: '#/census', '#/patient/<id>' … */
export function useRoute(): [string, string[]] {
  const parse = () => { const parts = (window.location.hash.replace(/^#\/?/, '') || 'home').split('/'); return [parts[0], parts.slice(1)] as [string, string[]]; };
  const [route, setRoute] = useState(parse);
  useEffect(() => { const h = () => setRoute(parse()); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);
  return route;
}
export const go = (path: string) => { window.location.hash = `/${path}`; };

export function useHotkey(key: string, fn: () => void, opts: { ctrl?: boolean; enabled?: boolean } = {}) {
  useEffect(() => {
    if (opts.enabled === false) return;
    const h = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName);
      if (opts.ctrl ? (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === key : !typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === key) {
        e.preventDefault(); fn();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [key, fn, opts.ctrl, opts.enabled]);
}
