import { createContext, useCallback, useContext, useEffect, useState, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cx } from '@/lib/format';
import { RESP_LEVELS, RESP_LABEL, type RespLevel } from '@shared/reference';

// ── Buttons & chips ──────────────────────────────────────────

type Variant = 'primary' | 'ghost' | 'subtle' | 'danger';
export function Button({ variant = 'subtle', size = 'md', className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  const v = {
    primary: 'bg-accent text-white hover:brightness-110 shadow-[0_6px_16px_-8px_var(--accent)]',
    subtle: 'bg-panel-2 text-ink border border-line hover:bg-panel-3',
    ghost: 'text-ink-2 hover:bg-panel-2 hover:text-ink',
    danger: 'bg-crit-soft text-crit-ink border border-crit/30 hover:bg-crit/20',
  }[variant];
  return (
    <button className={cx('inline-flex items-center justify-center gap-2 rounded-xl font-medium whitespace-nowrap transition disabled:opacity-50 disabled:pointer-events-none',
      size === 'sm' ? 'h-8 px-3 text-[12.5px]' : 'h-10 px-4 text-[13.5px]', v, className)} {...rest}>
      {children}
    </button>
  );
}

export function Chip({ tone = 'neutral', children, className, dot }: { tone?: 'neutral' | 'accent' | 'good' | 'warn' | 'crit' | 'info'; children: ReactNode; className?: string; dot?: boolean }) {
  const t = {
    neutral: 'bg-panel-2 text-ink-2 border-line',
    accent: 'bg-accent-soft text-accent-ink border-transparent',
    good: 'bg-good-soft text-good-ink border-transparent',
    warn: 'bg-warn-soft text-warn-ink border-transparent',
    crit: 'bg-crit-soft text-crit-ink border-transparent',
    info: 'bg-info-soft text-info-ink border-transparent',
  }[tone];
  return (
    <span className={cx('inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-medium whitespace-nowrap', t, className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** One-tap choice chips (single or multi). */
export function ChoiceChips<T extends string>({ options, value, onChange, labels, multi, size = 'md' }: {
  options: readonly T[]; value: T | T[] | null; onChange: (v: any) => void; labels?: Partial<Record<T, string>>; multi?: boolean; size?: 'sm' | 'md';
}) {
  const isOn = (o: T) => (multi ? (value as T[]).includes(o) : value === o);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => (
        <button key={o} type="button"
          onClick={() => onChange(multi ? (isOn(o) ? (value as T[]).filter(x => x !== o) : [...(value as T[]), o]) : o)}
          className={cx('rounded-full border transition', size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3.5 text-[13px]',
            isOn(o) ? 'border-accent bg-accent-soft text-accent-ink font-medium' : 'border-line bg-panel-2 text-ink-2 hover:text-ink hover:border-line-2')}>
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  );
}

// ── Respiratory support ──────────────────────────────────────

export const RESP_TONE: Record<RespLevel, 'neutral' | 'info' | 'warn' | 'accent' | 'crit'> = { RA: 'neutral', O2: 'info', HFNC: 'info', NIV: 'warn', MV: 'crit' };
export function RespChip({ level }: { level: RespLevel }) {
  return <Chip tone={RESP_TONE[level]} dot={level !== 'RA'}>{RESP_LABEL[level]}</Chip>;
}
/** Segmented control for support level — the most frequent bedside change, one tap. */
export function RespSegment({ value, onChange, disabled }: { value: RespLevel; onChange: (l: RespLevel) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-panel-2 p-0.5">
      {RESP_LEVELS.map(l => (
        <button key={l} type="button" disabled={disabled} onClick={() => l !== value && onChange(l)} title={RESP_LABEL[l]}
          className={cx('h-6 rounded-md px-2 text-[11px] font-semibold transition',
            l === value ? (l === 'MV' ? 'bg-crit text-white' : l === 'NIV' ? 'bg-warn text-black' : l === 'RA' ? 'bg-panel-3 text-ink' : 'bg-[var(--series-1)] text-white') : 'text-ink-3 hover:text-ink')}>
          {l === 'RA' ? 'RA' : l === 'NIV' ? 'NIV' : l}
        </button>
      ))}
    </div>
  );
}

// ── Form bits ────────────────────────────────────────────────

export function Field({ label, hint, children, className, required }: { label: string; hint?: ReactNode; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={cx('flex flex-col gap-1.5', className)}>
      <span className="text-[11.5px] font-medium tracking-wide text-ink-3 uppercase">{label}{required && <span className="text-accent-ink"> *</span>}</span>
      {children}
      {hint && <span className="text-[11.5px] text-ink-3">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className={cx('inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[12.5px] transition',
        checked ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line bg-panel-2 text-ink-2 hover:text-ink')}>
      <span className={cx('relative h-3.5 w-6 rounded-full transition', checked ? 'bg-accent' : 'bg-panel-3')}>
        <span className={cx('absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all', checked ? 'left-3' : 'left-0.5')} />
      </span>
      {label}
    </button>
  );
}

// ── Modal ────────────────────────────────────────────────────

export function Modal({ open, onClose, title, subtitle, children, width = 640, footer }: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; width?: number; footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-0 backdrop-blur-[3px] sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div role="dialog" aria-modal className="card flex h-full w-full flex-col overflow-hidden max-sm:!max-w-none max-sm:rounded-none max-sm:border-0 sm:h-auto sm:max-h-[90vh]" style={{ maxWidth: width }}
            initial={{ y: 14, scale: 0.98, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} exit={{ y: 8, scale: 0.98, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }} onMouseDown={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-line px-4 pt-[max(env(safe-area-inset-top),16px)] pb-4 sm:px-6 sm:pt-4">
              <div>
                <h2 className="text-[17px] font-semibold">{title}</h2>
                {subtitle && <p className="mt-0.5 text-[12.5px] text-ink-3">{subtitle}</p>}
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-ink-3 hover:bg-panel-2 hover:text-ink" aria-label="Close"><X size={16} /></button>
            </div>
            <div className="scroll-thin flex-1 overflow-y-auto px-4 py-5 sm:px-6">{children}</div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-panel-2/40 px-4 py-3 pb-[max(env(safe-area-inset-bottom),12px)] sm:px-6 sm:pb-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Toasts ───────────────────────────────────────────────────

interface ToastItem { id: number; tone: 'good' | 'crit' | 'info'; text: string }
const ToastCtx = createContext<(text: string, tone?: ToastItem['tone']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: ToastItem['tone'] = 'good') => {
    const id = Date.now() + Math.random();
    setItems(s => [...s, { id, tone, text }]);
    setTimeout(() => setItems(s => s.filter(t => t.id !== id)), tone === 'crit' ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-20 z-[60] sm:right-6 sm:bottom-6 flex flex-col items-end gap-2">
        <AnimatePresence>
          {items.map(t => (
            <motion.div key={t.id} layout initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, x: 20 }}
              className="pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-full border border-line-2 bg-panel px-4 py-2.5 text-[13px] shadow-xl">
              {t.tone === 'good' ? <CheckCircle2 size={16} className="text-good-ink" /> : t.tone === 'crit' ? <AlertTriangle size={16} className="text-crit-ink" /> : <Info size={16} className="text-info-ink" />}
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

// ── Layout helpers ───────────────────────────────────────────

export function PageHeader({ icon, title, subtitle, chips, actions }: { icon?: ReactNode; title: string; subtitle?: ReactNode; chips?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2.5 text-[24px] font-semibold tracking-tight">{icon}{title}</h1>
        {subtitle && <p className="mt-1 text-[13.5px] text-ink-3">{subtitle}</p>}
        {chips && <div className="mt-3 flex flex-wrap items-center gap-2">{chips}</div>}
      </div>
      {actions && <div className="no-print flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardHeader({ title, info, right }: { title: ReactNode; info?: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h3 className="flex items-center gap-1.5 text-[14.5px] font-semibold whitespace-nowrap">
        {title}
        {info && <span title={info} className="cursor-help text-ink-3"><Info size={13} /></span>}
      </h3>
      {right}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {icon && <div className="mb-1 grid h-11 w-11 place-items-center rounded-2xl bg-panel-2 text-ink-3">{icon}</div>}
      <p className="text-[14px] font-medium">{title}</p>
      {children && <div className="max-w-sm text-[12.5px] text-ink-3">{children}</div>}
    </div>
  );
}

export function ErrorNote({ text }: { text: string | null }) {
  if (!text) return null;
  return <div className="flex items-center gap-2 rounded-xl border border-crit/30 bg-crit-soft px-3 py-2 text-[12.5px] text-crit-ink"><AlertTriangle size={14} />{text}</div>;
}

/** Segmented meter like the Orbit "Usage" bar. */
export function SegmentMeter({ pct, segments = 10, tone = 'accent' }: { pct: number; segments?: number; tone?: 'accent' | 'good' | 'warn' | 'crit' }) {
  const filled = Math.round((pct / 100) * segments);
  const color = { accent: 'bg-accent', good: 'bg-good', warn: 'bg-warn', crit: 'bg-crit' }[tone];
  return (
    <div className="flex gap-[3px]" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      {Array.from({ length: segments }, (_, i) => <span key={i} className={cx('h-3 w-[7px] rounded-[3px]', i < filled ? color : 'bg-panel-3')} />)}
    </div>
  );
}
