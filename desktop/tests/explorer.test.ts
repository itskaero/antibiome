import { beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../server/db';
import { createApi } from '../server/api';
import { seedDemo } from '../server/demo';
import { describeSpec, runCohort, validateSpec, type ExplorerField, type Row } from '../shared/explorer';

const fields: ExplorerField[] = [
  { id: 'dx', label: 'Diagnosis', group: 'A', kind: 'category', options: ['GBS', 'SEPSIS'] },
  { id: 'tx', label: 'Treatment', group: 'A', kind: 'set', options: ['IVIG', 'Steroid'] },
  { id: 'age', label: 'Age', group: 'A', kind: 'number', unit: 'months' },
  { id: 'died', label: 'Died', group: 'A', kind: 'boolean' },
  { id: 'los', label: 'LOS', group: 'A', kind: 'number', unit: 'd' },
];
const row = (o: Partial<Row>): Row => ({ _admitAt: '2026-03-01T10:00', ...o } as Row);

describe('spec validation (the AI gate)', () => {
  it('rejects unknown fields, wrong operators and bad values', () => {
    expect(() => validateSpec({ include: [{ field: 'nope', op: 'exists' }] }, fields)).toThrow('unknown field');
    expect(() => validateSpec({ include: [{ field: 'age', op: 'in', value: ['x'] }] }, fields)).toThrow('cannot be used');
    expect(() => validateSpec({ include: [{ field: 'dx', op: 'in', value: ['ASTHMA'] }] }, fields)).toThrow('no value');
    expect(() => validateSpec({ groupBy: 'age' }, fields)).toThrow('Group by');
    expect(() => validateSpec({ from: '1/2/2026' }, fields)).toThrow('date');
    expect(() => validateSpec({ regression: { outcome: 'died', covariates: [] } }, fields)).toThrow('exposure');
  });
  it('produces a readable description', () => {
    const s = validateSpec({ from: '2026-01-01', include: [{ field: 'dx', op: 'in', value: ['GBS'] }, { field: 'age', op: 'gte', value: 24 }], groupBy: 'tx', outcomes: ['died'] }, fields);
    expect(describeSpec(s, fields).join(' | ')).toBe('Admissions from 2026-01-01 to today | where Diagnosis is one of GBS AND Age ≥ 24 months | grouped by Treatment | outcomes: Died');
  });
});

describe('cohort execution', () => {
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => row({ dx: 'GBS', tx: ['IVIG'], age: 30 + i, died: i < 1, los: 10 + i })),
    ...Array.from({ length: 10 }, (_, i) => row({ dx: 'GBS', tx: ['Steroid'], age: 40 + i, died: i < 6, los: 20 + i })),
    row({ dx: 'GBS', age: 50, died: false }),
    row({ dx: 'SEPSIS', tx: ['IVIG'], age: 5, died: true }),
  ];
  it('filters, groups (keeping not-recorded separate), tests two groups and reports a risk ratio', () => {
    const r = runCohort(validateSpec({ include: [{ field: 'dx', op: 'in', value: ['GBS'] }], groupBy: 'tx', outcomes: ['died', 'los'] }, fields), fields, rows);
    expect(r.n).toBe(21);
    expect(r.groups.map(g => [g.label, g.n])).toEqual([['IVIG', 10], ['Steroid', 10], ['Not recorded', 1]]);
    const died = r.outcomes[0];
    expect(died.test?.name).toBe("Fisher's exact");
    expect(died.effect?.value).toBeCloseTo((1 / 10) / (6 / 10), 5);
    expect(r.outcomes[1].test?.name).toBe('Mann–Whitney U');
    expect(r.claim).toBe('ASSOCIATION');
    expect(r.steps.map(s => s.remaining)).toEqual([22, 21]);
  });
  it('orders yes/no groups as Yes vs No so effects read exposure vs reference', () => {
    const rows2 = [...Array.from({ length: 30 }, (_, i) => row({ x: false, died: i < 3 })), ...Array.from({ length: 10 }, (_, i) => row({ x: true, died: i < 5 }))];
    const f2: ExplorerField[] = [{ id: 'x', label: 'Exposed', group: 'A', kind: 'boolean' }, { id: 'died', label: 'Died', group: 'A', kind: 'boolean' }];
    const r = runCohort(validateSpec({ groupBy: 'x', outcomes: ['died'] }, f2), f2, rows2);
    expect(r.groups.map(g => g.label)).toEqual(['Yes', 'No']);
    expect(r.outcomes[0].effect?.value).toBeCloseTo(0.5 / 0.1, 5);
  });
  it('says which groups were tested when small groups are left out', () => {
    const extra = [...rows, row({ dx: 'GBS', tx: ['IVIG', 'Steroid'], died: false })];
    const r = runCohort(validateSpec({ include: [{ field: 'dx', op: 'in', value: ['GBS'] }], groupBy: 'tx', outcomes: ['died'] }, fields), fields, extra);
    expect(r.outcomes[0].test?.note).toBe('Tested IVIG vs Steroid only; groups with < 3 patients (IVIG + Steroid) are not tested');
  });
  it('refuses regression with too few events per variable', () => {
    const r = runCohort(validateSpec({ include: [{ field: 'dx', op: 'in', value: ['GBS'] }], groupBy: 'tx', outcomes: ['died'], regression: { outcome: 'died', covariates: ['age'] } }, fields), fields, rows);
    expect(r.regression?.refused).toMatch(/events per variable|per variable/);
  });
  it('is descriptive without a grouping', () => {
    const r = runCohort(validateSpec({ outcomes: ['died'], describe: ['age', 'tx'] }, fields), fields, rows);
    expect(r.claim).toBe('DESCRIPTIVE');
    expect(r.describe[0].numeric?.median).toBeGreaterThan(0);
    expect(r.describe[1].counts?.[0]).toMatchObject({ value: 'IVIG', n: 11 });
  });
});

