import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../server/db';
import { createApi, loadDataset } from '../server/api';
import { seedDemo } from '../server/demo';
import { importLegacy, parseLegacy, unitFromWard } from '../server/legacy';
import { nowLocal, toLocal } from '../shared/time';

const setup = async () => {
  const db = openDatabase(':memory:');
  const api = createApi(db);
  await api.call('auth.setup', { username: 'admin', displayName: 'Dr Admin', password: 'correct horse', unitName: 'PICU', beds: 10 });
  return { db, api };
};
const hoursAgo = (h: number) => toLocal(new Date(Date.now() - h * 3_600_000));

describe('auth & roles', () => {
  it('requires setup once, then login', async () => {
    const { api } = await setup();
    await expect(api.call('auth.setup', { username: 'x', displayName: 'x', password: '12345678' })).rejects.toThrow('Already set up');
    await api.call('auth.logout', {});
    await expect(api.call('census.list', {})).rejects.toThrow('SESSION_EXPIRED');
    await expect(api.call('auth.login', { username: 'admin', password: 'wrong' })).rejects.toThrow('Incorrect');
    await api.call('auth.login', { username: 'ADMIN', password: 'correct horse' });
    expect(api.session.user?.role).toBe('admin');
  });
  it('researchers cannot see the census or identifiers; viewers cannot write', async () => {
    const { api } = await setup();
    await api.call('users.create', { username: 'res', displayName: 'Res', role: 'researcher', password: 'password1' });
    await api.call('users.create', { username: 'view', displayName: 'View', role: 'viewer', password: 'password1' });
    await api.call('auth.login', { username: 'res', password: 'password1' });
    await expect(api.call('census.list', {})).rejects.toThrow('role');
    await api.call('auth.login', { username: 'view', password: 'password1' });
    const census = await api.call('census.list', {}) as any;
    expect(census.showIdentifiers).toBe(false);
    await expect(api.call('admission.create', {})).rejects.toThrow('role');
  });
  it('audit log is append-only at the database level', async () => {
    const { db } = await setup();
    expect(() => db.exec('DELETE FROM audit_log')).toThrow(/append-only/);
    expect(() => db.exec("UPDATE audit_log SET summary = 'x'")).toThrow(/append-only/);
  });
});

