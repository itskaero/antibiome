// ═══════════════════════════════════════════════════════════
//  Bedside monitor network protocol ("DDT" / M3100 central station family).
//
//  Reverse-engineered from a capture of three Scalis bedside monitors talking to their M3100
//  central station (CMS.exe). Nothing here is from vendor documentation, so every field carries
//  a confidence level (`VERIFIED` = seen with real, changing patient values in the capture;
//  `PROVISIONAL` = the slot exists but no monitor in the capture had that sensor attached, so the
//  position is inferred from the parameter order in the central station's own Para.cfg).
//
//  Transport: each monitor opens ONE TCP connection to the central station (192.168.10.251 by
//  default) on port 510 + bed number, and streams frames:
//
//      [len u16 LE] [body: len bytes]
//      body = [bed u8] [class u8] [hdrSum u16 LE] [type u8] [seq u8] [payload…]
//      hdrSum = ~(bed + class + (len & 0xff) + (len >> 8))  & 0xffff
//
//  Most bodies also end with a 16-bit trailer = ~sum(body[4 .. len-2]) & 0xffff.
//
//  Once a second each monitor sends one "class 0x46" set (ECG, pleth, NIBP, temperature, IBP,
//  CO₂) and one class 0x47 status frame. When it connects it also sends class 0x3e (patient
//  information). The central station answers with `02 00 13 34` about once a second and a time
//  synchronisation frame when a monitor connects.
// ═══════════════════════════════════════════════════════════

export const DEFAULT_BASE_PORT = 510;
/** "Not measured / sensor off" for 16-bit integer values. */
export const INVALID_INT = -100;

export const CLASS = { patient: 0x3e, data: 0x46, status: 0x47 } as const;
export const TYPE = { ecg: 0x14, pleth: 0x15, nibp: 0x16, temp: 0x17, ibp: 0x18, co2: 0x1a } as const;

/** Waveform sample rates, from the central station's Wave.cfg. */
export const WAVE_RATE = { ecg: 256, pleth: 256, resp: 128 } as const;
/** Baseline (zero-signal) value of each waveform, from Wave.cfg / the capture. */
export const WAVE_BASELINE = { ecg: 128, pleth: 64 } as const;

export type Confidence = 'verified' | 'provisional';

// ── Checksums ────────────────────────────────────────────────

export const headerSum = (bed: number, cls: number, len: number) => (~(bed + cls + (len & 0xff) + (len >> 8))) & 0xffff;
export function bodySum(body: Uint8Array, from = 4, to = body.length - 2) {
  let s = 0;
  for (let i = from; i < to; i++) s += body[i];
  return (~s) & 0xffff;
}
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const i16 = (b: Uint8Array, o: number) => { const v = u16(b, o); return v & 0x8000 ? v - 0x10000 : v; };
const f32 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset + o, 4).getFloat32(0, true);

// ── Framing ──────────────────────────────────────────────────

/** Re-assembles frames from a TCP byte stream (chunks can split or join frames arbitrarily). */
export class FrameReader {
  private buf = new Uint8Array(0);
  /** Frames dropped because their header checksum did not match. */
  rejected = 0;
  static readonly MAX_FRAME = 8192;

  push(chunk: Uint8Array): Uint8Array[] {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf); merged.set(chunk, this.buf.length);
    const out: Uint8Array[] = [];
    let i = 0;
    while (merged.length - i >= 2) {
      const len = u16(merged, i);
      // The header checksum is known after 6 bytes, so a false start is skipped at once instead of
      // waiting for `len` bytes that will never form a frame.
      const bad = len < 4 || len > FrameReader.MAX_FRAME || (merged.length - i >= 6 && u16(merged, i + 4) !== headerSum(merged[i + 2], merged[i + 3], len));
      if (bad) { this.rejected++; i += 1; continue; }
      if (merged.length - i - 2 < len) break;
      out.push(merged.slice(i + 2, i + 2 + len)); i += 2 + len;
    }
    this.buf = merged.slice(i);
    if (this.buf.length > FrameReader.MAX_FRAME * 2) this.buf = new Uint8Array(0); // never grow without bound
    return out;
  }
}

/** Wraps a body in its length prefix and fills in both checksums. `body[2..3]` and the last two bytes are overwritten. */
export function seal(body: Uint8Array, trailer = true): Uint8Array {
  const out = new Uint8Array(body.length + 2);
  out[0] = body.length & 0xff; out[1] = body.length >> 8;
  out.set(body, 2);
  const b = out.subarray(2);
  const h = headerSum(b[0], b[1], b.length); b[2] = h & 0xff; b[3] = h >> 8;
  if (trailer) { const t = bodySum(b); b[b.length - 2] = t & 0xff; b[b.length - 1] = t >> 8; }
  return out;
}

// ── Central-station → monitor ────────────────────────────────

/** Keep-alive the M3100 central station sends to each monitor about once a second. */
export const HEARTBEAT = Uint8Array.of(0x02, 0x00, 0x13, 0x34);
const CMS_ID = 0x2d, CLASS_TIME = 0x4f;

/** Clock synchronisation frame (sets the monitor's clock). The central station sends it on connect. */
export function encodeTimeSync(d: Date): Uint8Array {
  const body = Uint8Array.of(CMS_ID, CLASS_TIME, 0, 0, d.getFullYear() >> 8, d.getFullYear() & 0xff, d.getMonth() + 1, d.getDate(),
    d.getHours(), d.getMinutes(), d.getSeconds(), 0x55, 0xaa, 0x55, 0xaa, 0, 0);
  return seal(body);
}

