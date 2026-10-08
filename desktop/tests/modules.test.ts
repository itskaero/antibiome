import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../server/db';
import { createApi } from '../server/api';
import { seedDemo } from '../server/demo';
import { ensureBuiltInModules, loadModules } from '../server/modules';
import { compareGroups, isSemanticChange, isVisible, validateValue, type ModuleCase, type ModuleDef, type ParamDef } from '../shared/modules';
import { mannWhitney } from '../shared/stats';
import { toLocal } from '../shared/time';

const def = (o: Partial<ParamDef>): ParamDef => ({
  id: 'm.x', moduleId: 'm', key: 'x', label: 'X', type: 'number', unit: null, options: [], min: null, max: null, decimals: 1,
  capture: 'any', required: false, help: null, showIf: null, sort: 0, version: 1, introducedAt: '2026-01-01', retiredAt: null, ...o,
});
const hoursAgo = (h: number) => toLocal(new Date(Date.now() - h * 3_600_000));

async function setup() {
  const db = openDatabase(':memory:');
  const api = createApi(db);
  await api.call('auth.setup', { username: 'admin', displayName: 'Admin', password: 'password1', beds: 10 });
  return { db, api };
}
const admitGbs = (api: Awaited<ReturnType<typeof setup>>['api'], o: Record<string, unknown> = {}) => api.call('admission.create', {
  mrn: `MR-${Math.random()}`, sex: 'M', ageMonths: 96, weightKg: 25, admitAt: hoursAgo(48), source: 'ED', primaryDx: 'GBS', ...o,
}) as Promise<{ id: string }>;

describe('value validation', () => {
  it('enforces type, range and decimals', () => {
    expect(validateValue(def({ min: 0, max: 6, decimals: 0 }), '4')).toBe(4);
    expect(validateValue(def({ decimals: 1 }), 2.345)).toBe(2.3);
    expect(() => validateValue(def({ min: 0, max: 6 }), 9)).toThrow('≤ 6');
    expect(() => validateValue(def({}), 'abc')).toThrow('number');
    expect(validateValue(def({ type: 'multi', options: ['A', 'B', 'C'] }), ['C', 'A', 'A'])).toEqual(['A', 'C']);
    expect(() => validateValue(def({ type: 'choice', options: ['A'] }), 'Z')).toThrow('options');
    expect(() => validateValue(def({ type: 'datetime' }), '2026-01-01')).toThrow('time');
  });
  it('conditional visibility', () => {
    const d = def({ showIf: { param: 'therapy', includes: 'IVIG' } });
    expect(isVisible(d, { therapy: ['IVIG', 'Methylprednisolone'] })).toBe(true);
    expect(isVisible(d, { therapy: ['Methylprednisolone'] })).toBe(false);
    expect(isVisible(d, {})).toBe(false);
  });
  it('only meaning-changing edits are semantic', () => {
    const prev = def({ type: 'choice', options: ['A', 'B'] });
    expect(isSemanticChange(prev, { ...prev, options: ['A', 'B', 'C'] })).toBe(false); // adding an option
    expect(isSemanticChange(prev, { ...prev, options: ['A'] })).toBe(true); // removing one
    expect(isSemanticChange(def({ unit: 'mmol/L' }), { ...def({}), unit: 'mg/dL' })).toBe(true);
  });
});

describe('Mann–Whitney U', () => {
  it('matches the normal-approximation value for fully separated samples', () => {
    const r = mannWhitney([1, 2, 3], [4, 5, 6]);
    expect(r.U).toBe(0);
    expect(r.p).toBeCloseTo(0.081, 2);
    expect(mannWhitney([1, 2, 3], [1, 2, 3]).p).toBe(1);
  });
});

