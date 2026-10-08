import type { AbxIntent, AdmissionSource, Disposition, RespLevel } from './reference';

export type Role = 'admin' | 'clinician' | 'viewer' | 'researcher';
export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrator', clinician: 'Clinician (data entry)', viewer: 'Viewer (dashboards)', researcher: 'Researcher (de-identified)',
};

/** Local ISO-like timestamp without zone: 'YYYY-MM-DDTHH:mm'. The PICU PC's clock is the reference. */
export type LocalDateTime = string;

export interface User { id: number; username: string; displayName: string; role: Role; active: boolean }

export interface Admission {
  id: string;
  patientId: string;
  bed: string | null;
  admitAt: LocalDateTime;
  ageMonths: number;
  sex: 'M' | 'F';
  weightKg: number | null;
  source: AdmissionSource;
  admissionType: 'emergency' | 'elective';
  primaryDx: string;
  secondaryDx: string[];
  chronicCondition: boolean;
  malnutrition: boolean;
  arrivalSupport: RespLevel;
  shockOnArrival: boolean;
  comaOnArrival: boolean;
  dischargeAt: LocalDateTime | null;
  disposition: Disposition | null;
  notes: string | null;
}

export type EpisodeKind = 'resp' | 'vaso' | 'abx';
export interface Episode {
  id: string;
  admissionId: string;
  kind: EpisodeKind;
  /** resp: RespLevel · vaso: agent · abx: drug name */
  detail: string;
  intent: AbxIntent | null;
  startAt: LocalDateTime;
  endAt: LocalDateTime | null;
  endReason: string | null;
}

export interface ClinicalEvent {
  id: string;
  admissionId: string;
  type: 'procedure' | 'complication' | 'culture_sent' | 'note' | 'deterioration';
  label: string;
  at: LocalDateTime;
  note: string | null;
}

export interface SusceptibilityResult { name: string; result: 'S' | 'I' | 'R' }
export interface Culture {
  id: string;
  admissionId: string | null;
  patientId: string | null;
  unit: string;
  collectedAt: string; // YYYY-MM-DD (time optional)
  specimen: string;
  /** null = no growth */
  organism: string | null;
  ageGroup: string | null;
  antibiotics: SusceptibilityResult[];
  source: 'picu' | 'legacy';
}

/** Everything analytics needs, already scrubbed of identifiers. */
export interface Dataset {
  admissions: Admission[];
  episodes: Episode[];
  events: ClinicalEvent[];
  cultures: Culture[];
  beds: number;
}
