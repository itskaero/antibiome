// ═══════════════════════════════════════════════════════════
//  Bedside scores (pure).
//
//  Phoenix Sepsis Score — Schlapbach LJ, Watson RS, Sorce LR et al. International Consensus
//  Criteria for Pediatric Sepsis and Septic Shock. JAMA 2024;331:665-74 (and Sanchez-Pinto LN et
//  al., JAMA 2024;331:675-86). Four organ systems, 0–13 points:
//    respiratory 0–3 · cardiovascular 0–6 · coagulation 0–2 · neurological 0–2.
//  Sepsis = suspected infection + score ≥ 2. Septic shock = sepsis + ≥ 1 cardiovascular point.
//  Thresholds are transcribed from the publication; verify against it before formal use.
//
//  PEWS — Brighton Paediatric Early Warning Score (Monaghan A, Paediatr Nurs 2005;17:32-5):
//  behaviour, cardiovascular and respiratory 0–3 each, +2 for quarter-hourly nebulisers,
//  +2 for persistent vomiting after surgery (0–13).
//
//  Both describe severity for audit and research. Neither recommends treatment.
// ═══════════════════════════════════════════════════════════
import type { Admission, ClinicalEvent, Episode } from './types';
import { DX_BY_CODE } from './reference';
import type { VitalSet, VitalValues } from './vitals';

/** What was going on at the moment the values were measured. */
export interface PhoenixContext {
  ageMonths: number;
  /** Invasive mechanical ventilation at that time. */
  mv: boolean;
  /** Any respiratory support (oxygen, HFNC, NIV or MV). */
  support: boolean;
  /** Number of vasoactive agents running at that time. */
  vasoactives: number;
}
export interface Phoenix {
  total: number; resp: number; cardio: number; coag: number; neuro: number; missing: string[];
  /** Cardiovascular parts (vasoactives 0–2, lactate 0–2, MAP 0–2), kept so a 24-h worst takes the worst of each. */
  parts: { vaso: number; lactate: number; map: number };
}

/** MAP bands by age: [upper limit for 2 points (exclusive), upper limit for 1 point (inclusive)]. */
const MAP_BANDS: { maxMonths: number; two: number; one: number }[] = [
  { maxMonths: 1, two: 17, one: 30 },
  { maxMonths: 12, two: 25, one: 38 },
  { maxMonths: 24, two: 31, one: 43 },
  { maxMonths: 60, two: 32, one: 44 },
  { maxMonths: 144, two: 36, one: 48 },
  { maxMonths: Infinity, two: 38, one: 51 },
];

export function phoenix(v: VitalValues, c: PhoenixContext): Phoenix {
  const missing: string[] = [];
  const fio2 = v.fio2 != null ? v.fio2 / 100 : c.support ? null : 0.21;

  // Respiratory: the worse of PaO₂:FiO₂ and SpO₂:FiO₂ (SpO₂ only when ≤ 97%).
  let resp = 0;
  const pf = v.pao2 != null && fio2 ? v.pao2 / fio2 : null;
  const sf = v.spo2 != null && v.spo2 <= 97 && fio2 ? v.spo2 / fio2 : null;
  if (pf == null && sf == null) missing.push(c.support && v.fio2 == null ? 'FiO₂' : 'SpO₂ or PaO₂');
  const pts = (ratio: number | null, cut3: number, cut2: number, cut1: number) => {
    if (ratio == null) return 0;
    if (c.mv && ratio < cut3) return 3;
    if (c.mv && ratio < cut2) return 2;
    if (c.support && ratio < cut1) return 1;
    return 0;
  };
  resp = Math.max(pts(pf, 100, 200, 400), pts(sf, 148, 220, 292));

  // Cardiovascular: vasoactives + lactate + age-based MAP.
  const vaso = Math.min(2, c.vasoactives);
  let lactate = 0, map = 0;
  if (v.lactate != null) lactate = v.lactate >= 11 ? 2 : v.lactate >= 5 ? 1 : 0; else missing.push('lactate');
  if (v.map != null) {
    const b = MAP_BANDS.find(x => c.ageMonths < x.maxMonths)!;
    map = v.map < b.two ? 2 : v.map <= b.one ? 1 : 0;
  } else missing.push('MAP');
  const cardio = vaso + lactate + map;

  // Coagulation: one point each, at most 2.
  const coagParts = [
    v.platelets != null ? +(v.platelets < 100) : null,
    v.inr != null ? +(v.inr > 1.3) : null,
    v.ddimer != null ? +(v.ddimer > 2) : null,
    v.fibrinogen != null ? +(v.fibrinogen < 1) : null, // < 100 mg/dL
  ];
  if (coagParts.every(x => x == null)) missing.push('coagulation labs');
  const coag = Math.min(2, coagParts.reduce<number>((s, x) => s + (x ?? 0), 0));

  // Neurological: bilaterally fixed pupils 2, else GCS ≤ 10 → 1.
  let neuro = 0;
  if (v.pupils_fixed === 1) neuro = 2;
  else if (v.gcs != null) neuro = v.gcs <= 10 ? 1 : 0;
  else missing.push('GCS');

  return { total: resp + cardio + coag + neuro, resp, cardio, coag, neuro, missing, parts: { vaso, lactate, map } };
}

