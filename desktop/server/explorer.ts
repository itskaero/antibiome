// Builds the Explorer's field catalogue and one de-identified feature row per admission.
import type { DB } from './db';
import { loadDataset } from './api';
import { loadModules, loadValues, valuesByKey } from './modules';
import type { ExplorerField, Row } from '../shared/explorer';
import { DERIVED, computeDerived, moduleApplies } from '../shared/modules';
import { ADMISSION_SOURCES, DISPOSITIONS, DX_CATALOGUE, DX_BY_CODE, RESP_LABEL, RESP_LEVELS, awareGroup, COMPLICATIONS, PROCEDURES } from '../shared/reference';
import { isMDR } from '../shared/mdr';
import { peakSupport } from '../shared/analytics';

const AGE_BANDS = ['Neonate (< 1 month)', 'Infant (1–11 months)', 'Toddler (1–4 years)', 'Child (5–11 years)', 'Adolescent (12–18 years)'];
const ageBand = (m: number) => (m < 1 ? AGE_BANDS[0] : m < 12 ? AGE_BANDS[1] : m < 60 ? AGE_BANDS[2] : m < 144 ? AGE_BANDS[3] : AGE_BANDS[4]);
const GENERIC_DERIVED = Object.values(DERIVED).filter(d => !d.needs);

