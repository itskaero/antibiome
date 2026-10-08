// Built-in disease modules shipped with the app. They are seeded into the database on first run
// (and when a later release adds one); after that the database copy is authoritative, so admins can
// edit, extend or deactivate them. Field keys are stable identifiers — never rename them.
import type { CaptureStage, ParamType, ShowIf } from './modules';

export interface ParamSeed {
  key: string; label: string; type: ParamType; unit?: string; options?: string[]; min?: number; max?: number; decimals?: number;
  capture: CaptureStage; required?: boolean; help?: string; showIf?: ShowIf;
}
export interface ModuleSeed {
  id: string; label: string; description: string; triggerDx: string[]; derived: string[]; outcomes: string[]; exposures: string[]; params: ParamSeed[];
}

export const BUILT_IN_MODULES: ModuleSeed[] = [
  {
    id: 'sepsis',
    label: 'Sepsis & septic shock',
    description: 'Time-zero, source, lactate and resuscitation — enough for bundle timing and outcome analyses.',
    triggerDx: ['SEPSIS', 'SEPTIC_SHOCK'],
    derived: ['time_to_abx_min', 'culture_before_abx', 'culture_positive', 'vaso_required', 'vaso_days', 'mv_required', 'mv_days', 'los_days', 'died'],
    outcomes: ['died', 'mv_required', 'vaso_required', 'los_days', 'mv_days'],
    exposures: ['source', 'early_fluids'],
    params: [
      { key: 'recognised_at', label: 'Sepsis recognised (time zero)', type: 'datetime', capture: 'admission', required: true, help: 'When sepsis was first suspected — anchors time-to-antibiotic.' },
      { key: 'source', label: 'Suspected source', type: 'choice', capture: 'admission', required: true, options: ['Lung', 'Bloodstream / unknown', 'CNS', 'Urinary', 'Abdominal', 'Skin / soft tissue', 'Device / line', 'Other'] },
      { key: 'lactate_initial', label: 'Initial lactate', type: 'number', unit: 'mmol/L', min: 0, max: 30, decimals: 1, capture: 'admission' },
      { key: 'fluid_first_hour', label: 'Fluid in first hour', type: 'number', unit: 'mL/kg', min: 0, max: 200, decimals: 0, capture: 'admission' },
      { key: 'early_fluids', label: 'Fluid bolus ≥ 20 mL/kg in first hour', type: 'boolean', capture: 'admission' },
      { key: 'psofa_admission', label: 'pSOFA at admission', type: 'number', min: 0, max: 24, decimals: 0, capture: 'admission' },
      { key: 'lactate_series', label: 'Lactate (repeat)', type: 'number', unit: 'mmol/L', min: 0, max: 30, decimals: 1, capture: 'daily' },
      { key: 'source_control', label: 'Source control needed', type: 'boolean', capture: 'discharge' },
    ],
  },
  {
    id: 'pneumonia',
    label: 'Pneumonia',
    description: 'Severity on arrival, imaging and aetiology for respiratory-support and antibiotic analyses.',
    triggerDx: ['PNEUMONIA', 'SEVERE_PNEUMONIA', 'EMPYEMA'],
    derived: ['niv_failure', 'mv_required', 'mv_days', 'culture_positive', 'abx_dot', 'los_days', 'died'],
    outcomes: ['mv_required', 'niv_failure', 'los_days', 'mv_days', 'died'],
    exposures: ['cxr', 'aetiology'],
    params: [
      { key: 'spo2_arrival', label: 'SpO₂ on arrival (in air if possible)', type: 'number', unit: '%', min: 30, max: 100, decimals: 0, capture: 'admission', required: true },
      { key: 'cxr', label: 'Chest X-ray', type: 'choice', capture: 'admission', required: true, options: ['Lobar consolidation', 'Patchy / bronchopneumonia', 'Effusion / empyema', 'Interstitial', 'Normal', 'Not done'] },
      { key: 'viral_tests', label: 'Viral tests positive', type: 'multi', capture: 'any', options: ['RSV', 'Influenza', 'SARS-CoV-2', 'Adenovirus', 'hMPV', 'Other', 'None positive', 'Not tested'] },
      { key: 'aetiology', label: 'Final aetiology', type: 'choice', capture: 'discharge', required: true, options: ['Bacterial — confirmed', 'Bacterial — presumed', 'Viral — confirmed', 'Mixed', 'Unknown'] },
    ],
  },
  {
    id: 'gbs',
    label: 'Guillain–Barré syndrome',
    description: 'Disability (Hughes), immunotherapy and complications — supports IVIG vs methylprednisolone comparisons.',
    triggerDx: ['GBS'],
    derived: ['hughes_improvement', 'mv_required', 'mv_days', 'los_days', 'died'],
    outcomes: ['hughes_improvement', 'mv_required', 'mv_days', 'los_days', 'died'],
    exposures: ['immunotherapy', 'variant'],
    params: [
      { key: 'onset_days', label: 'Days from weakness onset to admission', type: 'number', unit: 'd', min: 0, max: 60, decimals: 0, capture: 'admission' },
      { key: 'hughes_admission', label: 'Hughes grade at admission', type: 'number', min: 0, max: 6, decimals: 0, capture: 'admission', required: true, help: '0 healthy … 4 bedbound … 5 ventilated … 6 dead' },
      { key: 'bulbar', label: 'Bulbar involvement', type: 'boolean', capture: 'admission' },
      { key: 'autonomic', label: 'Autonomic dysfunction', type: 'boolean', capture: 'any' },
      { key: 'mrc_sum', label: 'MRC sum score', type: 'number', min: 0, max: 60, decimals: 0, capture: 'daily' },
      { key: 'variant', label: 'Electrophysiological variant', type: 'choice', capture: 'discharge', options: ['AIDP', 'AMAN', 'AMSAN', 'Miller Fisher', 'Not done / unknown'] },
      { key: 'immunotherapy', label: 'Immunotherapy', type: 'multi', capture: 'discharge', required: true, options: ['IVIG', 'Methylprednisolone', 'Plasmapheresis', 'None (supportive)'] },
      { key: 'ivig_start', label: 'IVIG started', type: 'date', capture: 'any', showIf: { param: 'immunotherapy', includes: 'IVIG' } },
      { key: 'hughes_discharge', label: 'Hughes grade at PICU discharge', type: 'number', min: 0, max: 6, decimals: 0, capture: 'discharge', required: true },
    ],
  },
  {
    id: 'dka',
    label: 'Diabetic ketoacidosis',
    description: 'Severity, resolution time and cerebral oedema.',
    triggerDx: ['DKA'],
    derived: ['los_days', 'mv_required', 'died'],
    outcomes: ['resolution_h', 'cerebral_oedema', 'los_days'],
    exposures: ['new_onset', 'severity'],
    params: [
      { key: 'new_onset', label: 'New-onset diabetes', type: 'boolean', capture: 'admission', required: true },
      { key: 'ph_admission', label: 'pH at admission', type: 'number', min: 6.5, max: 7.6, decimals: 2, capture: 'admission', required: true },
      { key: 'bicarbonate', label: 'Bicarbonate at admission', type: 'number', unit: 'mmol/L', min: 0, max: 40, decimals: 1, capture: 'admission' },
      { key: 'severity', label: 'DKA severity', type: 'choice', capture: 'admission', options: ['Mild (pH 7.2–7.3)', 'Moderate (pH 7.1–7.2)', 'Severe (pH < 7.1)'] },
      { key: 'resolution_h', label: 'Hours to DKA resolution', type: 'number', unit: 'h', min: 0, max: 200, decimals: 0, capture: 'discharge' },
      { key: 'cerebral_oedema', label: 'Cerebral oedema', type: 'boolean', capture: 'discharge', required: true },
    ],
  },
];