/** Worst of each organ system across several moments, then summed (as Phoenix is applied over the first 24 h). */
export function worstPhoenix(list: Phoenix[], vasoPoints = 0): Phoenix | null {
  if (!list.length) return null;
  const parts = {
    vaso: Math.max(vasoPoints, ...list.map(p => p.parts.vaso)),
    lactate: Math.max(...list.map(p => p.parts.lactate)),
    map: Math.max(...list.map(p => p.parts.map)),
  };
  const resp = Math.max(...list.map(p => p.resp)), cardio = parts.vaso + parts.lactate + parts.map;
  const coag = Math.max(...list.map(p => p.coag)), neuro = Math.max(...list.map(p => p.neuro));
  // A component is only "missing" if it was missing every time.
  const missing = [...new Set(list.flatMap(p => p.missing))].filter(m => list.every(p => p.missing.includes(m)));
  return { total: resp + cardio + coag + neuro, resp, cardio, coag, neuro, missing, parts };
}

export const phoenixSepsis = (p: Phoenix, infectionSuspected: boolean) => infectionSuspected && p.total >= 2;
export const phoenixSepticShock = (p: Phoenix, infectionSuspected: boolean) => phoenixSepsis(p, infectionSuspected) && p.cardio >= 1;

// ── PEWS (Brighton) ──────────────────────────────────────────

export const PEWS_ITEMS = [
  { key: 'behaviour', label: 'Behaviour', options: ['Playing / appropriate', 'Sleeping', 'Irritable', 'Lethargic or confused, or reduced response to pain'] },
  { key: 'cardiovascular', label: 'Cardiovascular', options: ['Pink, or capillary refill 1–2 s', 'Pale, or capillary refill 3 s', 'Grey, or capillary refill 4 s, or heart rate 20 above normal', 'Grey and mottled, or capillary refill ≥ 5 s, or heart rate 30 above normal, or bradycardia'] },
  { key: 'respiratory', label: 'Respiratory', options: ['Normal for age, no recession', 'Rate > 10 above normal, accessory muscles, or FiO₂ ≥ 30% / ≥ 3 L/min', 'Rate > 20 above normal, recession, or FiO₂ ≥ 40% / ≥ 6 L/min', 'Rate ≥ 5 below normal with sternal recession, tug or grunting, or FiO₂ ≥ 50% / ≥ 8 L/min'] },
] as const;
export const PEWS_EXTRAS = [{ key: 'nebs', label: 'Quarter-hourly nebulisers' }, { key: 'vomiting', label: 'Persistent vomiting after surgery' }] as const;
export interface PewsDraft { behaviour: number | null; cardiovascular: number | null; respiratory: number | null; nebs: boolean; vomiting: boolean }
export const emptyPews = (): PewsDraft => ({ behaviour: null, cardiovascular: null, respiratory: null, nebs: false, vomiting: false });
/** Total once all three main items are scored; null otherwise. */
export const pewsTotal = (d: PewsDraft) => (d.behaviour == null || d.cardiovascular == null || d.respiratory == null ? null
  : d.behaviour + d.cardiovascular + d.respiratory + (d.nebs ? 2 : 0) + (d.vomiting ? 2 : 0));

