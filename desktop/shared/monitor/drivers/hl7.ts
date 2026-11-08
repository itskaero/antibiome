// HL7 v2 observation results (ORU^R01) over MLLP — what most monitor gateways and central stations
// (Mindray, Edan, Comen, Philips, GE via their HL7 export) can send. Values are labelled in the
// message, so they need no reverse engineering. Each message is acknowledged with MSA|AA.
import type { NumericValue, PatientInfo } from '../protocol';
import type { MonitorDriver, MonitorEvent, Param } from './types';

const VT = 0x0b, FS = 0x1c, CR = 0x0d;

/** OBX-3 identifiers → parameter. IEEE 11073 MDC codes, LOINC, and the plain labels many monitors use. */
const CODES: Record<string, Param> = {
  // MDC (ISO/IEEE 11073-10101)
  '150456': 'spo2', '149530': 'pr', '147842': 'hr', '151562': 'rr', '151594': 'rr',
  '150301': 'sys', '150302': 'dia', '150303': 'mean', '150344': 't1', '150364': 't1', '150368': 't2',
  // LOINC
  '59408-5': 'spo2', '2708-6': 'spo2', '8889-8': 'pr', '8867-4': 'hr', '9279-1': 'rr',
  '8480-6': 'sys', '8462-4': 'dia', '8478-0': 'mean', '8310-5': 't1', '8331-1': 't1',
  // Common plain labels
  SPO2: 'spo2', 'SPO2%': 'spo2', SAO2: 'spo2', PR: 'pr', PULSE: 'pr', 'PLETH_PR': 'pr', HR: 'hr', 'ECG_HR': 'hr',
  RR: 'rr', RESP: 'rr', AWRR: 'rr', 'NIBP_S': 'sys', NIBPS: 'sys', 'NBP_SYS': 'sys', 'NIBP_D': 'dia', NIBPD: 'dia', 'NBP_DIA': 'dia',
  'NIBP_M': 'mean', NIBPM: 'mean', 'NBP_MEAN': 'mean', TEMP: 't1', T1: 't1', 'TEMP1': 't1', T2: 't2', 'TEMP2': 't2',
};

export const paramFor = (obx3: string): Param | null => {
  for (const part of obx3.split('^')) {
    const k = part.trim().toUpperCase().replace(/\s+/g, '_');
    if (k && CODES[k]) return CODES[k];
    if (part.trim() && CODES[part.trim()]) return CODES[part.trim()];
  }
  return null;
};

const fields = (seg: string) => seg.split('|');
const comp = (f: string | undefined, i: number) => (f ?? '').split('^')[i] ?? '';
const hl7Date = (s: string) => (/^\d{8}/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);
const firstInt = (s: string) => { const m = s.match(/\d+/); return m ? Number(m[0]) : null; };

export interface Hl7Result { events: MonitorEvent[]; controlId: string | null; ok: boolean }

/** Parse one HL7 message (segments separated by CR). */
export function parseHl7(text: string): Hl7Result {
  const segs = text.split(/\r\n?|\n/).filter(Boolean);
  const msh = segs.find(s => s.startsWith('MSH'));
  if (!msh) return { events: [], controlId: null, ok: false };
  const m = fields(msh);
  const controlId = m[9] ?? null;
  let bed: number | null = null;
  let patient: PatientInfo | null = null;
  const values: Partial<Record<Param, NumericValue>> = {};
  for (const s of segs) {
    const f = fields(s);
    if (f[0] === 'PID') {
      const name = [comp(f[5], 1), comp(f[5], 0)].filter(Boolean).join(' ') || null;
      patient = { name, patientId: comp(f[3], 0) || null, admitDate: null, birthDate: hl7Date(f[7] ?? '') };
    } else if (f[0] === 'PV1') {
      bed = firstInt(comp(f[3], 2)) ?? firstInt(comp(f[3], 0));
      if (patient && f[44]) patient.admitDate = hl7Date(f[44]);
    } else if (f[0] === 'OBX') {
      const p = paramFor(f[3] ?? '');
      const v = Number((f[5] ?? '').split('^')[0]);
      if (!p || !Number.isFinite(v)) continue;
      const [lo, hi] = (f[7] ?? '').split('-').map(Number);
      const status = (f[11] ?? 'F').toUpperCase();
      values[p] = { value: status === 'X' ? null : v, confidence: 'verified', low: Number.isFinite(lo) ? lo : null, high: Number.isFinite(hi) ? hi : null, alarmOn: Number.isFinite(lo) || Number.isFinite(hi) };
    }
  }
  const events: MonitorEvent[] = [];
  if (patient) events.push({ kind: 'patient', bed, patient });
  if (Object.keys(values).length) events.push({ kind: 'values', bed, values });
  return { events, controlId, ok: true };
}

const enc = (s: string) => Uint8Array.from(s, c => c.charCodeAt(0) & 0xff);
const stamp = (d: Date) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
export function ackFor(controlId: string | null, now = new Date()): Uint8Array {
  const body = `MSH|^~\\&|ANTIBIOME|PICU|||${stamp(now)}||ACK^R01|A${controlId ?? '0'}|P|2.3.1\rMSA|AA|${controlId ?? ''}\r`;
  return Uint8Array.of(VT, ...enc(body), FS, CR);
}

export const hl7Driver: MonitorDriver = {
  id: 'hl7',
  label: 'HL7 v2 over MLLP',
  description: 'Monitors or gateways that send HL7 observation results (ORU^R01). Usually one port for the whole unit; the bed comes from PV1-3.',
  defaultPorts: { mode: 'single', port: 2575 },
  bedInData: true,
  createReader() {
    let buf = '';
    const reader = {
      rejected: 0,
      push(chunk: Uint8Array) {
        for (let i = 0; i < chunk.length; i++) buf += String.fromCharCode(chunk[i]);
        const events: MonitorEvent[] = [], reply: Uint8Array[] = [];
        for (;;) {
          const start = buf.indexOf(String.fromCharCode(VT));
          const end = buf.indexOf(String.fromCharCode(FS, CR), start + 1);
          if (start < 0 || end < 0) break;
          const r = parseHl7(buf.slice(start + 1, end));
          buf = buf.slice(end + 2);
          if (!r.ok) { reader.rejected++; continue; }
          events.push(...r.events);
          reply.push(ackFor(r.controlId));
        }
        if (buf.length > 1 << 20) buf = ''; // never grow without bound
        return { events, reply };
      },
    };
    return reader;
  },
};
