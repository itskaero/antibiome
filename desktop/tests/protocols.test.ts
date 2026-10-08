import { beforeAll, describe, expect, it } from 'vitest';
import { evaluateProtocol, evaluateRule, validateProtocol, type Protocol, type ProtocolCase } from '../shared/protocols';
import type { ExplorerField } from '../shared/explorer';
import { openDatabase } from '../server/db';
import { createApi } from '../server/api';
import { seedDemo } from '../server/demo';

const mk = (o: Omit<Partial<ProtocolCase>, 'row'> & { row?: Record<string, unknown> }): ProtocolCase => ({
  id: Math.random().toString(36), label: 'x', admitAt: '2026-05-03T10:00', ...o, row: { _admitAt: '2026-05-03T10:00', ...(o.row ?? {}) }, times: { admission: 0, ...(o.times ?? {}) },
});
const T0 = Date.UTC(2026, 4, 3, 10);

describe('rule evaluation', () => {
  const timeRule = { id: 'abx', label: 'abx ≤ 60', kind: 'time_to' as const, anchor: 't0', event: 'first_abx', withinMinutes: 60, target: 80, missing: 'exclude' as const };
  it('time windows: met, late, never given, anchor undocumented', () => {
    expect(evaluateRule(timeRule, mk({ times: { t0: T0, first_abx: T0 + 45 * 60_000 } }))).toBe('met');
    expect(evaluateRule(timeRule, mk({ times: { t0: T0, first_abx: T0 + 90 * 60_000 } }))).toBe('not_met');
    expect(evaluateRule(timeRule, mk({ times: { t0: T0, first_abx: null } }))).toBe('not_met');
    expect(evaluateRule(timeRule, mk({ times: { t0: null, first_abx: T0 } }))).toBe('not_recorded');
    expect(evaluateRule({ ...timeRule, missing: 'fail' }, mk({ times: { first_abx: T0 } }))).toBe('not_met');
  });
  it('implications only apply when the condition holds', () => {
    const r = { id: 'r', label: 'r', kind: 'implies' as const, if: { field: 'reserve', op: 'is_true' as const }, then: { field: 'pos', op: 'is_true' as const }, target: 90, missing: 'fail' as const };
    expect(evaluateRule(r, mk({ row: { reserve: false } }))).toBe('not_applicable');
    expect(evaluateRule(r, mk({ row: { reserve: true, pos: true } }))).toBe('met');
    expect(evaluateRule(r, mk({ row: { reserve: true } }))).toBe('not_met');
  });
  it('"does not include" treats an empty list as met', () => {
    const r = { id: 'r', label: 'r', kind: 'condition' as const, condition: { field: 'comp', op: 'excludes' as const, value: ['VAP'] }, target: 95, missing: 'exclude' as const };
    expect(evaluateRule(r, mk({ row: { comp: [] } }))).toBe('met');
    expect(evaluateRule(r, mk({ row: { comp: ['VAP'] } }))).toBe('not_met');
  });
});

describe('protocol evaluation', () => {
  const p: Protocol = {
    id: 'p', name: 'P', description: null, active: true, builtIn: false, eligibility: [{ field: 'dx', op: 'in', value: ['SEPSIS'] }],
    rules: [
      { id: 'lac', label: 'Lactate', kind: 'condition', condition: { field: 'lac', op: 'exists' }, target: 90, missing: 'fail' },
      { id: 'fl', label: 'Fluids', kind: 'condition', condition: { field: 'fl', op: 'is_true' }, target: 80, missing: 'exclude' },
    ],
  };
  it('computes per-rule and bundle adherence with unrecorded cases kept separate', () => {
    const cases = [
      mk({ row: { dx: 'SEPSIS', lac: 2, fl: true } }),
      mk({ row: { dx: 'SEPSIS', lac: 3, fl: false } }),
      mk({ row: { dx: 'SEPSIS', fl: true } }),
      mk({ row: { dx: 'SEPSIS', lac: 1 } }), // fluids not recorded
      mk({ row: { dx: 'ASTHMA', lac: 1, fl: true } }), // not eligible
    ];
    const r = evaluateProtocol(p, cases, ['2026-05']);
    expect(r.eligible).toBe(4);
    expect(r.rules[0]).toMatchObject({ met: 3, notMet: 1, pct: 75 });
    expect(r.rules[1]).toMatchObject({ met: 2, notMet: 1, notRecorded: 1 });
    expect(r.bundle).toMatchObject({ met: 1, evaluable: 3 }); // the 4th case is unknown for the bundle
    expect(r.monthly[0].eligible).toBe(4);
    expect(r.failures).toHaveLength(3);
  });
  it('validation rejects unknown fields and time points', () => {
    const fields: ExplorerField[] = [{ id: 'dx', label: 'Dx', group: 'g', kind: 'category', options: ['SEPSIS'] }];
    expect(() => validateProtocol({ name: 'Test', rules: [{ label: 'x', kind: 'condition', condition: { field: 'nope', op: 'exists' } }] }, fields, {})).toThrow('unknown field');
    expect(() => validateProtocol({ name: 'Test', rules: [{ label: 'x', kind: 'time_to', anchor: 'a', event: 'b', withinMinutes: 5 }] }, fields, { admission: 'A' })).toThrow('start point');
    expect(validateProtocol({ name: 'Test', rules: [{ label: 'Has dx', kind: 'condition', condition: { field: 'dx', op: 'exists' } }] }, fields, {}).rules[0].id).toBe('has_dx');
  });
});

describe('protocols on the real database', () => {
  let api: ReturnType<typeof createApi>;
  beforeAll(async () => {
    const db = openDatabase(':memory:');
    api = createApi(db);
    await api.call('auth.setup', { username: 'a', displayName: 'A', password: 'password1' });
    seedDemo(db, { months: 6 });
  });
  it('built-in protocols evaluate against demo data with sensible adherence', async () => {
    const results = await api.call('protocols.results') as any[];
    const sepsis = results.find(r => r.protocol.id === 'sepsis_bundle');
    expect(sepsis.eligible).toBeGreaterThan(30);
    const abx = sepsis.rules.find((r: any) => r.id === 'abx_60');
    expect(abx.met + abx.notMet).toBeGreaterThan(20);
    expect(abx.pct).toBeGreaterThan(0);
    expect(abx.pct).toBeLessThan(100);
    expect(results.find(r => r.protocol.id === 'severity_documented').rules[0].pct).toBeGreaterThan(70);
    const list = await api.call('protocols.list') as any;
    expect(list.protocols[0].ruleText.abx_60).toBe('First antimicrobial within 60 min of sepsis & septic shock: sepsis recognised (time zero)');
  });
  it('admins can create a custom protocol; researchers see no case lists', async () => {
    const { id } = await api.call('protocols.save', { name: 'Bronchiolitis — no antibiotics', eligibility: [{ field: 'primary_dx', op: 'in', value: ['BRONCHIOLITIS'] }],
      rules: [{ label: 'No antimicrobials', kind: 'condition', condition: { field: 'antimicrobials', op: 'missing' }, target: 90 }] }) as any;
    await api.call('users.create', { username: 'r', displayName: 'R', role: 'researcher', password: 'password1' });
    await api.call('auth.login', { username: 'r', password: 'password1' });
    const res = await api.call('protocols.results', { id }) as any[];
    expect(res[0].eligible).toBeGreaterThan(5);
    expect(res[0].failures).toEqual([]);
    await expect(api.call('protocols.save', { name: 'x' })).rejects.toThrow('role');
  });
});