// ── Context from the episode record ──────────────────────────


const at = (s: string) => new Date(s.length === 10 ? `${s}T00:00` : s).getTime();
const active = (e: Episode, t: number) => at(e.startAt) <= t && (!e.endAt || at(e.endAt) > t);

/** Support and vasoactives running at time t, from the episode record. */
export function contextAt(episodes: Episode[], t: number, ageMonths: number): PhoenixContext {
  const now = episodes.filter(e => active(e, t));
  return {
    ageMonths,
    mv: now.some(e => e.kind === 'resp' && e.detail === 'MV'),
    support: now.some(e => e.kind === 'resp'),
    vasoactives: new Set(now.filter(e => e.kind === 'vaso').map(e => e.detail)).size,
  };
}

/** Phoenix for each recorded moment (sets with at least one Phoenix input). */
export function phoenixPerSet(sets: VitalSet[], episodes: Episode[], ageMonths: number) {
  const inputs = ['spo2', 'pao2', 'lactate', 'map', 'platelets', 'inr', 'ddimer', 'fibrinogen', 'gcs', 'pupils_fixed'] as const;
  return sets.filter(s => inputs.some(k => s.values[k] != null)).map(s => ({ set: s, score: phoenix(s.values, contextAt(episodes, at(s.at), ageMonths)) }));
}

/** Worst Phoenix in the first 24 h (−30 min to +24 h), including the most vasoactives running at once. */
export function phoenix24(sets: VitalSet[], episodes: Episode[], admitAt: string, ageMonths: number): Phoenix | null {
  const t0 = at(admitAt), t1 = t0 + 24 * 3_600_000;
  const inWindow = sets.filter(s => at(s.at) >= t0 - 30 * 60_000 && at(s.at) <= t1);
  const per = phoenixPerSet(inWindow, episodes, ageMonths).map(x => x.score);
  // Vasoactive points can occur between recorded moments: check every start time in the window.
  const starts = episodes.filter(e => e.kind === 'vaso' && at(e.startAt) <= t1 && (!e.endAt || at(e.endAt) >= t0)).map(e => Math.max(t0, at(e.startAt)));
  const maxVaso = Math.max(0, ...starts.map(t => contextAt(episodes, t, ageMonths).vasoactives));
  return worstPhoenix(per, Math.min(2, maxVaso));
}

/**
 * Suspected infection for Phoenix sepsis, from what the app records: an antimicrobial started or
 * a culture sent/collected between 24 h before and 24 h after admission, or an infection diagnosis.
 */
export function infectionSuspected(a: Admission, episodes: Episode[], events: ClinicalEvent[], cultures: { collectedAt: string }[]): boolean {
  const t0 = at(a.admitAt), lo = t0 - 24 * 3_600_000, hi = t0 + 24 * 3_600_000;
  const inWin = (t: number) => t >= lo && t <= hi;
  return episodes.some(e => e.kind === 'abx' && inWin(at(e.startAt)))
    || events.some(e => e.type === 'culture_sent' && inWin(at(e.at)))
    || cultures.some(c => inWin(at(c.collectedAt)))
    || [a.primaryDx, ...a.secondaryDx].some(c => DX_BY_CODE[c]?.category === 'Infection' || ['MENINGITIS', 'TBM', 'ENCEPHALITIS', 'NEONATAL_SEPSIS', 'PNEUMONIA', 'SEVERE_PNEUMONIA', 'EMPYEMA'].includes(c));
}