// ── Decoding ─────────────────────────────────────────────────

export interface PatientInfo { name: string | null; patientId: string | null; admitDate: string | null; birthDate: string | null }
export interface NumericValue { value: number | null; confidence: Confidence; low?: number | null; high?: number | null; alarmOn?: boolean }

export type Decoded =
  | { kind: 'patient'; bed: number; patient: PatientInfo }
  | { kind: 'ecg'; bed: number; waves: { lead1: Uint8Array; lead2: Uint8Array; lead3: Uint8Array; resp: Uint8Array }; hr: NumericValue; leadsOff: boolean }
  | { kind: 'pleth'; bed: number; wave: Uint8Array; spo2: NumericValue; pr: NumericValue; probeOff: boolean }
  | { kind: 'nibp'; bed: number; sys: NumericValue; dia: NumericValue; mean: NumericValue }
  | { kind: 'temp'; bed: number; t1: NumericValue; t2: NumericValue }
  | { kind: 'other'; bed: number; cls: number; type: number | null };

const intOrNull = (v: number) => (v === INVALID_INT || v < -50 ? null : v);
/** Temperatures are float32 °C; an unplugged probe reads ~6543.6. */
const tempOrNull = (v: number) => (Number.isFinite(v) && v > 0 && v < 50 ? Math.round(v * 10) / 10 : null);
const ascii = (b: Uint8Array, from: number, to: number) => {
  // A field can hold several NUL-separated parts (e.g. first and last name): join them with spaces.
  const parts: string[] = []; let cur = '';
  for (let i = from; i < Math.min(to, b.length); i++) {
    const c = b[i];
    if (c === 0) { if (cur) parts.push(cur); cur = ''; } else if (c >= 32 && c < 127) cur += String.fromCharCode(c);
  }
  if (cur) parts.push(cur);
  return parts.length ? parts.join(' ').trim() : null;
};
const isoDate = (s: string | null) => (s && /^\d{4}\/\d{2}\/\d{2}$/.test(s) ? s.replace(/\//g, '-') : null);

/** Decode one frame body (as returned by FrameReader). Never throws on malformed input. */
export function decode(body: Uint8Array): Decoded {
  const bed = body[0], cls = body[1];
  const other: Decoded = { kind: 'other', bed, cls, type: body.length > 4 ? body[4] : null };
  try {
    if (cls === CLASS.patient && body.length >= 132) {
      return { kind: 'patient', bed, patient: {
        name: ascii(body, 37, 69), patientId: ascii(body, 69, 101),
        admitDate: isoDate(ascii(body, 101, 117)), birthDate: isoDate(ascii(body, 122, 132)),
      } };
    }
    if (cls !== CLASS.data || body.length < 8) return other;
    const p = body.subarray(6);
    switch (body[4]) {
      case TYPE.pleth: {
        if (p.length < 272) return other;
        const wave = p.slice(0, 256);
        const spo2 = intOrNull(i16(p, 256)), pr = intOrNull(i16(p, 258));
        return { kind: 'pleth', bed, wave, probeOff: spo2 == null,
          spo2: { value: spo2, confidence: 'verified', high: i16(p, 260), low: i16(p, 262), alarmOn: u16(p, 264) === 1 },
          pr: { value: pr, confidence: 'verified', high: i16(p, 266), low: i16(p, 268), alarmOn: u16(p, 270) === 1 } };
      }
      case TYPE.ecg: {
        if (p.length < 896 + 32) return other;
        const t = p.subarray(896);
        const lead1 = p.slice(0, 256), lead2 = p.slice(256, 512), lead3 = p.slice(512, 768), resp = p.slice(768, 896);
        const flat = (w: Uint8Array) => w.every(x => x === WAVE_BASELINE.ecg);
        return { kind: 'ecg', bed, waves: { lead1, lead2, lead3, resp }, leadsOff: flat(lead1) && flat(lead2) && flat(lead3),
          // HR slot is provisional: every ECG in the reference capture had its leads off.
          hr: { value: intOrNull(i16(t, 0)), confidence: 'provisional', high: i16(t, 31), low: i16(t, 33), alarmOn: u16(t, 35) === 1 } };
      }
      case TYPE.nibp: {
        if (p.length < 31) return other;
        // Slots are provisional: no NIBP reading was taken during the reference capture.
        const lim = (o: number) => ({ high: i16(p, o), low: i16(p, o + 2), alarmOn: u16(p, o + 4) === 1 });
        return { kind: 'nibp', bed,
          sys: { value: intOrNull(i16(p, 7)), confidence: 'provisional', ...lim(13) },
          dia: { value: intOrNull(i16(p, 9)), confidence: 'provisional', ...lim(19) },
          mean: { value: intOrNull(i16(p, 11)), confidence: 'provisional', ...lim(25) } };
      }
      case TYPE.temp: {
        if (p.length < 34) return other;
        return { kind: 'temp', bed,
          t1: { value: tempOrNull(f32(p, 0)), confidence: 'verified', high: round1(f32(p, 12)), low: round1(f32(p, 16)), alarmOn: u16(p, 20) === 1 },
          t2: { value: tempOrNull(f32(p, 4)), confidence: 'verified', high: round1(f32(p, 22)), low: round1(f32(p, 26)), alarmOn: u16(p, 30) === 1 } };
      }
      default: return other;
    }
  } catch { return other; }
}
const round1 = (v: number) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
