import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { DX_BY_CODE, searchDx } from '@shared/reference';
import { cx } from '@/lib/format';

const RECENT_KEY = 'antibiome-recent-dx';
export const recentDx = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };
export const rememberDx = (code: string) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([code, ...recentDx().filter(c => c !== code)].slice(0, 12))); } catch { /* ignore */ } };

/** Autocomplete over the diagnosis catalogue (label, synonyms, ICD-10), recents first. */
export function DxPicker({ value, onChange, placeholder = 'Type a diagnosis, synonym or ICD-10…', autoFocus, exclude = [] }: {
  value: string | null; onChange: (code: string | null) => void; placeholder?: string; autoFocus?: boolean; exclude?: string[];
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const results = useMemo(() => searchDx(q, recentDx()).filter(d => !exclude.includes(d.code)), [q, exclude]);
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);
  const pick = (code: string) => { onChange(code); setQ(''); setOpen(false); };
  const selected = value ? DX_BY_CODE[value] : null;

  return (
    <div ref={ref} className="relative">
      {selected && !open ? (
        <button type="button" onClick={() => setOpen(true)} className="field flex items-center justify-between text-left">
          <span className="truncate">{selected.label} <span className="ml-1 text-[11.5px] text-ink-3">{selected.icd10}</span></span>
          <X size={14} className="text-ink-3 hover:text-ink" onClick={e => { e.stopPropagation(); onChange(null); }} />
        </button>
      ) : (
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
          <input className="field pl-8" value={q} placeholder={placeholder} autoFocus={autoFocus || (open && !!selected)}
            onFocus={() => setOpen(true)} onChange={e => { setQ(e.target.value); setOpen(true); }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
              else if (e.key === 'Enter' && open && results[active]) { e.preventDefault(); pick(results[active].code); }
              else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
            }} />
        </div>
      )}
      {open && (
        <div className="scroll-thin absolute z-30 mt-1.5 max-h-72 w-full overflow-y-auto rounded-xl border border-line-2 bg-panel p-1 shadow-2xl">
          {!q && <div className="px-3 pt-1.5 pb-1 text-[10.5px] font-semibold tracking-wider text-ink-3 uppercase">Recent & common</div>}
          {results.map((d, i) => (
            <button key={d.code} type="button" onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); pick(d.code); }}
              className={cx('flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px]', i === active ? 'bg-panel-3 text-ink' : 'text-ink-2')}>
              <span>{d.label}</span>
              <span className="text-[11px] text-ink-3">{d.category} · {d.icd10}</span>
            </button>
          ))}
          {!results.length && <div className="px-3 py-4 text-[12.5px] text-ink-3">No match — choose “Other” and add a note.</div>}
        </div>
      )}
    </div>
  );
}
