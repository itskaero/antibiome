import { afterEach, describe, expect, it } from 'vitest';
import { connect, type Socket } from 'node:net';
import { FrameReader, HEARTBEAT, decode, encodeTimeSync, headerSum, seal, TYPE, CLASS } from '../shared/monitor/protocol';
import { patientFrame, secondOfData, type SimPatient } from '../shared/monitor/simulator';
import { DEFAULT_RECEIVER, MonitorGateway, type ReceiverConfig } from '../server/monitorGateway';
import { createMonitorService, censusBedFor, loadBedMap, loadReceivers } from '../server/monitorService';
import { driverById } from '../shared/monitor/drivers';
import { openDatabase, setSetting } from '../server/db';

const hex = (s: string) => Uint8Array.from(s.trim().split(/\s+/).map(x => parseInt(x, 16)));
const toHex = (b: Uint8Array) => [...b].map(x => x.toString(16).padStart(2, '0')).join(' ');

describe('monitor protocol — bytes from the reference capture', () => {
  it('accepts a real status frame and checks its header checksum', () => {
    const frames = new FrameReader().push(hex('0d 00 04 47 a7 ff 05 02 03 55 55 aa aa f7 fd'));
    expect(frames).toHaveLength(1);
    expect(frames[0][0]).toBe(4); // bed 4
    expect(headerSum(4, 0x47, 13)).toBe(0xffa7);
  });

  it('reproduces the central station time-sync frame byte for byte', () => {
    // Sent by CMS.exe to bed 4 at 2026-11-08 13:43:45.
    expect(toHex(encodeTimeSync(new Date(2026, 10, 8, 13, 43, 45)))).toBe('11 00 2d 4f 72 ff 07 ea 0b 08 0d 2b 2d 55 aa 55 aa 98 fc');
    expect(toHex(HEARTBEAT)).toBe('02 00 13 34');
  });

  it('decodes SpO₂, pulse rate and their alarm limits from a pleth frame', () => {
    const body = new Uint8Array(6 + 278);
    body.set([4, CLASS.data, 0, 0, TYPE.pleth, 1]);
    body.fill(0x40, 6, 6 + 256);
    body.set(hex('62 00 74 00 64 00 5a 00 01 00 a0 00 4b 00 01 00 00 00 01 02'), 6 + 256); // as captured: SpO₂ 98, PR 116
    const d = decode(new FrameReader().push(seal(body))[0]);
    expect(d.kind).toBe('pleth');
    if (d.kind !== 'pleth') return;
    expect(d.spo2).toMatchObject({ value: 98, high: 100, low: 90, alarmOn: true, confidence: 'verified' });
    expect(d.pr).toMatchObject({ value: 116, high: 160, low: 75 });
  });

  it('treats -100 and an unplugged temperature probe as "no reading"', () => {
    const [, pleth, , temp] = secondOfData({ bed: 9, name: 'X', hr: 100, spo2: 97, temp: null }, 0, { probeOff: true });
    const p = decode(pleth.subarray(2)), t = decode(temp.subarray(2));
    expect(p.kind === 'pleth' && p.spo2.value).toBeNull();
    expect(p.kind === 'pleth' && p.probeOff).toBe(true);
    expect(t.kind === 'temp' && t.t1.value).toBeNull();
  });
});

describe('monitor protocol — stream handling', () => {
  const sim = { bed: 7, name: 'TEST CHILD', patientId: 'T-001', birthDate: '2022/03/04', hr: 132, spo2: 96, temp: 37.8, nibp: [98, 60, 73] as [number, number, number] };
  const stream = () => { const fs = [patientFrame(sim, new Date(2026, 0, 2)), ...secondOfData(sim, 0)]; const all = new Uint8Array(fs.reduce((n, f) => n + f.length, 0)); let o = 0; fs.forEach(f => { all.set(f, o); o += f.length; }); return all; };

  it('re-assembles frames split at arbitrary points and decodes every type', () => {
    const data = stream(), r = new FrameReader(), out: ReturnType<typeof decode>[] = [];
    for (let i = 0; i < data.length; i += 7) r.push(data.subarray(i, i + 7)).forEach(f => out.push(decode(f)));
    expect(out.map(d => d.kind)).toEqual(['patient', 'ecg', 'pleth', 'nibp', 'temp']);
    expect(out[0]).toMatchObject({ bed: 7, patient: { name: 'TEST CHILD', patientId: 'T-001', admitDate: '2026-01-02', birthDate: '2022-03-04' } });
    expect(out[1]).toMatchObject({ kind: 'ecg', hr: { value: 132, confidence: 'provisional' }, leadsOff: false });
    expect(out[2]).toMatchObject({ kind: 'pleth', spo2: { value: 96 }, pr: { value: 132 } });
    expect(out[3]).toMatchObject({ kind: 'nibp', sys: { value: 98, high: 120, low: 70 }, dia: { value: 60, high: 70, low: 40 }, mean: { value: 73, high: 90, low: 50 } });
    expect(out[4]).toMatchObject({ kind: 'temp', t1: { value: 37.8, high: 39, low: 36 }, t2: { value: null } });
    expect(r.rejected).toBe(0);
  });

  it('resynchronises after garbage and rejects frames with a bad checksum', () => {
    const data = stream(), r = new FrameReader();
    const corrupt = data.slice(); corrupt[4] ^= 0xff; // break the patient frame's header checksum
    const kinds = r.push(Uint8Array.of(0xde, 0xad, 0xbe, 0xef, ...corrupt)).map(f => decode(f).kind);
    expect(kinds).not.toContain('patient');
    expect(kinds).toEqual(['ecg', 'pleth', 'nibp', 'temp']);
    expect(r.rejected).toBeGreaterThan(0);
  });
});