describe('admission lifecycle', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { ctx = await setup(); });

  const admit = (o: Record<string, unknown> = {}) => ctx.api.call('admission.create', {
    mrn: 'MR-1', name: 'Test Child', sex: 'F', ageMonths: 30, weightKg: 12.5, admitAt: hoursAgo(30), source: 'ED',
    primaryDx: 'PNEUMONIA', secondaryDx: ['SAM'], arrivalSupport: 'HFNC', antimicrobials: ['Ceftriaxone'], ...o,
  }) as Promise<{ id: string }>;

  it('validates required fields', async () => {
    await expect(admit({ primaryDx: '' })).rejects.toThrow('Primary diagnosis');
    await expect(admit({ ageMonths: 400 })).rejects.toThrow('Age');
    await expect(admit({ admitAt: toLocal(new Date(Date.now() + 86_400_000)) })).rejects.toThrow('future');
  });

  it('admits, escalates, reconciles, discharges and closes every open episode', async () => {
    const { id } = await admit();
    await expect(admit()).rejects.toThrow('open admission');
    await ctx.api.call('resp.set', { admissionId: id, level: 'MV', at: hoursAgo(20) });
    await ctx.api.call('drug.toggle', { admissionId: id, kind: 'vaso', drug: 'Adrenaline', on: true, at: hoursAgo(19) });
    const r = await ctx.api.call('reconcile.apply', { at: hoursAgo(5), rows: [{ admissionId: id, resp: 'NIV', vaso: [], abx: ['Ceftriaxone', 'Vancomycin'] }] }) as any;
    expect(r.changes).toBe(3); // MV→NIV, stop adrenaline, start vancomycin

    const census = await ctx.api.call('census.list', {}) as any;
    expect(census.rows).toHaveLength(1);
    expect(census.rows[0].resp.level).toBe('NIV');
    expect(census.rows[0].abx.map((a: any) => a.drug).sort()).toEqual(['Ceftriaxone', 'Vancomycin']);
    expect(census.rows[0].name).toBe('Test Child');

    await ctx.api.call('admission.discharge', { id, at: hoursAgo(1), disposition: 'Ward' });
    const ds = loadDataset(ctx.db);
    expect(ds.episodes.every(e => e.endAt)).toBe(true);
    const detail = await ctx.api.call('admission.get', { id }) as any;
    expect(detail.peakSupport).toBe('MV');
    // The only warning is the pneumonia module's required fields, which this test never fills in.
    expect(detail.issues.map((i: any) => i.rule)).toEqual(['moduleIncomplete']);

    // Readmission of the same MRN re-uses the pseudonymous patient.
    const second = await admit({ admitAt: nowLocal() });
    const ds2 = loadDataset(ctx.db);
    expect(new Set(ds2.admissions.map(a => a.patientId)).size).toBe(1);
    expect(second.id).not.toBe(id);
  });

  it('keeps the analytics dataset free of identifiers', async () => {
    await admit();
    const json = JSON.stringify(loadDataset(ctx.db));
    expect(json).not.toContain('Test Child');
    expect(json).not.toContain('MR-1');
  });

  it('links cultures to the admission and patient', async () => {
    const { id } = await admit();
    await ctx.api.call('culture.save', { admissionId: id, collectedAt: nowLocal().slice(0, 10), specimen: 'Blood', organism: 'Klebsiella pneumoniae',
      antibiotics: [{ name: 'Ceftriaxone', result: 'R' }, { name: 'Meropenem', result: 'R' }, { name: 'Amikacin', result: 'R' }] });
    const list = await ctx.api.call('culture.list', {}) as any[];
    expect(list[0]).toMatchObject({ mdr: true, admissionId: id, patientLabel: 'Test Child' });
  });

  it('de-identified export has no names, MRNs or dates', async () => {
    await admit();
    const { csv } = await ctx.api.call('export.deidentified', {}) as any;
    expect(csv).not.toMatch(/Test Child|MR-1|\d{4}-\d{2}-\d{2}T/);
    expect(csv.split('\n')[1]).toMatch(/^S0001,1,/);
  });
});

describe('demo data & dashboard', () => {
  it('seeds a realistic dataset and builds the dashboard without errors', async () => {
    const { db, api } = await setup();
    const n = seedDemo(db, { months: 6 });
    expect(n).toBeGreaterThan(300);
    const dash = await api.call('dashboard.get', {}) as any;
    expect(dash.series).toHaveLength(12);
    expect(dash.census.now).toBeGreaterThan(0);
    expect(dash.census.now).toBeLessThanOrEqual(14);
    expect(dash.current.topDx.length).toBeGreaterThan(3);
    const micro = await api.call('micro.summary', { firstIsolateOnly: true }) as any;
    expect(micro.antibiogram.rows.length).toBeGreaterThan(3);
  });
});

describe('legacy Antibiome import', () => {
  it('parses the original CSV export and maps ward → unit', async () => {
    const { db } = await setup();
    const csv = 'Date,Patient Name,Age Group,Organism,Specimen,MDR,Ward,Antibiotics\n' +
      '2026-04-14,Baby Doe,Neonate,Klebsiella pneumoniae,Blood,Yes,NICU Bed 3,Meropenem:S | Gentamicin:R\n' +
      '2026-04-15,"Doe, Baby",Neonate,Escherichia coli,Urine,No,NICU,Ampicillin:R\n';
    const res = importLegacy(db, parseLegacy(csv), 1);
    expect(res).toMatchObject({ imported: 2, skipped: 0 });
    expect(importLegacy(db, parseLegacy(csv), 1).skipped).toBe(2);
    expect(unitFromWard('NICU Bed 3')).toBe('NICU');
    const ds = loadDataset(db);
    expect(ds.cultures.find(c => c.organism === 'Klebsiella pneumoniae')?.antibiotics).toHaveLength(2);
  });
  it('parses the JSON (localStorage/Firestore) shape', () => {
    const rows = parseLegacy(JSON.stringify([{ date: '2026-04-14', organism: 'Escherichia coli', specimen: 'Blood', ward: 'NICU', antibiotics: [{ name: 'Meropenem', result: 'S' }] }]));
    expect(rows[0].antibiotics?.[0].name).toBe('Meropenem');
  });
});
