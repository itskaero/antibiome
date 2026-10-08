import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { call } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { cx } from '@/lib/format';
import { Button, ChoiceChips, ErrorNote, Field, Modal, Toggle, useToast } from '@/components/ui';
import { ALL_ANTIBIOTICS, ORGANISMS, SPECIMEN_TYPES, dxLabel } from '@shared/reference';
import { getOrganismGroup, isMDR, relevantResistantClasses } from '@shared/mdr';
import { toDateStr } from '@shared/time';
import type { CensusRow } from '@/pages/types';

// Panels mirror common local AST panels so a full result is a few taps.
const PANELS: Record<string, string[]> = {
  'Gram-negative': ['Ampicillin', 'Ceftriaxone', 'Ceftazidime', 'Cefepime', 'Piperacillin-Tazobactam', 'Meropenem', 'Amikacin', 'Gentamicin', 'Ciprofloxacin', 'Colistin', 'Trimethoprim-Sulfamethoxazole (Septran/Co-trimoxazole)'],
  'Gram-positive': ['Oxacillin', 'Vancomycin', 'Linezolid', 'Clindamycin', 'Erythromycin', 'Gentamicin', 'Ciprofloxacin', 'Trimethoprim-Sulfamethoxazole (Septran/Co-trimoxazole)'],
};

type Row = { name: string; result: 'S' | 'I' | 'R' | '' };

export function CultureForm({ open, onClose, admissionId, existing }: { open: boolean; onClose: () => void; admissionId?: string | null; existing?: any }) {
  const toast = useToast();
  const census = useApi<{ rows: CensusRow[] }>(open ? 'census.list' : null);
  const [adm, setAdm] = useState<string>('');
  const [date, setDate] = useState(toDateStr(new Date()));
  const [specimen, setSpecimen] = useState('Blood');
  const [noGrowth, setNoGrowth] = useState(false);
  const [organism, setOrganism] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setAdm(existing?.admissionId ?? admissionId ?? '');
    setDate(existing?.collectedAt?.slice(0, 10) ?? toDateStr(new Date()));
    setSpecimen(existing?.specimen ?? 'Blood');
    setNoGrowth(existing ? !existing.organism : false);
    setOrganism(existing?.organism ?? '');
    setRows(existing?.antibiotics?.map((a: any) => ({ ...a })) ?? []);
  }, [open, existing, admissionId]);

  useEffect(() => {
    if (!organism || rows.length || existing) return;
    const g = getOrganismGroup(organism);
    if (g === 'gram-negative') setRows(PANELS['Gram-negative'].map(name => ({ name, result: '' })));
    if (g === 'gram-positive') setRows(PANELS['Gram-positive'].map(name => ({ name, result: '' })));
  }, [organism, rows.length, existing]);

  const filled = rows.filter(r => r.name && r.result) as { name: string; result: 'S' | 'I' | 'R' }[];
  const preview = useMemo(() => ({ organism, antibiotics: filled }), [organism, filled]);
  const mdr = !noGrowth && organism && isMDR(preview);

  const save = async () => {
    setErr(null);
    if (!noGrowth && !organism) return setErr('Choose an organism, or mark as no growth');
    try {
      await call('culture.save', { id: existing?.id, admissionId: adm || null, collectedAt: date, specimen, organism: noGrowth ? null : organism, antibiotics: noGrowth ? [] : filled });
      toast(noGrowth ? 'No-growth culture recorded' : `${organism} recorded${mdr ? ' — flagged MDR' : ''}`);
      onClose();
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <Modal open={open} onClose={onClose} width={760} title={existing ? 'Edit culture' : 'Add culture result'} subtitle="Linked cultures feed the patient timeline, the antibiogram and stewardship metrics."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save culture</Button></>}>
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-[1.4fr_160px] gap-3">
          <Field label="Patient (admission)" hint="Leave unlinked for cultures from other units.">
            <select className="field" value={adm} onChange={e => setAdm(e.target.value)}>
              <option value="">Not linked to a PICU admission</option>
              {(census.data?.rows ?? []).map(r => <option key={r.admission.id} value={r.admission.id}>Bed {r.admission.bed ?? '—'} · {r.name ?? r.label} · {dxLabel(r.admission.primaryDx)}</option>)}
              {adm && !(census.data?.rows ?? []).some(r => r.admission.id === adm) && <option value={adm}>Current admission</option>}
            </select>
          </Field>
          <Field label="Collected"><input type="date" className="field" value={date} onChange={e => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Specimen"><ChoiceChips options={SPECIMEN_TYPES} value={specimen} onChange={setSpecimen} size="sm" /></Field>
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <Field label="Organism">
            <select className="field" value={organism} disabled={noGrowth} onChange={e => { setOrganism(e.target.value); if (!existing) setRows([]); }}>
              <option value="">Select organism…</option>
              {ORGANISMS.map(o => <option key={o}>{o}</option>)}
            </select>
          </Field>
          <Toggle checked={noGrowth} onChange={setNoGrowth} label="No growth" />
        </div>

        {!noGrowth && organism && (
          <div className="inset p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[12.5px] font-medium">Susceptibility (S / I / R)</span>
              <span className="flex items-center gap-2">
                {Object.keys(PANELS).map(p => <Button key={p} size="sm" variant="ghost" onClick={() => setRows(PANELS[p].map(name => ({ name, result: rows.find(r => r.name === name)?.result ?? '' })))}>{p} panel</Button>)}
                <Button size="sm" onClick={() => setRows([...rows, { name: '', result: '' }])}>+ Drug</Button>
              </span>
            </div>
            <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
              {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select className="field h-8 flex-1 text-[12.5px]" value={r.name} onChange={e => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}>
                    <option value="">Drug…</option>
                    {ALL_ANTIBIOTICS.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}
                  </select>
                  <div className="inline-flex rounded-lg border border-line bg-panel p-0.5">
                    {(['S', 'I', 'R'] as const).map(v => (
                      <button key={v} type="button" onClick={() => setRows(rows.map((x, j) => (j === i ? { ...x, result: x.result === v ? '' : v } : x)))}
                        className={cx('h-6 w-7 rounded-md text-[11.5px] font-bold', r.result === v ? (v === 'S' ? 'bg-good text-white' : v === 'I' ? 'bg-warn text-black' : 'bg-crit text-white') : 'text-ink-3 hover:text-ink')}>{v}</button>
                    ))}
                  </div>
                  <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="p-1 text-ink-3 hover:text-crit-ink" aria-label="Remove"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
            {mdr && <p className="mt-3 text-[12px] text-crit-ink">Meets MDR v1: non-susceptible in {relevantResistantClasses(preview).join(', ')}.</p>}
          </div>
        )}
        <ErrorNote text={err} />
      </div>
    </Modal>
  );
}
