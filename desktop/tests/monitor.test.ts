import { afterEach, describe, expect, it } from 'vitest';
import { connect, type Socket } from 'node:net';
import { FrameReader, HEARTBEAT, decode, encodeTimeSync, headerSum, seal, TYPE, CLASS } from '../shared/monitor/protocol';
import { patientFrame, secondOfData } from '../shared/monitor/simulator';
import { MonitorGateway } from '../server/monitorGateway';

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

describe('monitor gateway', () => {
  let gw: MonitorGateway | null = null, other: MonitorGateway | null = null, client: Socket | null = null;
  afterEach(async () => { client?.destroy(); await gw?.dispose(); await other?.dispose(); gw = other = client = null; });

  it('accepts a monitor on base port + bed, decodes it, and sends the keep-alive', async () => {
    gw = new MonitorGateway();
    const st = await gw.start({ basePort: 42100, maxBed: 3, host: '127.0.0.1' });
    expect(st.listening).toBe(3);
    const got: Buffer[] = [];
    client = connect(42102, '127.0.0.1');
    client.on('data', d => got.push(d));
    await new Promise(r => client!.once('connect', r));
    for (const f of [patientFrame({ bed: 2, name: 'TEST', hr: 110, spo2: 95, temp: 37 }), ...secondOfData({ bed: 2, name: 'TEST', hr: 110, spo2: 95, temp: 37 }, 0)]) client.write(f);
    await new Promise(r => setTimeout(r, 1300));
    const bed = gw.snapshot().find(b => b.bed === 2)!;
    expect(bed).toMatchObject({ connected: true, source: 'network', remote: '127.0.0.1', stale: false, patient: { name: 'TEST' } });
    expect(bed.values.spo2?.value).toBe(95);
    expect(bed.values.t1?.value).toBe(37);
    expect(toHex(Buffer.concat(got)).startsWith('02 00 13 34')).toBe(true);
  });

  it('reports ports that are already taken instead of failing', async () => {
    other = new MonitorGateway();
    await other.start({ basePort: 42200, maxBed: 2, host: '127.0.0.1' });
    gw = new MonitorGateway();
    const st = await gw.start({ basePort: 42200, maxBed: 3, host: '127.0.0.1' });
    expect(st.listening).toBe(1);
    expect(st.failed.map(f => f.port)).toEqual([42201, 42202]);
    expect(st.failed[0].error).toMatch(/in use/);
  });

  it('streams waveform samples and keeps per-minute trends', () => {
    let t = 0;
    gw = new MonitorGateway(() => t);
    const updates: any[] = [];
    gw.on('update', u => updates.push(u));
    for (const f of secondOfData({ bed: 5, name: 'T', hr: 90, spo2: 99, temp: 36.6 }, 0)) gw.ingest(5, f.subarray(2), 'network', '10.0.0.5');
    (gw as any).publish();
    expect(updates[0].waves[5].pleth).toHaveLength(256);
    expect(updates[0].waves[5].ecg).toHaveLength(256);
    t = 60_000; (gw as any).rollMinute();
    expect(gw.trend(5).spo2).toEqual([{ t: 60_000, min: 99, max: 99, mean: 99 }]);
  });
});