describe('module definitions', () => {
  it('seeds built-in modules once and never overwrites local edits', async () => {
    const { db, api } = await setup();
    expect(loadModules(db).map(m => m.id)).toEqual(expect.arrayContaining(['sepsis', 'pneumonia', 'gbs', 'dka']));
    await api.call('params.save', { id: 'gbs.bulbar', moduleId: 'gbs', label: 'Bulbar palsy (renamed)' });
    ensureBuiltInModules(db);
    expect(loadModules(db).find(m => m.id === 'gbs')!.params.find(p => p.key === 'bulbar')!.label).toBe('Bulbar palsy (renamed)');
  });

  it('admin can add a module and a field without code; new fields mark earlier admissions as not collected', async () => {
    const { db, api } = await setup();
    const older = await api.call('admission.create', { mrn: 'A1', sex: 'F', ageMonths: 20, admitAt: hoursAgo(24 * 40), source: 'ED', primaryDx: 'BRONCHIOLITIS' }) as any;
    const m = await api.call('modules.save', { label: 'Bronchiolitis', triggerDx: ['BRONCHIOLITIS'], derived: ['mv_required', 'los_days'] }) as any;
    await api.call('params.save', { moduleId: m.id, label: 'Apnoea episodes', type: 'boolean', capture: 'any', required: true });
    // Back-date the field so the 40-day-old admission predates it.
    db.prepare('UPDATE parameter_definitions SET introduced_at = ? WHERE module_id = ?').run(hoursAgo(24 * 10).slice(0, 10), m.id);
    const newer = await api.call('admission.create', { mrn: 'A2', sex: 'M', ageMonths: 8, admitAt: hoursAgo(2), source: 'ED', primaryDx: 'BRONCHIOLITIS',
      moduleValues: { [`${m.id}.apnoea_episodes`]: true } }) as any;

    const forOld = await api.call('values.forAdmission', { admissionId: older.id }) as any[];
    expect(forOld[0].notCollected).toEqual(['apnoea_episodes']); // not asked retrospectively (can be back-filled)
    expect(forOld[0].introducedAfterAdmission).toBe(true);
    const forNew = await api.call('values.forAdmission', { admissionId: newer.id }) as any[];
    expect(forNew[0].completion).toMatchObject({ required: 1, requiredFilled: 1 });

    const { csv, dictionary } = await api.call('export.deidentified', {}) as any;
    const [header, ...rows] = csv.split('\n');
    const col = header.split(',').indexOf(`${m.id}__apnoea_episodes`);
    expect(col).toBeGreaterThan(0);
    expect(rows.map((r: string) => r.split(',')[col])).toEqual(['NC', '1']);
    expect(dictionary).toContain(`${m.id}__apnoea_episodes`);
  });

  it('versions semantic edits once data exists and blocks type changes', async () => {
    const { api } = await setup();
    const { id } = await admitGbs(api);
    await api.call('params.save', { id: 'gbs.variant', moduleId: 'gbs', options: ['AIDP', 'AMAN', 'AMSAN', 'Miller Fisher', 'Not done / unknown', 'Overlap'] });
    let mods = await api.call('modules.list') as any;
    expect(mods.modules.find((m: any) => m.id === 'gbs').params.find((p: any) => p.key === 'variant').version).toBe(1); // no data yet
    await api.call('values.set', { admissionId: id, paramId: 'gbs.variant', value: 'AIDP' });
    const r = await api.call('params.save', { id: 'gbs.variant', moduleId: 'gbs', options: ['AIDP', 'AMAN', 'Other'] }) as any;
    expect(r).toMatchObject({ bumped: true, version: 2 });
    await expect(api.call('params.save', { id: 'gbs.variant', moduleId: 'gbs', type: 'text' })).rejects.toThrow('type cannot change');
    mods = await api.call('modules.list') as any;
    expect(mods.modules.find((m: any) => m.id === 'gbs').valueCounts['gbs.variant']).toBe(1);
  });
});

describe('module values', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { ctx = await setup(); });

  it('replaces single values (keeping history) and appends repeated values', async () => {
    const { id } = await admitGbs(ctx.api);
    await ctx.api.call('values.set', { admissionId: id, paramId: 'gbs.hughes_admission', value: 4 });
    await ctx.api.call('values.set', { admissionId: id, paramId: 'gbs.hughes_admission', value: 3 });
    await ctx.api.call('values.set', { admissionId: id, paramId: 'gbs.mrc_sum', value: 20, recordedAt: hoursAgo(30) });
    await ctx.api.call('values.set', { admissionId: id, paramId: 'gbs.mrc_sum', value: 28, recordedAt: hoursAgo(5) });
    await expect(ctx.api.call('values.set', { admissionId: id, paramId: 'gbs.mrc_sum', value: 30 })).rejects.toThrow('time is required');
    const [gbs] = await ctx.api.call('values.forAdmission', { admissionId: id }) as any[];
    expect(gbs.stored.filter((v: any) => v.paramId === 'gbs.hughes_admission').map((v: any) => v.value)).toEqual([3]);
    expect(gbs.stored.filter((v: any) => v.paramId === 'gbs.mrc_sum').map((v: any) => v.value)).toEqual([20, 28]);
    expect((ctx.db.prepare("SELECT COUNT(*) n FROM parameter_values WHERE param_id = 'gbs.hughes_admission'").get() as any).n).toBe(2);
  });

  it('an invalid module value rolls back the whole admission', async () => {
    await expect(admitGbs(ctx.api, { moduleValues: { 'gbs.hughes_admission': 9 } })).rejects.toThrow('≤ 6');
    expect((ctx.db.prepare('SELECT COUNT(*) n FROM admissions').get() as any).n).toBe(0);
  });

  it('flags discharged admissions with incomplete required module fields', async () => {
    const { id } = await admitGbs(ctx.api, { moduleValues: { 'gbs.hughes_admission': 4 } });
    await ctx.api.call('admission.discharge', { id, at: hoursAgo(1), disposition: 'Ward', moduleValues: { 'gbs.immunotherapy': ['IVIG'] } });
    const q = await ctx.api.call('quality.list') as any;
    const issue = q.issues.find((i: any) => i.rule === 'moduleIncomplete');
    expect(issue.message).toContain('Hughes grade at PICU discharge');
    expect(issue.message).not.toContain('Immunotherapy');
  });

  it('derives values from core data instead of re-asking', async () => {
    const { id } = await admitGbs(ctx.api, { arrivalSupport: 'MV', moduleValues: { 'gbs.hughes_admission': 5 } });
    await ctx.api.call('admission.discharge', { id, at: hoursAgo(1), disposition: 'Ward', moduleValues: { 'gbs.hughes_discharge': 3, 'gbs.immunotherapy': ['IVIG'] } });
    const [gbs] = await ctx.api.call('values.forAdmission', { admissionId: id }) as any[];
    expect(gbs.derived).toMatchObject({ mv_required: true, hughes_improvement: 2, died: false });
    expect(gbs.derived.mv_days).toBeCloseTo(47 / 24, 1);
  });
});