const rx = (over: Partial<ReceiverConfig>): ReceiverConfig => ({ ...DEFAULT_RECEIVER, host: '127.0.0.1', expectedAddress: undefined, ...over });
const ddtSecond = (bed: number, p: Partial<SimPatient> = {}) => [patientFrame({ bed, name: 'TEST', hr: 110, spo2: 95, temp: 37, ...p }), ...secondOfData({ bed, name: 'TEST', hr: 110, spo2: 95, temp: 37, ...p }, 0)];
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('monitor gateway', () => {
  let gw: MonitorGateway | null = null, other: MonitorGateway | null = null, clients: Socket[] = [];
  afterEach(async () => { clients.forEach(c => c.destroy()); clients = []; await gw?.dispose(); await other?.dispose(); gw = other = null; });
  const open = async (port: number) => { const c = connect(port, '127.0.0.1'); clients.push(c); await new Promise(r => c.once('connect', r)); return c; };

  it('accepts a monitor on base port + bed, decodes it, and sends the keep-alive', async () => {
    gw = new MonitorGateway();
    const st = await gw.configure([rx({ ports: { mode: 'base+bed', base: 42100, maxBed: 3 } })]);
    expect(st.receivers[0].listening).toEqual([42101, 42102, 42103]);
    const got: Buffer[] = [];
    const c = await open(42102);
    c.on('data', d => got.push(d));
    ddtSecond(2).forEach(f => c.write(f));
    await wait(1300);
    const bed = gw.snapshot().find(b => b.id === 'r1:2')!;
    expect(bed).toMatchObject({ bed: 2, receiverId: 'r1', connected: true, source: 'network', remote: '127.0.0.1', stale: false, patient: { name: 'TEST' } });
    expect(bed.values.spo2?.value).toBe(95);
    expect(bed.values.t1?.value).toBe(37);
    expect(toHex(Buffer.concat(got)).startsWith('02 00 13 34')).toBe(true);
  });

  it('reports ports that are already taken instead of failing', async () => {
    other = new MonitorGateway();
    await other.configure([rx({ ports: { mode: 'base+bed', base: 42200, maxBed: 2 } })]);
    gw = new MonitorGateway();
    const st = await gw.configure([rx({ ports: { mode: 'base+bed', base: 42200, maxBed: 3 } })]);
    expect(st.receivers[0].listening).toEqual([42203]);
    expect(st.receivers[0].failed.map(f => f.port)).toEqual([42201, 42202]);
    expect(st.receivers[0].failed[0].error).toMatch(/in use/);
  });

  it('runs several receivers with list and single-port plans; one port can carry many beds', async () => {
    gw = new MonitorGateway();
    await gw.configure([
      rx({ id: 'icu', name: 'ICU', ports: { mode: 'list', map: { '42301': 7 } } }),
      rx({ id: 'hdu', name: 'HDU', ports: { mode: 'single', port: 42302 } }),
    ]);
    const a = await open(42301);
    ddtSecond(99).forEach(f => a.write(f));          // the port says bed 7, whatever the frames claim
    const b = await open(42302);
    [...ddtSecond(3, { spo2: 91 }), ...ddtSecond(4, { spo2: 98 })].forEach(f => b.write(f)); // data names the bed
    await wait(400);
    const ids = gw.snapshot().map(x => `${x.id}=${x.values.spo2?.value}`);
    expect(ids).toEqual(['hdu:3=91', 'hdu:4=98', 'icu:7=95']);
  });

  it('decodes HL7 ORU messages over MLLP and acknowledges each one', async () => {
    gw = new MonitorGateway();
    await gw.configure([rx({ id: 'h', name: 'HL7', driver: 'hl7', ports: { mode: 'single', port: 42401 } })]);
    const c = await open(42401);
    const got: Buffer[] = []; c.on('data', d => got.push(d));
    const msg = ['MSH|^~\\&|MON|ICU|||20261108120000||ORU^R01|MSG42|P|2.3.1', 'PID|||T-9||DOE^JANE||20200105', 'PV1||I|PICU^^12',
      'OBX|1|NM|150456^MDC_PULS_OXIM_SAT_O2^MDC||93|%|90-100||||F', 'OBX|2|NM|8867-4^Heart rate^LN||141|/min|75-160||||F', 'OBX|3|NM|NIBP_S||88|mmHg||||F'].join('\r');
    c.write(Buffer.from(`\x0b${msg}\r\x1c\r`, 'latin1'));
    await wait(300);
    const bed = gw.snapshot()[0];
    expect(bed).toMatchObject({ id: 'h:12', patient: { name: 'JANE DOE', patientId: 'T-9', birthDate: '2020-01-05' } });
    expect(bed.values).toMatchObject({ spo2: { value: 93, low: 90, high: 100 }, hr: { value: 141 }, sys: { value: 88 } });
    expect(Buffer.concat(got).toString('latin1')).toMatch(/MSA\|AA\|MSG42/);
  });

  it('streams waveform samples, keeps per-minute trends and logs limit events', () => {
    let t = 0;
    gw = new MonitorGateway(() => t);
    const updates: any[] = [];
    gw.on('update', u => updates.push(u));
    const reader = driverById('ddt')!.createReader();
    const feed = (p: Partial<SimPatient>) => secondOfData({ bed: 5, name: 'T', hr: 90, spo2: 99, temp: 36.6, ...p }, 0).forEach(f => gw!.ingestEvents({ id: 'r1', name: 'R' }, 5, reader.push(f).events, 'network', '10.0.0.5'));
    feed({});
    (gw as any).publish();
    expect(updates[0].waves['r1:5'].pleth).toHaveLength(256);
    expect(updates[0].waves['r1:5'].ecg).toHaveLength(256);
    t = 60_000; (gw as any).rollMinute();
    expect(gw.trend('r1:5').spo2).toEqual([{ t: 60_000, min: 99, max: 99, mean: 99 }]);
    // SpO₂ below the monitor's low limit (90) for 12 s → one desaturation event; a 3 s dip is ignored.
    t = 70_000; feed({ spo2: 86 }); t = 73_000; feed({ spo2: 97 });
    t = 80_000; feed({ spo2: 85 }); t = 86_000; feed({ spo2: 84 }); t = 92_000; feed({ spo2: 96 });
    expect(gw.events('r1:5')).toEqual([{ kind: 'desat', param: 'spo2', start: 80_000, end: 92_000, worst: 84, limit: 90 }]);
  });
});

