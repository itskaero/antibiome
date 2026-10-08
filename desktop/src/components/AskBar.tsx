// "Ask a question" — natural language → proposed cohort query. Nothing runs until the user confirms;
// the interpretation and every assumption are shown first. Results are computed locally.
import { useState } from 'react';
import { Check, ListChecks, Pencil, Sparkles, X } from 'lucide-react';
import { call } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { Button, ErrorNote } from '@/components/ui';
import type { CohortSpec } from '@shared/explorer';

interface Translation { spec: CohortSpec; description: string[]; assumptions: string[] }
const EXAMPLES = [
  'How many pneumonia patients were admitted in the last 6 months, and how many needed ventilation?',
  'Among culture-positive sepsis patients, which organisms were isolated?',
  'Compare outcomes between IVIG and methylprednisolone in GBS',
  'Mortality in septic shock by whether a Reserve antibiotic was given',
];

export function AskBar({ onRun, onEdit }: { onRun: (spec: CohortSpec) => void; onEdit: (spec: CohortSpec) => void }) {
  const status = useApi<{ enabled: boolean; configured: boolean; model: string; providerLabel: string }>('ai.status');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [t, setT] = useState<Translation | null>(null);
  if (!status.data?.enabled || !status.data.configured) return null;

  const ask = async (question = q) => {
    setErr(null); setT(null); setBusy(true);
    try { setT(await call<Translation>('ai.ask', { question })); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="card p-4">
      <form onSubmit={e => { e.preventDefault(); ask(); }} className="flex items-center gap-2">
        <Sparkles size={17} className="shrink-0 text-accent-ink" />
        <input className="field h-10 flex-1" value={q} onChange={e => setQ(e.target.value)} maxLength={600}
          placeholder="Ask in plain language — e.g. “How many sepsis patients received meropenem this year?”" />
        <Button variant="primary" type="submit" disabled={busy || q.trim().length < 5}>{busy ? 'Reading…' : 'Ask'}</Button>
      </form>
      {!t && !err && !busy && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {EXAMPLES.map(x => <button key={x} onClick={() => { setQ(x); ask(x); }} className="rounded-full border border-line px-3 py-1 text-[12px] text-ink-3 hover:border-line-2 hover:text-ink">{x}</button>)}
        </div>
      )}
      <p className="mt-2 text-[11px] text-ink-3">Only your question and the list of field names are sent to the AI service ({status.data.providerLabel} · {status.data.model}) — no patient data. It proposes a query; you confirm it; numbers are calculated on this computer.</p>
      {err && <div className="mt-3"><ErrorNote text={err} /></div>}
      {t && (
        <div className="mt-4 rounded-2xl border border-accent/30 bg-accent-soft/30 p-4">
          <p className="mb-1.5 flex items-center gap-2 text-[12.5px] font-semibold text-accent-ink"><ListChecks size={14} />I understood your question as</p>
          <div className="text-[13px] leading-relaxed">{t.description.map((l, i) => <p key={i}>{l}</p>)}</div>
          {!!t.assumptions.length && (
            <div className="mt-3">
              <p className="text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">Check these assumptions</p>
              <ul className="mt-1 list-disc pl-5 text-[12.5px] text-ink-2">{t.assumptions.map(a => <li key={a}>{a}</li>)}</ul>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" size="sm" onClick={() => { onRun(t.spec); setT(null); }}><Check size={14} />Run this query</Button>
            <Button size="sm" onClick={() => { onEdit(t.spec); setT(null); }}><Pencil size={13} />Adjust in the builder</Button>
            <Button size="sm" variant="ghost" onClick={() => setT(null)}><X size={13} />Discard</Button>
          </div>
        </div>
      )}
    </div>
  );
}