describe('explorer over the real database', () => {
  let api: ReturnType<typeof createApi>;
  beforeAll(async () => {
    const db = openDatabase(':memory:');
    api = createApi(db);
    await api.call('auth.setup', { username: 'a', displayName: 'A', password: 'password1' });
    seedDemo(db, { months: 12 });
  });
  it('catalogue spans core, derived, PIM3 and module fields', async () => {
    const fields = await api.call('explorer.fields') as ExplorerField[];
    const ids = fields.map(f => f.id);
    expect(ids).toEqual(expect.arrayContaining(['primary_dx', 'pim3_risk', 'mv_required', 'died', 'antimicrobials', 'gbs.immunotherapy', 'sepsis.lactate_initial', 'sepsis.time_to_abx_min']));
  });
  it('answers a cross-module question with regression and saves it as a cohort', async () => {
    const spec = { include: [{ field: 'primary_dx', op: 'in', value: ['SEPSIS', 'SEPTIC_SHOCK'] }], groupBy: 'reserve_agent', outcomes: ['died', 'los_days'],
      describe: ['sepsis.source', 'pim3_risk'], regression: { outcome: 'died', covariates: ['pim3_risk'] } };
    const r = await api.call('explorer.run', { spec }) as any;
    expect(r.n).toBeGreaterThan(50);
    expect(r.description[1]).toContain('Primary diagnosis is one of Sepsis, Septic shock');
    expect(r.regression).toBeTruthy();
    expect(JSON.stringify(r)).not.toMatch(/\(demo\)|MR-\d/);
    const { id } = await api.call('cohorts.save', { name: 'Sepsis — reserve agents', spec }) as any;
    const list = await api.call('cohorts.list') as any[];
    expect(list.find(c => c.id === id)?.spec.groupBy).toBe('reserve_agent');
    await expect(api.call('cohorts.save', { name: 'bad', spec: { groupBy: 'nonexistent' } })).rejects.toThrow('unknown field');
  });
});