describe('monitor settings', () => {
  const svc = () => {
    const db = openDatabase(':memory:'), audits: string[] = [];
    const gateway = new MonitorGateway();
    return { db, gateway, audits, s: createMonitorService(db, gateway, { requireRole: () => {}, audit: a => audits.push(a), recordDir: '/tmp/x' }) };
  };
  it('turns the v0.2 base-port settings into one receiver', () => {
    const { db, gateway } = svc();
    setSetting(db, 'monitorBasePort', '600'); setSetting(db, 'monitorMaxBed', '20');
    expect(loadReceivers(db)).toEqual([expect.objectContaining({ id: 'r1', driver: 'ddt', ports: { mode: 'base+bed', base: 600, maxBed: 20 } })]);
    return gateway.dispose();
  });
  it('validates and saves receivers, and maps monitor beds to census beds', async () => {
    const { db, gateway, s, audits } = svc();
    await expect(s.routes['desktop.monitorSaveReceivers']({ receivers: [rx({ driver: 'nope' })] })).rejects.toThrow('Unknown monitor protocol');
    await expect(s.routes['desktop.monitorSaveReceivers']({ receivers: [rx({ ports: { mode: 'list', map: { '514': 4, '70000': 5 } } })] })).rejects.toThrow('70000');
    const st: any = await s.routes['desktop.monitorSaveReceivers']({ receivers: [rx({ name: ' Ward ', ports: { mode: 'single', port: 42501 }, enabled: true })] });
    expect(st.config[0].name).toBe('Ward');
    expect(st.running).toBe(false); // receiving itself is still off
    s.routes['desktop.monitorMapBed']({ id: 'r1:13', censusBed: '3' });
    expect(loadBedMap(db)).toEqual({ 'r1:13': '3' });
    expect(censusBedFor(loadBedMap(db), 'r1:13', 13, false)).toBe('3');
    expect(censusBedFor(loadBedMap(db), 'r1:4', 4, false)).toBe('4');
    expect(audits.join('\n')).toMatch(/mapped to census bed 3/);
    await gateway.dispose();
  });
});