describe('research view', () => {
  it('compares outcomes by exposure with explicit claim level and caveats; researcher sees aggregates only', async () => {
    const { db, api } = await setup();
    seedDemo(db, { months: 15 });
    await api.call('users.create', { username: 'res', displayName: 'Res', role: 'researcher', password: 'password1' });
    await api.call('auth.login', { username: 'res', password: 'password1' });
    const r = await api.call('research.module', { moduleId: 'gbs', groupBy: 'immunotherapy' }) as any;
    expect(r.n).toBeGreaterThan(5);
    expect(r.comparison.groups.map((g: any) => g.key)).toEqual(expect.arrayContaining(['IVIG']));
    expect(['DESCRIPTIVE', 'ASSOCIATION']).toContain(r.comparison.claim);
    expect(r.comparison.caveats.join(' ')).toMatch(/not evidence that a treatment caused/);
    expect(JSON.stringify(r)).not.toMatch(/\(demo\)|MR-\d/); // no names or MRNs
    const hughes = r.variables.find((v: any) => v.id === 'hughes_admission');
    expect(hughes.numeric.median).toBeGreaterThanOrEqual(3);
    await expect(api.call('values.forAdmission', { admissionId: 'x' })).rejects.toThrow('role');
  });
});

describe('group comparison (pure)', () => {
  const mod: ModuleDef = {
    id: 'x', label: 'X', description: null, triggerDx: [], derived: ['died'], outcomes: ['died', 'score'], exposures: ['arm'], active: true, builtIn: false, introducedAt: '2000-01-01',
    params: [def({ id: 'x.arm', key: 'arm', type: 'choice', options: ['A', 'B'] }), def({ id: 'x.score', key: 'score', type: 'number' })],
  };
  const mk = (arm: string, died: boolean, score: number): ModuleCase => ({
    admission: { admitAt: '2026-03-01T10:00' } as any, values: { arm, score }, derived: { died },
  });
  it('runs Fisher / Mann–Whitney for exactly two groups and labels the result an association', () => {
    const cases = [...Array.from({ length: 8 }, (_, i) => mk('A', i < 1, 10 + i)), ...Array.from({ length: 8 }, (_, i) => mk('B', i < 6, 20 + i))];
    const c = compareGroups(mod, cases, 'arm', ['died', 'score'])!;
    expect(c.claim).toBe('ASSOCIATION');
    const died = c.outcomes.find(o => o.id === 'died')!;
    expect(died.cells.map(x => x.yes)).toEqual([1, 6]);
    expect(died.test?.name).toBe("Fisher's exact");
    expect(died.test!.p).toBeLessThan(0.05);
    expect(c.outcomes.find(o => o.id === 'score')!.test?.name).toMatch(/Mann–Whitney/);
  });
  it('stays descriptive with three or more groups', () => {
    const cases = [mk('A', false, 1), mk('A', false, 2), mk('A', true, 3), mk('B', false, 1), mk('B', true, 2), mk('B', true, 3)];
    (cases[0].values as any).arm = 'C'; // third group
    expect(compareGroups(mod, cases, 'arm', ['died'])!.claim).toBe('DESCRIPTIVE');
  });
});