export function buildExplorer(db: DB, now: number): { fields: ExplorerField[]; rows: Row[] } {
  const ds = loadDataset(db);
  const modules = loadModules(db, { includeInactive: true });
  const values = loadValues(db);
  const dxLabels = Object.fromEntries(DX_CATALOGUE.map(d => [d.code, d.label]));
  const drugs = [...new Set(ds.episodes.filter(e => e.kind === 'abx').map(e => e.detail))].sort();
  const organisms = [...new Set(ds.cultures.map(c => c.organism).filter(Boolean) as string[])].sort();

  const fields: ExplorerField[] = [
    { id: 'age_months', label: 'Age', group: 'Patient', kind: 'number', unit: 'months' },
    { id: 'age_band', label: 'Age group', group: 'Patient', kind: 'category', options: AGE_BANDS },
    { id: 'sex', label: 'Sex', group: 'Patient', kind: 'category', options: ['M', 'F'], optionLabels: { M: 'Male', F: 'Female' } },
    { id: 'weight_kg', label: 'Weight', group: 'Patient', kind: 'number', unit: 'kg' },
    { id: 'malnutrition', label: 'Severe malnutrition', group: 'Patient', kind: 'boolean' },
    { id: 'chronic', label: 'Chronic condition', group: 'Patient', kind: 'boolean' },
    { id: 'source', label: 'Admitted from', group: 'Admission', kind: 'category', options: [...ADMISSION_SOURCES] },
    { id: 'admission_type', label: 'Admission type', group: 'Admission', kind: 'category', options: ['emergency', 'elective'] },
    { id: 'primary_dx', label: 'Primary diagnosis', group: 'Admission', kind: 'category', options: DX_CATALOGUE.map(d => d.code), optionLabels: dxLabels, description: 'Local diagnosis code (ICD-10 mapped)' },
    { id: 'dx_category', label: 'Diagnosis category', group: 'Admission', kind: 'category', options: [...new Set(DX_CATALOGUE.map(d => d.category))] },
    { id: 'any_dx', label: 'Any diagnosis (primary or secondary)', group: 'Admission', kind: 'set', options: DX_CATALOGUE.map(d => d.code), optionLabels: dxLabels },
    { id: 'shock_on_arrival', label: 'Shock on arrival', group: 'Severity', kind: 'boolean' },
    { id: 'coma_on_arrival', label: 'Coma (GCS ≤ 8) on arrival', group: 'Severity', kind: 'boolean' },
    { id: 'pim3_risk', label: 'PIM3 predicted mortality', group: 'Severity', kind: 'number', unit: '%' },
    { id: 'arrival_support', label: 'Respiratory support on arrival', group: 'Support', kind: 'category', options: [...RESP_LEVELS], optionLabels: RESP_LABEL },
    { id: 'peak_support', label: 'Highest respiratory support', group: 'Support', kind: 'category', options: [...RESP_LEVELS], optionLabels: RESP_LABEL },
    { id: 'antimicrobials', label: 'Antimicrobials received', group: 'Treatment', kind: 'set', options: drugs },
    { id: 'reserve_agent', label: 'Received a Reserve-group antibiotic', group: 'Treatment', kind: 'boolean' },
    { id: 'carbapenem', label: 'Received a carbapenem', group: 'Treatment', kind: 'boolean' },
    { id: 'procedures', label: 'Procedures', group: 'Treatment', kind: 'set', options: PROCEDURES },
    { id: 'organisms', label: 'Organisms isolated', group: 'Microbiology', kind: 'set', options: organisms },
    { id: 'mdr_isolate', label: 'Any MDR isolate', group: 'Microbiology', kind: 'boolean' },
    { id: 'complications', label: 'Complications', group: 'Outcome', kind: 'set', options: COMPLICATIONS },
    { id: 'disposition', label: 'Discharge outcome', group: 'Outcome', kind: 'category', options: [...DISPOSITIONS] },
    ...GENERIC_DERIVED.map(d => ({ id: d.id, label: d.label, group: d.id === 'died' || d.id === 'los_days' ? 'Outcome' : d.id.startsWith('culture') ? 'Microbiology' : 'Course', kind: d.kind, unit: d.unit, description: 'Derived from the core record' } as ExplorerField)),
  ];
  modules.forEach(m => {
    m.params.filter(p => p.type !== 'text' && p.type !== 'date' && p.type !== 'datetime').forEach(p => {
      const base = { group: `Module · ${m.label}`, description: `${m.label} module${p.capture === 'daily' ? ' (repeated; last value)' : ''}` };
      if (p.type === 'number') fields.push({ id: `${m.id}.${p.key}`, label: p.label, kind: 'number', unit: p.unit ?? undefined, ...base });
      else if (p.type === 'boolean') fields.push({ id: `${m.id}.${p.key}`, label: p.label, kind: 'boolean', ...base });
      else fields.push({ id: `${m.id}.${p.key}`, label: p.label, kind: p.type === 'multi' ? 'set' : 'category', options: p.options, ...base });
    });
    m.derived.filter(id => DERIVED[id]?.needs).forEach(id => fields.push({ id: `${m.id}.${id}`, label: DERIVED[id].label, group: `Module · ${m.label}`, kind: DERIVED[id].kind, unit: DERIVED[id].unit, description: 'Derived' }));
  });

  const rows: Row[] = ds.admissions.map(a => {
    const eps = ds.episodes.filter(e => e.admissionId === a.id);
    const evs = ds.events.filter(e => e.admissionId === a.id);
    const cults = ds.cultures.filter(c => c.admissionId === a.id);
    const abx = [...new Set(eps.filter(e => e.kind === 'abx').map(e => e.detail))];
    const row: Row = {
      _admitAt: a.admitAt,
      age_months: Math.round(a.ageMonths), age_band: ageBand(a.ageMonths), sex: a.sex, weight_kg: a.weightKg ?? undefined,
      malnutrition: a.malnutrition, chronic: a.chronicCondition, source: a.source, admission_type: a.admissionType,
      primary_dx: a.primaryDx, dx_category: DX_BY_CODE[a.primaryDx]?.category, any_dx: [a.primaryDx, ...a.secondaryDx],
      shock_on_arrival: a.shockOnArrival, coma_on_arrival: a.comaOnArrival,
      pim3_risk: a.pim3Risk != null ? Math.round(a.pim3Risk * 1000) / 10 : undefined,
      arrival_support: a.arrivalSupport, peak_support: peakSupport(a, eps),
      antimicrobials: abx, reserve_agent: abx.some(d => awareGroup(d) === 'Reserve'), carbapenem: abx.some(d => /penem/i.test(d)),
      procedures: [...new Set(evs.filter(e => e.type === 'procedure').map(e => e.label))],
      organisms: [...new Set(cults.map(c => c.organism).filter(Boolean) as string[])],
      mdr_isolate: cults.length ? cults.some(c => c.organism && isMDR(c)) : undefined,
      complications: [...new Set(evs.filter(e => e.type === 'complication').map(e => e.label))],
      disposition: a.disposition ?? undefined,
    };
    const ctxBase = { admission: a, episodes: eps, cultures: cults, now };
    GENERIC_DERIVED.forEach(d => { try { const v = d.fn({ ...ctxBase, values: {} }); if (v !== null) row[d.id] = v; } catch { /* leave missing */ } });
    modules.forEach(m => {
      if (!moduleApplies({ ...m, active: true }, a)) return;
      const stored = values[a.id] ?? [];
      const vk = valuesByKey(m, stored);
      m.params.forEach(p => {
        const v = vk[p.key];
        // Fields not collected for this admission simply stay missing — never "no".
        if (v !== undefined) row[`${m.id}.${p.key}`] = v as Row[string];
      });
      const der = computeDerived({ ...m, derived: m.derived.filter(id => DERIVED[id]?.needs) }, { ...ctxBase, values: vk });
      Object.entries(der).forEach(([id, v]) => { if (v !== null) row[`${m.id}.${id}`] = v; });
    });
    return row;
  });
  return { fields, rows };
}
