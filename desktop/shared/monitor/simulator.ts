// Synthetic bedside monitor: produces frames in exactly the wire format of `protocol.ts`, for the
// demo mode and for tests (so no real patient data is ever needed in the repository).
import { CLASS, TYPE, WAVE_BASELINE, seal } from './protocol';

export interface SimPatient { bed: number; name: string; patientId?: string; birthDate?: string; hr: number; spo2: number; temp: number | null; nibp?: [number, number, number] | null; rr?: number }

const put16 = (b: Uint8Array, o: number, v: number) => { const x = v & 0xffff; b[o] = x & 0xff; b[o + 1] = x >> 8; };
const putF32 = (b: Uint8Array, o: number, v: number) => new DataView(b.buffer, b.byteOffset + o, 4).setFloat32(0, v, true);
const putStr = (b: Uint8Array, o: number, s: string, max: number) => { for (let i = 0; i < Math.min(s.length, max); i++) b[o + i] = s.charCodeAt(i) & 0x7f; };
const ymd = (d: Date) => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
const NO_TEMP = 6543.6, NO_INT = -100;

export function patientFrame(p: SimPatient, today = new Date()): Uint8Array {
  const b = new Uint8Array(237);
  b[0] = p.bed; b[1] = CLASS.patient; b[36] = p.bed;
  putStr(b, 37, p.name, 31);
  if (p.patientId) putStr(b, 69, p.patientId, 31);
  putStr(b, 101, ymd(today), 10);
  put16(b, 118, 1000);
  putStr(b, 122, p.birthDate ?? '2000/01/01', 10);
  putStr(b, 132, 'DDT', 3);
  return seal(b);
}

function dataBody(bed: number, type: number, seq: number, payloadLen: number) {
  const b = new Uint8Array(6 + payloadLen);
  b[0] = bed; b[1] = CLASS.data; b[4] = type; b[5] = seq;
  return b;
}

/** One second of data (ECG, pleth, NIBP, temperature) starting at time `t` seconds. */
export function secondOfData(p: SimPatient, t: number, opts: { probeOff?: boolean; leadsOff?: boolean } = {}): Uint8Array[] {
  const ecg = dataBody(p.bed, TYPE.ecg, 0, 981), e = ecg.subarray(6);
  const pleth = dataBody(p.bed, TYPE.pleth, 1, 278), q = pleth.subarray(6);
  const beat = 60 / p.hr;
  for (let i = 0; i < 256; i++) {
    const s = t + i / 256, ph = (s % beat) / beat;
    // ECG lead II: P wave, QRS spike, T wave around the 0x80 baseline.
    const ecgV = opts.leadsOff ? 0 : 6 * Math.exp(-(((ph - 0.12) / 0.025) ** 2)) + 70 * Math.exp(-(((ph - 0.3) / 0.008) ** 2)) - 12 * Math.exp(-(((ph - 0.32) / 0.01) ** 2)) + 14 * Math.exp(-(((ph - 0.55) / 0.05) ** 2));
    e[i] = clamp(WAVE_BASELINE.ecg + ecgV * 0.6); e[256 + i] = clamp(WAVE_BASELINE.ecg + ecgV); e[512 + i] = clamp(WAVE_BASELINE.ecg + ecgV * 0.4);
    // Pleth: systolic upstroke, dicrotic notch.
    const pl = opts.probeOff ? 0 : 52 * Math.exp(-(((ph - 0.25) / 0.09) ** 2)) + 18 * Math.exp(-(((ph - 0.55) / 0.1) ** 2));
    q[i] = opts.probeOff ? WAVE_BASELINE.pleth : clamp(WAVE_BASELINE.pleth / 2 + pl);
  }
  for (let i = 0; i < 128; i++) e[768 + i] = clamp(128 + 40 * Math.sin(2 * Math.PI * (t + i / 128) * ((p.rr ?? 24) / 60)));
  const et = e.subarray(896);
  put16(et, 0, opts.leadsOff ? NO_INT : Math.round(p.hr)); put16(et, 2, NO_INT);
  putF32(et, 4, 555.36); putF32(et, 8, 555.36); putF32(et, 12, -100); put16(et, 16, NO_INT);
  put16(et, 31, 160); put16(et, 33, 75); put16(et, 35, 1); put16(et, 37, 30); put16(et, 39, 8); put16(et, 41, 1);

  put16(q, 256, opts.probeOff ? NO_INT : Math.round(p.spo2)); put16(q, 258, opts.probeOff ? NO_INT : Math.round(p.hr));
  put16(q, 260, 100); put16(q, 262, 90); put16(q, 264, 1); put16(q, 266, 160); put16(q, 268, 75); put16(q, 270, 1);

  const nibp = dataBody(p.bed, TYPE.nibp, 2, 37), n = nibp.subarray(6);
  const [sys, dia, mean] = p.nibp ?? [NO_INT, NO_INT, NO_INT];
  put16(n, 7, sys); put16(n, 9, dia); put16(n, 11, mean);
  put16(n, 13, 120); put16(n, 15, 70); put16(n, 17, 1); put16(n, 19, 70); put16(n, 21, 40); put16(n, 23, 1); put16(n, 25, 90); put16(n, 27, 50); put16(n, 29, 1);

  const temp = dataBody(p.bed, TYPE.temp, 3, 48), m = temp.subarray(6);
  putF32(m, 0, p.temp ?? NO_TEMP); putF32(m, 4, NO_TEMP); putF32(m, 8, 0);
  putF32(m, 12, 39); putF32(m, 16, 36); put16(m, 20, 1); putF32(m, 22, 39); putF32(m, 26, 36); put16(m, 30, 1);

  return [seal(ecg), seal(pleth), seal(nibp), seal(temp)];
}
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** Demo unit: a few synthetic children whose vitals drift slowly. */
export const DEMO_PATIENTS: SimPatient[] = [
  { bed: 1, name: 'DEMO AYESHA', hr: 128, spo2: 97, temp: 37.4, nibp: [96, 58, 71], rr: 30 },
  { bed: 2, name: 'DEMO BILAL', hr: 104, spo2: 92, temp: 38.6, nibp: [102, 64, 77], rr: 36 },
  { bed: 3, name: 'DEMO ZAINAB', hr: 142, spo2: 99, temp: null, nibp: null, rr: 40 },
  { bed: 4, name: 'DEMO HAMZA', hr: 88, spo2: 95, temp: 36.8, nibp: [110, 70, 83], rr: 22 },
];
export function drift(p: SimPatient, t: number): SimPatient {
  const w = (period: number, amp: number) => amp * Math.sin((2 * Math.PI * t) / period + p.bed);
  return { ...p, hr: p.hr + w(97, 9) + w(13, 2), spo2: Math.min(100, p.spo2 + w(71, 2)), temp: p.temp == null ? null : p.temp + w(600, 0.3) };
}
