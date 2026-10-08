// Printable monthly PICU intelligence summary — same metric definitions as the dashboard.
import { useState } from 'react';
import { Download, FileBarChart2, Printer } from 'lucide-react';
import { call } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { delta, fmt1, fmtInt, fmtPct } from '@/lib/format';
import { Button, Field, Modal, PageHeader, useToast } from '@/components/ui';
import { RESP_LABEL } from '@shared/reference';
import { fmtMonth, shiftMonth, toLocal } from '@shared/time';
import type { MonthSummary, Notice } from '@shared/analytics';

export function Report() {
  const thisMonth = toLocal(new Date()).slice(0, 7);
  const [month, setMonth] = useState(shiftMonth(thisMonth, -1));
  const { data: d } = useApi<{ current: MonthSummary; previous: MonthSummary; changes: { notices: Notice[]; noise: Notice[] }; unitName: string; census: { beds: number } }>('dashboard.get', { month });
  const me = useApi<{ user: { role: string } }>('auth.status');
  const [exportOpen, setExportOpen] = useState(false);
  const canExport = ['admin', 'researcher'].includes(me.data?.user?.role ?? '');
  if (!d) return null;
  const c = d.current, p = d.previous;
  const pctLine = (cur: number | null | undefined, prev: number | null | undefined) => {
    const dl = delta(cur, prev);
    return dl == null ? '' : `${dl >= 0 ? '↑' : '↓'} ${Math.abs(Math.round(dl))}% vs ${fmtMonth(shiftMonth(month, -1))}`;
  };
  const drugs = Object.entries(c.dot.byDrug).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const orgs = Object.entries(c.micro.organisms).sort((a, b) => b[1] - a[1]).slice(0, 6);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon={<FileBarChart2 className="text-accent-ink" size={22} />} title="Monthly intelligence"
        subtitle="One page for unit leadership. Print or save as PDF."
        actions={<>
          <select className="field h-9 w-60" value={month} onChange={e => setMonth(e.target.value)} aria-label="Month">
            {Array.from({ length: 13 }, (_, i) => shiftMonth(thisMonth, -i)).map(m => <option key={m} value={m}>{fmtMonth(m, true)}{m === thisMonth ? ' (to date)' : ''}</option>)}
          </select>
          {canExport && <Button onClick={() => setExportOpen(true)}><Download size={15} />Research export</Button>}
          <Button variant="primary" onClick={() => window.print()}><Printer size={15} />Print</Button>
        </>} />

      <article className="card mx-auto w-full max-w-[860px] p-10 text-[13.5px] leading-relaxed">
        <header className="mb-8 border-b border-line pb-5">
          <p className="text-[11.5px] font-semibold tracking-[0.18em] text-accent-ink uppercase">{d.unitName} monthly intelligence</p>
          <h2 className="mt-1 text-[28px] font-semibold tracking-tight">{fmtMonth(month, true)}</h2>
          <p className="text-[12.5px] text-ink-3">{d.census.beds} beds · generated {new Date().toLocaleString('en-GB')} from the local Antibiome database{month === thisMonth ? ' · month to date' : ''}</p>
        </header>

        <Section title="Activity">
          <Big label="Admissions" value={fmtInt(c.admissions)} note={pctLine(c.admissions, p.admissions)} />
          <Big label="Patient-days" value={fmtInt(c.patientDays)} note={`${fmtPct(c.occupancyPct)} average occupancy`} />
          <Big label="Emergency" value={fmtInt(c.emergency)} note={`${fmtPct(c.admissions ? (c.emergency / c.admissions) * 100 : null)} of admissions`} />
        </Section>

        <Section title="Top diagnoses">
          <ol className="col-span-3 grid grid-cols-1 gap-1">
            {c.topDx.slice(0, 6).map((x, i) => (
              <li key={x.code} className="flex items-baseline justify-between border-b border-dashed border-line py-1">
                <span><span className="tnum mr-2 text-ink-3">{i + 1}.</span>{x.label}</span>
                <span className="tnum">{x.n} <span className="text-[12px] text-ink-3">· {x.mvPatients} ventilated · {x.deaths} died · median LOS {x.medianLos != null ? `${fmt1(x.medianLos)} d` : '—'}</span></span>
              </li>
            ))}
          </ol>
        </Section>

        <Section title="Respiratory & haemodynamic">
          <Big label="Mechanical ventilation" value={`${c.support.MV.patients} patients`} note={`${fmt1(c.support.MV.days)} ventilator-days · ${pctLine(c.support.MV.patients, p.support.MV.patients)}`} />
          <Big label={`${RESP_LABEL.NIV} / HFNC`} value={`${c.support.NIV.patients} / ${c.support.HFNC.patients}`} note={`${fmt1(c.support.NIV.days)} / ${fmt1(c.support.HFNC.days)} days`} />
          <Big label="Vasoactive support" value={`${c.vaso.patients} patients`} note={`${fmt1(c.vaso.days)} days`} />
        </Section>

        <Section title="Outcomes">
          <Big label="Crude mortality" value={fmtPct(c.mortalityPct, 1)} note={`${c.deaths} of ${c.discharges} discharges · not risk-adjusted`} />
          <Big label="Median PICU stay" value={c.los ? `${fmt1(c.los.median)} d` : '—'} note={c.los ? `IQR ${fmt1(c.los.q1)}–${fmt1(c.los.q3)} d` : ''} />
          <Big label="Discharges" value={fmtInt(c.discharges)} note={pctLine(c.discharges, p.discharges)} />
        </Section>

        <Section title="Antimicrobial stewardship">
          <Big label="Total use" value={`${fmtInt(c.dot.per1000)}`} note="DOT per 1,000 patient-days" />
          <div className="col-span-2">
            {drugs.map(([drug, dot]) => {
              const prev = p.dot.byDrug[drug] ?? 0;
              const r = c.patientDays ? (dot / c.patientDays) * 1000 : 0, pr = p.patientDays ? (prev / p.patientDays) * 1000 : 0;
              return <div key={drug} className="flex justify-between border-b border-dashed border-line py-1"><span>{drug}</span><span className="tnum">{fmtInt(r)} <span className="text-[12px] text-ink-3">{pctLine(r, pr)}</span></span></div>;
            })}
          </div>
        </Section>

        <Section title="Microbiology">
          <Big label="Cultures" value={fmtInt(c.micro.cultures)} note={`${c.micro.positives} positive (${fmtPct(c.micro.cultures ? (c.micro.positives / c.micro.cultures) * 100 : null)})`} />
          <Big label="MDR isolates" value={`${c.micro.mdr}`} note={`${fmtPct(c.micro.positives ? (c.micro.mdr / c.micro.positives) * 100 : null)} of positives (v1)`} />
          <div>{orgs.map(([o, n]) => <div key={o} className="flex justify-between text-[12.5px]"><i className="truncate pr-2">{o}</i><span className="tnum">{n}{c.micro.mdrByOrganism[o] ? <span className="text-crit-ink"> ({c.micro.mdrByOrganism[o]} MDR)</span> : ''}</span></div>)}</div>
        </Section>

        <Section title="What changed">
          <div className="col-span-3">
            {d.changes.notices.length ? d.changes.notices.map(n => (
              <p key={n.id} className="py-0.5">• <b>{n.title}</b> — {n.detail} <span className="text-[11.5px] text-ink-3">({n.test}{n.p != null ? `, p = ${n.p < 0.001 ? '<0.001' : n.p.toFixed(3)}` : ''})</span></p>
            )) : <p className="text-ink-3">No change met the threshold (≥ 20% and p &lt; 0.05).</p>}
            {!!d.changes.noise.length && <p className="mt-2 text-[12px] text-ink-3">Large but statistically uncertain: {d.changes.noise.slice(0, 6).map(n => n.title).join('; ')}.</p>}
          </div>
        </Section>

        <footer className="mt-8 border-t border-line pt-4 text-[11.5px] text-ink-3">
          Data completeness {c.completeness.pct}%{c.completeness.missing.filter(m => m.n).length ? ` (missing: ${c.completeness.missing.filter(m => m.n).map(m => `${m.field} ${m.n}`).join(', ')})` : ''}.
          Descriptive summary of routinely recorded data; differences between periods are associations and may reflect case-mix, chance or recording. They do not establish causes.
        </footer>
      </article>
      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mb-7 break-inside-avoid">
    <h3 className="mb-3 text-[11.5px] font-semibold tracking-[0.14em] text-ink-3 uppercase">{title}</h3>
    <div className="grid grid-cols-3 gap-5">{children}</div>
  </section>
);
const Big = ({ label, value, note }: { label: string; value: string; note?: string }) => (
  <div><p className="text-[12px] text-ink-3">{label}</p><p className="tnum text-[22px] font-semibold">{value}</p>{note && <p className="text-[12px] text-ink-3">{note}</p>}</div>
);

function ExportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const toast = useToast();
  const run = async () => {
    try {
      const { csv, dictionary, rows, columns } = await call<{ csv: string; dictionary: string; rows: number; columns: number }>('export.deidentified', { from: from || undefined, to: to || undefined });
      const stamp = new Date().toISOString().slice(0, 10);
      const path = await call('desktop.saveCsv', { csv, name: `antibiome-deidentified-${stamp}.csv` });
      if (!path) return;
      await call('desktop.saveCsv', { csv: dictionary, name: `antibiome-data-dictionary-${stamp}.csv` });
      toast(`Exported ${rows} admissions × ${columns} columns, with data dictionary`); onClose();
    } catch (e: any) { toast(e.message, 'crit'); }
  };
  return (
    <Modal open={open} onClose={onClose} title="De-identified research export" width={520}
      subtitle="One row per admission, core fields plus every module field (NA = not applicable, NC = not collected yet, blank = not recorded). No names, MRNs, dates of birth, exact dates or free text. A data dictionary is saved alongside. Logged in the audit trail."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={run}>Export CSV…</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Admitted from"><input type="date" className="field" value={from} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label="to"><input type="date" className="field" value={to} onChange={e => setTo(e.target.value)} /></Field>
      </div>
      <p className="mt-4 text-[12px] text-ink-3">Research use requires approval from your ethics committee. Small groups (&lt; 5 patients) can still be re-identifiable — avoid sharing rare-diagnosis subsets outside the approved team.</p>
    </Modal>
  );
}
