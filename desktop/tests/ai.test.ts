import { beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../server/db';
import { createApi } from '../server/api';
import { seedDemo } from '../server/demo';
import { systemPrompt, toSpec, OUTPUT_SCHEMA, type RawTranslation, type Translator } from '../server/ai';
import { narrate, runCohort, validateSpec, type ExplorerField } from '../shared/explorer';

const raw = (spec: Partial<RawTranslation['spec']>, extra: Partial<RawTranslation> = {}): RawTranslation => ({
  answerable: true, reason: '', assumptions: ['Used primary diagnosis'],
  spec: { from: '', to: '', include: [], exclude: [], groupBy: '', outcomes: [], describe: [], ...spec }, ...extra,
});

describe('AI translation (network-free)', () => {
  let db: ReturnType<typeof openDatabase>;
  const calls: { system: string; user: string }[] = [];
  let script: RawTranslation[] = [];
  const fake: Translator = async a => { calls.push(a); return script.shift()!; };
  let api: ReturnType<typeof createApi>;
  beforeAll(async () => {
    db = openDatabase(':memory:');
    api = createApi(db, Date.now, { translator: fake });
    await api.call('auth.setup', { username: 'a', displayName: 'A', password: 'password1' });
    seedDemo(db, { months: 6 });
  });

  it('is off until an administrator enables it with a key', async () => {
    await expect(api.call('ai.ask', { question: 'How many pneumonia admissions?' })).rejects.toThrow('switched off');
    await expect(api.call('ai.configure', { enabled: true, apiKey: 'not-a-key' })).rejects.toThrow('Anthropic API key');
    await api.call('ai.configure', { enabled: true, apiKey: 'sk-ant-api03-' + 'x'.repeat(40) });
    expect(await api.call('ai.status')).toMatchObject({ enabled: true, configured: true });
  });

  it('blocks questions containing a recorded MRN or patient name — before anything is sent', async () => {
    const mrn = (db.prepare('SELECT mrn FROM patient_identifiers LIMIT 1').get() as any).mrn;
    const before = calls.length;
    await expect(api.call('ai.ask', { question: `What happened to ${mrn}?` })).rejects.toThrow('patient name or MRN');
    expect(calls.length).toBe(before);
  });

  it('translates, validates and describes; the prompt carries the catalogue but no patient data', async () => {
    script = [raw({ from: '2026-04-01', include: [{ field: 'primary_dx', op: 'in', values: ['PNEUMONIA', 'SEVERE_PNEUMONIA'] }], outcomes: ['mv_required', 'died'] })];
    const t = await api.call('ai.ask', { question: 'Pneumonia admissions since April — how many were ventilated and how many died?' }) as any;
    expect(t.description.join(' ')).toContain('Primary diagnosis is one of Pneumonia, Severe pneumonia');
    expect(t.assumptions).toEqual(['Used primary diagnosis']);
    const sys = calls[calls.length - 1].system;
    expect(sys).toContain('primary_dx');
    expect(sys).toContain('gbs.immunotherapy');
    expect(sys).not.toMatch(/\(demo\)|MR-\d/);
    const r = await api.call('explorer.run', { spec: t.spec, source: 'ai' }) as any;
    expect(r.narrative[0]).toMatch(/admissions? matched/);
  });

  it('asks the model once to repair an invalid query, then gives up clearly', async () => {
    script = [raw({ include: [{ field: 'diagnosis', op: 'in', values: ['GBS'] }] }), raw({ include: [{ field: 'primary_dx', op: 'in', values: ['GBS'] }] })];
    const t = await api.call('ai.ask', { question: 'How many GBS patients?' }) as any;
    expect(t.spec.include[0].field).toBe('primary_dx');
    expect(calls[calls.length - 1].user).toContain('rejected by the validator');
    script = [raw({ groupBy: 'age_months' }), raw({ groupBy: 'age_months' })];
    await expect(api.call('ai.ask', { question: 'Compare by exact age' })).rejects.toThrow('invalid');
  });

  it('passes on "not answerable" reasons (e.g. individual treatment advice)', async () => {
    script = [raw({}, { answerable: false, reason: 'This asks for treatment advice for an individual patient.' })];
    await expect(api.call('ai.ask', { question: 'Should I give meropenem to the child in bed 4?' })).rejects.toThrow('treatment advice');
  });
});

describe('helpers', () => {
  const fields: ExplorerField[] = [
    { id: 'age', label: 'Age', group: 'A', kind: 'number', unit: 'months' },
    { id: 'died', label: 'Died', group: 'A', kind: 'boolean' },
    { id: 'dx', label: 'Dx', group: 'A', kind: 'category', options: ['GBS'] },
  ];
  it('maps flat conditions to typed ones', () => {
    const s = toSpec(raw({ include: [{ field: 'age', op: 'between', values: ['12', '60'] }, { field: 'died', op: 'is_true', values: [] }] }).spec, fields);
    expect(s.include).toEqual([{ field: 'age', op: 'between', value: [12, 60] }, { field: 'died', op: 'is_true' }]);
  });
  it('the output schema is strict', () => {
    expect(OUTPUT_SCHEMA.additionalProperties).toBe(false);
    expect(systemPrompt(fields)).toContain('- age [number, months] Age.');
  });
  it('narrative reports only computed numbers and labels associations', () => {
    const rows = [...Array.from({ length: 10 }, (_, i) => ({ _admitAt: '2026-01-01', dx: 'GBS', died: i < 1 })), ...Array.from({ length: 10 }, (_, i) => ({ _admitAt: '2026-01-01', dx: 'GBS', died: i < 8 }))]
      .map((r, i) => ({ ...r, grp: i < 10 ? 'A' : 'B' }));
    const f2 = [...fields, { id: 'grp', label: 'Group', group: 'A', kind: 'category' as const, options: ['A', 'B'] }];
    const n = narrate(runCohort(validateSpec({ groupBy: 'grp', outcomes: ['died'] }, f2), f2, rows as any));
    expect(n[0]).toBe('20 admissions matched (of 20 in the date range).');
    expect(n[1]).toContain('A 1/10 (10%); B 8/10 (80%)');
    expect(n[1]).toContain('not evidence of cause');
  });
});
