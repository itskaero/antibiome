// ═══════════════════════════════════════════════════════════
//  Clinical reference data.
//  Antibiotic classes, organisms and specimen types are ported verbatim
//  from the original Antibiome web app (legacy/app.js at the repository root) so antibiograms and
//  MDR flags stay comparable across the NICU and PICU datasets.
// ═══════════════════════════════════════════════════════════

export const ANTIBIOTIC_CLASSES: Record<string, string[]> = {
  Penicillins:         ['Ampicillin','Amoxicillin','Amoxicillin-Clavulanate','Piperacillin-Tazobactam','Oxacillin','Nafcillin','Cloxacillin','Dicloxacillin'],
  Cephalosporins:      ['Cefazolin','Cefuroxime','Cefotaxime','Ceftriaxone','Ceftazidime','Cefepime','Cefoperazone-Sulbactam','Cefixime','Ceftolozane-Tazobactam','Ceftazidime-Avibactam','Cefiderocol'],
  Carbapenems:         ['Meropenem','Imipenem','Ertapenem','Doripenem','Imipenem-Cilastatin-Relebactam','Meropenem-Vaborbactam'],
  Aminoglycosides:     ['Gentamicin','Amikacin','Tobramycin','Netilmicin','Streptomycin'],
  Fluoroquinolones:    ['Ciprofloxacin','Levofloxacin','Moxifloxacin','Norfloxacin','Ofloxacin'],
  Glycopeptides:       ['Vancomycin','Teicoplanin','Dalbavancin','Oritavancin'],
  Macrolides:          ['Azithromycin','Clarithromycin','Erythromycin'],
  Tetracyclines:       ['Tetracycline','Doxycycline','Minocycline','Tigecycline'],
  Polymyxins:          ['Colistin','Polymyxin B'],
  Lincosamides:        ['Clindamycin'],
  Oxazolidinones:      ['Linezolid','Tedizolid'],
  Sulfonamides:        ['Trimethoprim-Sulfamethoxazole (Septran/Co-trimoxazole)','Trimethoprim'],
  Lipopeptides:        ['Daptomycin'],
  Monobactams:         ['Aztreonam','Aztreonam-Avibactam'],
  Nitrofurans:         ['Nitrofurantoin'],
  FusidicAcid:         ['Fusidic Acid'],
  Rifamycins:          ['Rifampicin','Rifaximin'],
  Nitroimidazoles:     ['Metronidazole','Tinidazole'],
  Phenicols:           ['Chloramphenicol'],
  Other:               ['Fosfomycin','Mupirocin','Fidaxomicin','Ceftaroline'],
};

export const ALL_ANTIBIOTICS = Object.entries(ANTIBIOTIC_CLASSES)
  .flatMap(([cls, drugs]) => drugs.map(name => ({ name, cls })))
  .sort((a, b) => a.name.localeCompare(b.name));

export const DRUG_TO_CLASS: Record<string, string> = {};
Object.entries(ANTIBIOTIC_CLASSES).forEach(([cls, drugs]) => drugs.forEach(d => { DRUG_TO_CLASS[d] = cls; }));

/** Antifungals/antivirals that can be prescribed (therapy only — not part of S/I/R panels). */
export const OTHER_ANTIMICROBIALS = ['Fluconazole', 'Amphotericin B', 'Micafungin', 'Voriconazole', 'Acyclovir', 'Oseltamivir'];

export const PRESCRIBABLE_ANTIMICROBIALS = [...ALL_ANTIBIOTICS.map(a => a.name), ...OTHER_ANTIMICROBIALS].sort();

/**
 * WHO AWaRe grouping (2023 list), simplified to the agents commonly used in PICU.
 * Agents not listed are reported as "Unclassified". Verify against the current
 * WHO list and local formulary before using this for policy.
 */
export type AwareGroup = 'Access' | 'Watch' | 'Reserve' | 'Unclassified';
const AWARE: Record<string, AwareGroup> = {
  'Ampicillin': 'Access', 'Amoxicillin': 'Access', 'Amoxicillin-Clavulanate': 'Access', 'Cloxacillin': 'Access',
  'Dicloxacillin': 'Access', 'Oxacillin': 'Access', 'Nafcillin': 'Access', 'Gentamicin': 'Access', 'Amikacin': 'Access',
  'Tobramycin': 'Access', 'Metronidazole': 'Access', 'Clindamycin': 'Access', 'Cefazolin': 'Access', 'Doxycycline': 'Access',
  'Trimethoprim-Sulfamethoxazole (Septran/Co-trimoxazole)': 'Access', 'Chloramphenicol': 'Access', 'Nitrofurantoin': 'Access',
  'Ceftriaxone': 'Watch', 'Cefotaxime': 'Watch', 'Ceftazidime': 'Watch', 'Cefepime': 'Watch', 'Cefuroxime': 'Watch',
  'Cefixime': 'Watch', 'Cefoperazone-Sulbactam': 'Watch', 'Piperacillin-Tazobactam': 'Watch', 'Meropenem': 'Watch',
  'Imipenem': 'Watch', 'Ertapenem': 'Watch', 'Vancomycin': 'Watch', 'Teicoplanin': 'Watch', 'Azithromycin': 'Watch',
  'Clarithromycin': 'Watch', 'Erythromycin': 'Watch', 'Ciprofloxacin': 'Watch', 'Levofloxacin': 'Watch', 'Moxifloxacin': 'Watch',
  'Rifampicin': 'Watch',
  'Colistin': 'Reserve', 'Polymyxin B': 'Reserve', 'Linezolid': 'Reserve', 'Tedizolid': 'Reserve', 'Tigecycline': 'Reserve',
  'Ceftazidime-Avibactam': 'Reserve', 'Ceftolozane-Tazobactam': 'Reserve', 'Cefiderocol': 'Reserve', 'Aztreonam': 'Reserve',
  'Daptomycin': 'Reserve', 'Fosfomycin': 'Reserve', 'Meropenem-Vaborbactam': 'Reserve', 'Imipenem-Cilastatin-Relebactam': 'Reserve',
};
export const awareGroup = (drug: string): AwareGroup => AWARE[drug] ?? 'Unclassified';

/** Agents tracked individually on the stewardship view. */
export const SENTINEL_ANTIMICROBIALS = ['Meropenem', 'Vancomycin', 'Colistin', 'Piperacillin-Tazobactam', 'Linezolid'];

export const ORGANISMS = [
  'Acinetobacter baumannii','Burkholderia cepacia','Citrobacter freundii','Citrobacter koseri','Enterobacter cloacae',
  'Enterobacter aerogenes (Klebsiella aerogenes)','Escherichia coli','Haemophilus influenzae','Klebsiella oxytoca',
  'Klebsiella pneumoniae','Morganella morganii','Proteus mirabilis','Proteus vulgaris','Providencia stuartii',
  'Pseudomonas aeruginosa','Salmonella spp.','Serratia marcescens','Stenotrophomonas maltophilia',
  'Coagulase-negative Staphylococci (CoNS)','Enterococcus faecalis','Enterococcus faecium','Listeria monocytogenes',
  'Staphylococcus aureus','Staphylococcus epidermidis','Staphylococcus haemolyticus','Streptococcus agalactiae (GBS)',
  'Streptococcus pneumoniae','Streptococcus pyogenes (GAS)','Streptococcus viridans group',
  'Candida albicans','Candida auris','Candida glabrata','Candida krusei','Candida parapsilosis','Candida tropicalis',
  'Aspergillus fumigatus',
];

export const SPECIMEN_TYPES = ['Blood','CSF','ETT','Peritoneal Fluid','Stool','Urine','Wound','Pleural Fluid','Other'];

// ── PICU core vocabularies ───────────────────────────────────

export const ADMISSION_SOURCES = ['ED', 'Ward', 'OT', 'Other hospital', 'NICU'] as const;
export type AdmissionSource = typeof ADMISSION_SOURCES[number];

/** Respiratory support, ordered from least to most invasive. 'RA' = room air (no episode). */
export const RESP_LEVELS = ['RA', 'O2', 'HFNC', 'NIV', 'MV'] as const;
export type RespLevel = typeof RESP_LEVELS[number];
export const RESP_LABEL: Record<RespLevel, string> = { RA: 'Room air', O2: 'Oxygen', HFNC: 'HFNC', NIV: 'CPAP / NIV', MV: 'Ventilated' };

export const VASOACTIVES = ['Adrenaline', 'Noradrenaline', 'Dopamine', 'Dobutamine', 'Milrinone', 'Vasopressin'];

export const DISPOSITIONS = ['Ward', 'Home', 'Transfer', 'LAMA', 'Died'] as const;
export type Disposition = typeof DISPOSITIONS[number];

export const ABX_INTENTS = ['empiric', 'targeted', 'prophylaxis'] as const;
export type AbxIntent = typeof ABX_INTENTS[number];

export const COMPLICATIONS = ['VAP', 'CLABSI', 'CAUTI', 'Unplanned extubation', 'Reintubation <48h', 'Cardiac arrest', 'Pressure injury', 'AKI requiring RRT'];
export const PROCEDURES = ['Intubation', 'Central line', 'Arterial line', 'Chest drain', 'Peritoneal dialysis', 'Haemodialysis / CRRT', 'Lumbar puncture', 'Blood transfusion'];

// ── Diagnosis catalogue ──────────────────────────────────────
// Paediatric intensive care diagnoses mapped to ICD-10 (WHO; a few ICD-10-CM codes where WHO has
// none, e.g. R65.21). `syn` feeds the autocomplete. `pim3` is the PIM3 (2013) diagnosis group the
// condition suggests when it is the main reason for admission — the clinician still confirms it.
// Codes are stored with each admission: never rename or remove one; add new codes instead.

export type DxPim3 = 'very_high' | 'high' | 'low';
export interface DxEntry { code: string; label: string; icd10: string; category: string; syn?: string[]; pim3?: DxPim3 }

export const DX_CATEGORIES = ['Infection', 'Respiratory', 'Cardiovascular', 'Neuro', 'Endocrine', 'Renal', 'GI/Hepatic', 'Haem/Onc',
  'Immunology', 'Neonatal', 'Trauma', 'Toxicology', 'Surgical', 'Nutrition', 'Other'] as const;

export const DX_CATALOGUE: DxEntry[] = [
  // Infection / sepsis
  { code: 'SEPSIS', label: 'Sepsis', icd10: 'A41.9', category: 'Infection', syn: ['septicaemia', 'septicemia', 'bacteraemia'] },
  { code: 'SEPTIC_SHOCK', label: 'Septic shock', icd10: 'R65.21', category: 'Infection', syn: ['shock septic', 'warm shock', 'cold shock'] },
  { code: 'MENINGOCOCCAL', label: 'Meningococcal disease / purpura fulminans', icd10: 'A39.9', category: 'Infection', syn: ['meningococcaemia', 'purpura fulminans', 'neisseria'] },
  { code: 'TSS', label: 'Toxic shock syndrome', icd10: 'A48.3', category: 'Infection', syn: ['staphylococcal toxic shock', 'streptococcal toxic shock', 'tss'] },
  { code: 'DENGUE', label: 'Dengue (severe / with warning signs)', icd10: 'A91', category: 'Infection', syn: ['dhf', 'dss', 'dengue shock'] },
  { code: 'MALARIA', label: 'Severe malaria', icd10: 'B50.9', category: 'Infection', syn: ['cerebral malaria', 'falciparum'] },
  { code: 'TYPHOID', label: 'Enteric fever', icd10: 'A01.0', category: 'Infection', syn: ['typhoid', 'paratyphoid', 'salmonella'] },
  { code: 'SCRUB_TYPHUS', label: 'Scrub typhus / rickettsial infection', icd10: 'A75.3', category: 'Infection', syn: ['rickettsia', 'orientia', 'eschar'] },
  { code: 'LEPTOSPIROSIS', label: 'Leptospirosis', icd10: 'A27.9', category: 'Infection', syn: ['weil disease'] },
  { code: 'DIPHTHERIA', label: 'Diphtheria', icd10: 'A36.9', category: 'Infection' },
  { code: 'TETANUS', label: 'Tetanus', icd10: 'A35', category: 'Infection', syn: ['lockjaw'] },
  { code: 'PERTUSSIS', label: 'Pertussis', icd10: 'A37.9', category: 'Infection', syn: ['whooping cough', 'malignant pertussis'] },
  { code: 'MEASLES', label: 'Measles with complications', icd10: 'B05.9', category: 'Infection', syn: ['rubeola'] },
  { code: 'VARICELLA', label: 'Varicella with complications', icd10: 'B01.8', category: 'Infection', syn: ['chickenpox', 'chicken pox'] },
  { code: 'INFLUENZA', label: 'Influenza (severe)', icd10: 'J11.1', category: 'Infection', syn: ['flu', 'h1n1'] },
  { code: 'COVID19', label: 'COVID-19', icd10: 'U07.1', category: 'Infection', syn: ['sars-cov-2', 'coronavirus'] },
  { code: 'TB_DISSEMINATED', label: 'Disseminated / miliary tuberculosis', icd10: 'A19.9', category: 'Infection', syn: ['miliary tb', 'tuberculosis'] },
  { code: 'HIV_OI', label: 'HIV with opportunistic infection', icd10: 'B24', category: 'Infection', syn: ['aids', 'pcp', 'pneumocystis'] },
  { code: 'FUNGAL_INVASIVE', label: 'Invasive fungal infection / candidaemia', icd10: 'B37.7', category: 'Infection', syn: ['candida', 'aspergillosis', 'fungaemia'] },
  { code: 'NEC_FASCIITIS', label: 'Necrotising fasciitis', icd10: 'M72.6', category: 'Infection', syn: ['necrotizing fasciitis', 'flesh eating'] },
  { code: 'OSTEOMYELITIS', label: 'Osteomyelitis / septic arthritis', icd10: 'M86.9', category: 'Infection', syn: ['bone infection', 'septic joint'] },
  { code: 'DEEP_NECK', label: 'Deep neck infection / retropharyngeal abscess', icd10: 'J39.0', category: 'Infection', syn: ['retropharyngeal', 'parapharyngeal', 'ludwig angina', 'peritonsillar'] },
  { code: 'UROSEPSIS', label: 'Urinary tract infection / urosepsis', icd10: 'N39.0', category: 'Infection', syn: ['uti', 'pyelonephritis'] },
  { code: 'PERITONITIS', label: 'Peritonitis / intra-abdominal sepsis', icd10: 'K65.9', category: 'Infection', syn: ['abdominal sepsis', 'perforation'] },
  { code: 'ENDOCARDITIS', label: 'Infective endocarditis', icd10: 'I33.0', category: 'Infection', syn: ['ie', 'sbe'] },
  { code: 'CNS_ABSCESS', label: 'Brain abscess / subdural empyema', icd10: 'G06.0', category: 'Infection', syn: ['cerebral abscess', 'empyema subdural'] },
  { code: 'RABIES', label: 'Rabies', icd10: 'A82.9', category: 'Infection', syn: ['dog bite', 'hydrophobia'] },
  // Respiratory
  { code: 'PNEUMONIA', label: 'Pneumonia', icd10: 'J18.9', category: 'Respiratory', syn: ['lrti', 'cap', 'bronchopneumonia', 'chest infection'] },
  { code: 'SEVERE_PNEUMONIA', label: 'Severe pneumonia', icd10: 'J18.9', category: 'Respiratory', syn: ['severe lrti'] },
  { code: 'ASPIRATION_PNEUMONIA', label: 'Aspiration pneumonia / pneumonitis', icd10: 'J69.0', category: 'Respiratory', syn: ['aspiration', 'hydrocarbon pneumonitis'] },
  { code: 'BRONCHIOLITIS', label: 'Bronchiolitis', icd10: 'J21.9', category: 'Respiratory', syn: ['rsv', 'hmpv'], pim3: 'low' },
  { code: 'ASTHMA', label: 'Acute severe asthma', icd10: 'J46', category: 'Respiratory', syn: ['status asthmaticus', 'wheeze', 'reactive airway'], pim3: 'low' },
  { code: 'CROUP', label: 'Croup / upper airway obstruction', icd10: 'J05.0', category: 'Respiratory', syn: ['laryngotracheobronchitis', 'uao', 'stridor'], pim3: 'low' },
  { code: 'EPIGLOTTITIS', label: 'Epiglottitis', icd10: 'J05.1', category: 'Respiratory', syn: ['supraglottitis'] },
  { code: 'TRACHEITIS', label: 'Bacterial tracheitis', icd10: 'J04.1', category: 'Respiratory', syn: ['membranous croup'] },
  { code: 'OSA', label: 'Obstructive sleep apnoea / post adenotonsillectomy', icd10: 'G47.3', category: 'Respiratory', syn: ['osa', 'adenotonsillectomy', 'tonsillectomy'], pim3: 'low' },
  { code: 'AIRWAY_OTHER', label: 'Airway obstruction — subglottic stenosis / malacia', icd10: 'J38.6', category: 'Respiratory', syn: ['laryngomalacia', 'tracheomalacia', 'subglottic stenosis', 'difficult airway'] },
  { code: 'TRACHEOSTOMY', label: 'Tracheostomy problem (blocked / displaced)', icd10: 'J95.0', category: 'Respiratory', syn: ['trachy', 'decannulation'] },
  { code: 'FOREIGN_BODY', label: 'Foreign body aspiration', icd10: 'T17.9', category: 'Respiratory', syn: ['fb', 'inhaled foreign body'] },
  { code: 'ARDS', label: 'ARDS', icd10: 'J80', category: 'Respiratory', syn: ['pards'] },
  { code: 'RESP_FAILURE', label: 'Acute respiratory failure (other cause)', icd10: 'J96.0', category: 'Respiratory', syn: ['type 1 respiratory failure', 'type 2 respiratory failure', 'hypercapnia'] },
  { code: 'EMPYEMA', label: 'Empyema', icd10: 'J86.9', category: 'Respiratory', syn: ['pleural effusion infected'] },
  { code: 'PLEURAL_EFFUSION', label: 'Pleural effusion / chylothorax', icd10: 'J90', category: 'Respiratory', syn: ['chylothorax', 'hydrothorax'] },
  { code: 'PNEUMOTHORAX', label: 'Pneumothorax / air leak', icd10: 'J93.9', category: 'Respiratory', syn: ['air leak', 'pneumomediastinum'] },
  { code: 'LUNG_ABSCESS', label: 'Lung abscess / necrotising pneumonia', icd10: 'J85.2', category: 'Respiratory', syn: ['necrotizing pneumonia', 'cavitating'] },
  { code: 'PULM_HAEMORRHAGE', label: 'Pulmonary haemorrhage', icd10: 'R04.8', category: 'Respiratory', syn: ['haemoptysis', 'hemoptysis'] },
  { code: 'PE', label: 'Pulmonary embolism', icd10: 'I26.9', category: 'Respiratory', syn: ['pulmonary embolus'] },
  { code: 'CHRONIC_LUNG', label: 'Chronic lung disease / BPD exacerbation', icd10: 'P27.1', category: 'Respiratory', syn: ['bpd', 'bronchopulmonary dysplasia', 'cld'] },
  { code: 'CF', label: 'Cystic fibrosis exacerbation', icd10: 'E84.0', category: 'Respiratory', syn: ['cf', 'mucoviscidosis'] },
  { code: 'NEUROMUSCULAR_RESP', label: 'Respiratory failure in neuromuscular disease', icd10: 'G71.9', category: 'Respiratory', syn: ['sma', 'duchenne', 'dmd', 'myopathy'] },
  { code: 'HOME_VENT', label: 'Long-term ventilated child (acute deterioration)', icd10: 'Z99.1', category: 'Respiratory', syn: ['home ventilation', 'ltv', 'bipap dependent'] },
  // Cardiovascular / shock
  { code: 'SHOCK_HYPOVOLAEMIC', label: 'Hypovolaemic shock / severe dehydration', icd10: 'R57.1', category: 'Cardiovascular', syn: ['dehydration', 'age with shock', 'gastroenteritis shock'] },
  { code: 'CARDIOGENIC_SHOCK', label: 'Cardiogenic shock', icd10: 'R57.0', category: 'Cardiovascular', syn: ['low cardiac output'] },
  { code: 'MYOCARDITIS', label: 'Myocarditis', icd10: 'I40.9', category: 'Cardiovascular', pim3: 'high' },
  { code: 'HEART_FAILURE', label: 'Heart failure / cardiomyopathy', icd10: 'I50.9', category: 'Cardiovascular', syn: ['dcm', 'dilated cardiomyopathy', 'hcm', 'ccf'], pim3: 'high' },
  { code: 'CHD', label: 'Congenital heart disease (decompensated)', icd10: 'Q24.9', category: 'Cardiovascular', syn: ['chd', 'cyanotic', 'acyanotic', 'vsd', 'avsd'] },
  { code: 'TOF_SPELL', label: 'Tetralogy of Fallot / hypercyanotic spell', icd10: 'Q21.3', category: 'Cardiovascular', syn: ['tet spell', 'cyanotic spell', 'tof'] },
  { code: 'HLHS', label: 'Hypoplastic left heart syndrome', icd10: 'Q23.4', category: 'Cardiovascular', syn: ['hlhs', 'single ventricle', 'norwood'], pim3: 'high' },
  { code: 'DUCT_DEPENDENT', label: 'Duct-dependent lesion (TGA, coarctation, critical AS)', icd10: 'Q25.1', category: 'Cardiovascular', syn: ['tga', 'coarctation', 'interrupted arch', 'pda dependent', 'prostaglandin'] },
  { code: 'ARRHYTHMIA', label: 'Arrhythmia (SVT etc.)', icd10: 'I49.9', category: 'Cardiovascular', syn: ['svt', 'tachyarrhythmia'] },
  { code: 'VT', label: 'Ventricular tachycardia / fibrillation', icd10: 'I47.2', category: 'Cardiovascular', syn: ['vf', 'long qt'] },
  { code: 'HEART_BLOCK', label: 'Complete heart block / bradyarrhythmia', icd10: 'I44.2', category: 'Cardiovascular', syn: ['chb', 'pacing', 'bradycardia'] },
  { code: 'PULM_HTN', label: 'Pulmonary hypertensive crisis', icd10: 'I27.2', category: 'Cardiovascular', syn: ['pulmonary hypertension', 'ph crisis', 'pah'] },
  { code: 'PERICARDIAL', label: 'Pericardial effusion / tamponade', icd10: 'I31.9', category: 'Cardiovascular', syn: ['tamponade', 'pericarditis'] },
  { code: 'RHEUMATIC', label: 'Acute rheumatic fever / rheumatic heart disease', icd10: 'I01.9', category: 'Cardiovascular', syn: ['rhd', 'carditis', 'mitral regurgitation'] },
  { code: 'HYPERTENSIVE', label: 'Hypertensive emergency / encephalopathy', icd10: 'I67.4', category: 'Cardiovascular', syn: ['hypertensive crisis', 'malignant hypertension', 'pres'] },
  { code: 'KAWASAKI', label: 'Kawasaki disease (with shock or aneurysm)', icd10: 'M30.3', category: 'Cardiovascular', syn: ['mucocutaneous lymph node'] },
  { code: 'MISC', label: 'MIS-C / Kawasaki shock', icd10: 'M30.3', category: 'Cardiovascular', syn: ['pims', 'pims-ts', 'multisystem inflammatory'] },
  // Neuro
  { code: 'STATUS_EPILEPTICUS', label: 'Status epilepticus', icd10: 'G41.9', category: 'Neuro', syn: ['se', 'convulsions', 'refractory status'], pim3: 'low' },
  { code: 'SEIZURES', label: 'Seizures / epilepsy (not status)', icd10: 'G40.9', category: 'Neuro', syn: ['seizure disorder', 'epilepsy', 'fits', 'febrile seizure'], pim3: 'low' },
  { code: 'MENINGITIS', label: 'Bacterial meningitis', icd10: 'G00.9', category: 'Neuro', syn: ['meningitis', 'pyogenic meningitis'] },
  { code: 'VIRAL_MENINGITIS', label: 'Viral meningitis', icd10: 'A87.9', category: 'Neuro', syn: ['aseptic meningitis'] },
  { code: 'TBM', label: 'Tuberculous meningitis', icd10: 'A17.0', category: 'Neuro', syn: ['tbm', 'tb meningitis'] },
  { code: 'ENCEPHALITIS', label: 'Encephalitis', icd10: 'G04.9', category: 'Neuro', syn: ['viral encephalitis', 'aes', 'acute encephalitis syndrome'] },
  { code: 'HSV_ENCEPHALITIS', label: 'Herpes simplex encephalitis', icd10: 'B00.4', category: 'Neuro', syn: ['hsv'] },
  { code: 'JE', label: 'Japanese encephalitis', icd10: 'A83.0', category: 'Neuro', syn: ['je'] },
  { code: 'AUTOIMMUNE_ENCEPH', label: 'Autoimmune encephalitis (e.g. anti-NMDA receptor)', icd10: 'G04.8', category: 'Neuro', syn: ['nmda', 'anti-nmdar'] },
  { code: 'ADEM', label: 'ADEM', icd10: 'G04.0', category: 'Neuro', syn: ['acute disseminated encephalomyelitis', 'demyelination'] },
  { code: 'TRANSVERSE_MYELITIS', label: 'Transverse myelitis / acute flaccid myelitis', icd10: 'G37.3', category: 'Neuro', syn: ['afm', 'myelitis'] },
  { code: 'GBS', label: 'Guillain–Barré syndrome', icd10: 'G61.0', category: 'Neuro', syn: ['gbs', 'aidp', 'guillain barre', 'afp'] },
  { code: 'MYASTHENIA', label: 'Myasthenic crisis', icd10: 'G70.0', category: 'Neuro', syn: ['myasthenia gravis'] },
  { code: 'BOTULISM', label: 'Botulism', icd10: 'A05.1', category: 'Neuro', syn: ['infant botulism'] },
  { code: 'HIE', label: 'Hypoxic-ischaemic encephalopathy', icd10: 'G93.1', category: 'Neuro', syn: ['hie', 'anoxic brain injury', 'post arrest'] },
  { code: 'RAISED_ICP', label: 'Raised ICP / cerebral oedema', icd10: 'G93.6', category: 'Neuro', syn: ['intracranial hypertension', 'cerebral edema'] },
  { code: 'ICH', label: 'Spontaneous intracranial haemorrhage', icd10: 'I61.9', category: 'Neuro', syn: ['avm', 'haemorrhagic stroke', 'aneurysm', 'bleed'], pim3: 'high' },
  { code: 'STROKE', label: 'Arterial ischaemic stroke', icd10: 'I63.9', category: 'Neuro', syn: ['cva', 'infarct', 'moyamoya'] },
  { code: 'CVST', label: 'Cerebral venous sinus thrombosis', icd10: 'I67.6', category: 'Neuro', syn: ['sinovenous thrombosis'] },
  { code: 'SHUNT', label: 'Hydrocephalus / shunt malfunction', icd10: 'G91.9', category: 'Neuro', syn: ['vp shunt', 'blocked shunt', 'evd'] },
  { code: 'NEURODEGENERATIVE', label: 'Neurodegenerative disorder (deterioration)', icd10: 'G31.9', category: 'Neuro', syn: ['leukodystrophy', 'batten', 'metachromatic'], pim3: 'high' },
  { code: 'COMA', label: 'Coma / decreased consciousness (cause unclear)', icd10: 'R40.2', category: 'Neuro', syn: ['unconscious', 'altered sensorium', 'gcs'] },
  // Endocrine / metabolic
  { code: 'DKA', label: 'Diabetic ketoacidosis', icd10: 'E10.1', category: 'Endocrine', syn: ['dka', 'ketoacidosis'], pim3: 'low' },
  { code: 'HHS', label: 'Hyperosmolar hyperglycaemic state', icd10: 'E11.0', category: 'Endocrine', syn: ['hhs', 'hhns', 'hyperosmolar'] },
  { code: 'HYPOGLYCAEMIA', label: 'Severe hypoglycaemia / hyperinsulinism', icd10: 'E16.2', category: 'Endocrine', syn: ['hypoglycemia', 'hyperinsulinism'] },
  { code: 'IEM', label: 'Inborn error of metabolism (crisis)', icd10: 'E88.9', category: 'Endocrine', syn: ['metabolic crisis', 'organic acidaemia', 'msud'] },
  { code: 'HYPERAMMONAEMIA', label: 'Hyperammonaemia / urea cycle disorder', icd10: 'E72.2', category: 'Endocrine', syn: ['ammonia', 'urea cycle', 'otc deficiency'] },
  { code: 'ADRENAL_CRISIS', label: 'Adrenal crisis', icd10: 'E27.2', category: 'Endocrine', syn: ['cah', 'addisonian', 'salt wasting'] },
  { code: 'DI', label: 'Diabetes insipidus', icd10: 'E23.2', category: 'Endocrine', syn: ['central di', 'polyuria'] },
  { code: 'SIADH', label: 'SIADH / cerebral salt wasting', icd10: 'E22.2', category: 'Endocrine', syn: ['salt wasting', 'csw'] },
  { code: 'SODIUM', label: 'Severe hypo- or hypernatraemia', icd10: 'E87.1', category: 'Endocrine', syn: ['hyponatremia', 'hypernatremia', 'sodium'] },
  { code: 'POTASSIUM', label: 'Severe hyper- or hypokalaemia', icd10: 'E87.5', category: 'Endocrine', syn: ['hyperkalemia', 'hypokalemia', 'potassium'] },
  { code: 'CALCIUM', label: 'Severe hypocalcaemia / hypercalcaemia', icd10: 'E83.5', category: 'Endocrine', syn: ['hypocalcemia', 'tetany', 'calcium'] },
  { code: 'THYROID_STORM', label: 'Thyroid storm', icd10: 'E05.5', category: 'Endocrine', syn: ['thyrotoxic crisis'] },
  { code: 'MITOCHONDRIAL', label: 'Mitochondrial disease (crisis)', icd10: 'E88.4', category: 'Endocrine', syn: ['leigh', 'lactic acidosis'] },
  // Renal
  { code: 'AKI', label: 'Acute kidney injury', icd10: 'N17.9', category: 'Renal', syn: ['aki', 'arf'] },
  { code: 'CKD', label: 'Chronic kidney disease / ESRD (decompensated)', icd10: 'N18.5', category: 'Renal', syn: ['esrd', 'dialysis', 'ckd'] },
  { code: 'NEPHROTIC', label: 'Nephrotic syndrome (complicated)', icd10: 'N04.9', category: 'Renal' },
  { code: 'GN', label: 'Acute glomerulonephritis', icd10: 'N00.9', category: 'Renal', syn: ['psgn', 'nephritic'] },
  { code: 'HUS', label: 'Haemolytic uraemic syndrome', icd10: 'D59.3', category: 'Renal', syn: ['hus', 'stec'] },
  { code: 'RHABDO', label: 'Rhabdomyolysis', icd10: 'M62.8', category: 'Renal', syn: ['myoglobinuria', 'ck'] },
  { code: 'RENAL_TX', label: 'Kidney transplant recipient (complication)', icd10: 'Z94.0', category: 'Renal', syn: ['renal transplant'] },
  // GI / hepatic
  { code: 'ALF', label: 'Acute liver failure', icd10: 'K72.0', category: 'GI/Hepatic', syn: ['fulminant hepatic failure', 'hepatic encephalopathy'], pim3: 'very_high' },
  { code: 'CHRONIC_LIVER', label: 'Chronic liver disease (decompensated)', icd10: 'K72.1', category: 'GI/Hepatic', syn: ['cirrhosis', 'biliary atresia', 'portal hypertension'] },
  { code: 'LIVER_TX', label: 'Liver transplant recipient (complication)', icd10: 'Z94.4', category: 'GI/Hepatic', syn: ['liver transplant'] },
  { code: 'GI_BLEED', label: 'Upper GI bleed', icd10: 'K92.2', category: 'GI/Hepatic', syn: ['haematemesis', 'varices', 'melaena'] },
  { code: 'LOWER_GI_BLEED', label: 'Lower GI bleed', icd10: 'K92.2', category: 'GI/Hepatic', syn: ['meckel', 'haematochezia'] },
  { code: 'PANCREATITIS', label: 'Acute pancreatitis', icd10: 'K85.9', category: 'GI/Hepatic' },
  { code: 'GASTROENTERITIS', label: 'Acute gastroenteritis (severe)', icd10: 'A09', category: 'GI/Hepatic', syn: ['age', 'diarrhoea', 'cholera'] },
  { code: 'INTESTINAL_OBSTRUCTION', label: 'Intestinal obstruction / intussusception / volvulus', icd10: 'K56.6', category: 'GI/Hepatic', syn: ['intussusception', 'volvulus', 'malrotation', 'bowel obstruction'] },
  { code: 'HIRSCHSPRUNG', label: 'Hirschsprung enterocolitis', icd10: 'Q43.1', category: 'GI/Hepatic' },
  { code: 'ACUTE_ABDOMEN', label: 'Acute abdomen / perforated appendix', icd10: 'K35.2', category: 'GI/Hepatic', syn: ['appendicitis', 'perforation'] },
  // Haematology / oncology
  { code: 'FEBRILE_NEUTROPENIA', label: 'Febrile neutropenia', icd10: 'D70', category: 'Haem/Onc', syn: ['neutropenic sepsis'] },
  { code: 'TUMOUR_LYSIS', label: 'Tumour lysis / oncology emergency', icd10: 'E88.3', category: 'Haem/Onc', syn: ['tls', 'hyperleukocytosis'] },
  { code: 'LEUKAEMIA', label: 'Acute leukaemia / lymphoma (critically ill)', icd10: 'C95.0', category: 'Haem/Onc', syn: ['all', 'aml', 'lymphoma', 'blasts'] },
  { code: 'MEDIASTINAL_MASS', label: 'Anterior mediastinal mass', icd10: 'J98.5', category: 'Haem/Onc', syn: ['svc obstruction', 'superior mediastinal syndrome'] },
  { code: 'SOLID_TUMOUR', label: 'Solid tumour (critically ill)', icd10: 'C80.9', category: 'Haem/Onc', syn: ['neuroblastoma', 'wilms', 'cancer'] },
  { code: 'BRAIN_TUMOUR', label: 'Brain tumour', icd10: 'C71.9', category: 'Haem/Onc', syn: ['medulloblastoma', 'glioma', 'posterior fossa'] },
  { code: 'HSCT', label: 'Bone-marrow / stem-cell transplant recipient', icd10: 'Z94.8', category: 'Haem/Onc', syn: ['bmt', 'hsct', 'gvhd'], pim3: 'very_high' },
  { code: 'SEVERE_ANAEMIA', label: 'Severe anaemia / haemolytic crisis', icd10: 'D64.9', category: 'Haem/Onc', syn: ['thalassaemia', 'g6pd', 'haemolysis'] },
  { code: 'SICKLE', label: 'Sickle cell crisis / acute chest syndrome', icd10: 'D57.0', category: 'Haem/Onc', syn: ['acute chest', 'scd', 'vaso-occlusive'] },
  { code: 'BLEEDING_DISORDER', label: 'Haemophilia / bleeding disorder with bleed', icd10: 'D66', category: 'Haem/Onc', syn: ['haemophilia', 'von willebrand', 'itp'] },
  { code: 'DIC', label: 'Disseminated intravascular coagulation', icd10: 'D65', category: 'Haem/Onc', syn: ['coagulopathy'] },
  { code: 'TTP', label: 'Thrombotic microangiopathy / TTP', icd10: 'M31.1', category: 'Haem/Onc', syn: ['tma', 'ttp'] },
  { code: 'HLH', label: 'HLH', icd10: 'D76.1', category: 'Haem/Onc', syn: ['macrophage activation', 'mas'] },
  // Immunology / rheumatology / skin
  { code: 'ANAPHYLAXIS', label: 'Anaphylaxis', icd10: 'T78.2', category: 'Immunology', syn: ['allergic reaction', 'angioedema'] },
  { code: 'SCID', label: 'Severe combined immunodeficiency', icd10: 'D81.9', category: 'Immunology', syn: ['scid', 'immunodeficiency'], pim3: 'very_high' },
  { code: 'IMMUNODEFICIENCY', label: 'Primary immunodeficiency (other)', icd10: 'D84.9', category: 'Immunology', syn: ['cgd', 'pid'] },
  { code: 'SLE', label: 'Systemic lupus erythematosus (crisis)', icd10: 'M32.9', category: 'Immunology', syn: ['lupus', 'lupus nephritis'] },
  { code: 'VASCULITIS', label: 'Vasculitis (other)', icd10: 'M31.9', category: 'Immunology', syn: ['takayasu', 'pan', 'hsp'] },
  { code: 'SJS_TEN', label: 'Stevens–Johnson syndrome / TEN', icd10: 'L51.2', category: 'Immunology', syn: ['sjs', 'ten', 'toxic epidermal necrolysis', 'dress'] },
  // Neonatal (admitted to PICU)
  { code: 'NEONATAL_SEPSIS', label: 'Neonatal sepsis', icd10: 'P36.9', category: 'Neonatal', syn: ['early onset sepsis', 'late onset sepsis'] },
  { code: 'NEONATAL_JAUNDICE', label: 'Severe neonatal jaundice (exchange transfusion)', icd10: 'P59.9', category: 'Neonatal', syn: ['hyperbilirubinaemia', 'kernicterus'] },
  { code: 'NEC', label: 'Necrotising enterocolitis', icd10: 'P77', category: 'Neonatal', syn: ['necrotizing enterocolitis'], pim3: 'high' },
  { code: 'CDH', label: 'Congenital diaphragmatic hernia', icd10: 'Q79.0', category: 'Neonatal', syn: ['cdh'] },
  { code: 'OA_TOF', label: 'Oesophageal atresia / tracheo-oesophageal fistula', icd10: 'Q39.1', category: 'Neonatal', syn: ['tef', 'oa'] },
  { code: 'ABDO_WALL', label: 'Gastroschisis / exomphalos', icd10: 'Q79.3', category: 'Neonatal', syn: ['omphalocele', 'exomphalos'] },
  { code: 'PPHN', label: 'Persistent pulmonary hypertension of the newborn', icd10: 'P29.3', category: 'Neonatal', syn: ['pphn'] },
  { code: 'PREMATURITY', label: 'Ex-preterm infant with complications', icd10: 'P07.3', category: 'Neonatal', syn: ['preterm', 'apnoea of prematurity'] },
  // Trauma / environmental
  { code: 'TBI', label: 'Traumatic brain injury', icd10: 'S06.9', category: 'Trauma', syn: ['head injury', 'edh', 'sdh', 'fall'] },
  { code: 'POLYTRAUMA', label: 'Polytrauma', icd10: 'T07', category: 'Trauma', syn: ['rta', 'road traffic accident'] },
  { code: 'SPINAL_INJURY', label: 'Spinal cord injury', icd10: 'T09.3', category: 'Trauma', syn: ['cervical spine', 'sciwora'] },
  { code: 'CHEST_TRAUMA', label: 'Chest trauma', icd10: 'S29.9', category: 'Trauma', syn: ['haemothorax', 'pulmonary contusion', 'flail'] },
  { code: 'ABDO_TRAUMA', label: 'Abdominal trauma (liver / spleen / bowel)', icd10: 'S36.9', category: 'Trauma', syn: ['splenic injury', 'liver laceration'] },
  { code: 'NAI', label: 'Suspected non-accidental injury', icd10: 'T74.1', category: 'Trauma', syn: ['child abuse', 'abusive head trauma', 'shaken baby'] },
  { code: 'BURNS', label: 'Burns', icd10: 'T30.0', category: 'Trauma', syn: ['scald', 'inhalation injury'] },
  { code: 'DROWNING', label: 'Drowning', icd10: 'T75.1', category: 'Trauma', syn: ['near drowning', 'submersion'] },
  { code: 'HANGING', label: 'Hanging / strangulation', icd10: 'T71', category: 'Trauma', syn: ['asphyxia', 'suffocation'] },
  { code: 'ELECTRIC', label: 'Electrical injury / lightning', icd10: 'T75.4', category: 'Trauma', syn: ['electrocution'] },
  { code: 'HEAT_STROKE', label: 'Heat stroke', icd10: 'T67.0', category: 'Trauma', syn: ['hyperthermia'] },
  { code: 'HYPOTHERMIA', label: 'Accidental hypothermia', icd10: 'T68', category: 'Trauma' },
  // Toxicology
  { code: 'POISONING', label: 'Poisoning / ingestion', icd10: 'T65.9', category: 'Toxicology', syn: ['overdose', 'ingestion'] },
  { code: 'ORGANOPHOSPHATE', label: 'Organophosphate / carbamate poisoning', icd10: 'T60.0', category: 'Toxicology', syn: ['op poisoning', 'pesticide', 'insecticide'] },
  { code: 'HYDROCARBON', label: 'Hydrocarbon / kerosene ingestion', icd10: 'T52.0', category: 'Toxicology', syn: ['kerosene', 'paraffin', 'petrol'] },
  { code: 'PARACETAMOL', label: 'Paracetamol (acetaminophen) poisoning', icd10: 'T39.1', category: 'Toxicology', syn: ['acetaminophen', 'tylenol'] },
  { code: 'IRON', label: 'Iron poisoning', icd10: 'T45.4', category: 'Toxicology' },
  { code: 'TCA', label: 'Tricyclic / cardiotoxic drug poisoning', icd10: 'T43.0', category: 'Toxicology', syn: ['tricyclic', 'calcium channel blocker', 'beta blocker'] },
  { code: 'CO_POISONING', label: 'Carbon monoxide poisoning', icd10: 'T58', category: 'Toxicology', syn: ['smoke inhalation', 'co'] },
  { code: 'CORROSIVE', label: 'Corrosive ingestion / button battery', icd10: 'T54.9', category: 'Toxicology', syn: ['caustic', 'acid', 'alkali', 'button battery'] },
  { code: 'SNAKEBITE', label: 'Envenomation (snake / scorpion)', icd10: 'T63.0', category: 'Toxicology', syn: ['snake bite', 'scorpion sting', 'envenoming'] },
  // Surgical / post-operative
  { code: 'POSTOP', label: 'Post-operative care', icd10: 'Z48.8', category: 'Surgical', syn: ['post op', 'elective surgery'] },
  { code: 'POSTOP_CARDIAC', label: 'Post cardiac surgery', icd10: 'Z48.8', category: 'Surgical', syn: ['bypass', 'cardiac surgery'] },
  { code: 'POSTOP_NEURO', label: 'Post neurosurgery', icd10: 'Z48.8', category: 'Surgical', syn: ['craniotomy', 'tumour resection'] },
  { code: 'POSTOP_SPINE', label: 'Post spinal surgery (scoliosis)', icd10: 'Z48.8', category: 'Surgical', syn: ['scoliosis', 'spinal fusion'] },
  { code: 'POSTOP_AIRWAY', label: 'Post airway / ENT surgery', icd10: 'Z48.8', category: 'Surgical', syn: ['laryngotracheal reconstruction', 'tracheostomy insertion'] },
  { code: 'POSTOP_ABDO', label: 'Post abdominal surgery', icd10: 'Z48.8', category: 'Surgical', syn: ['laparotomy'] },
  { code: 'POSTOP_TRANSPLANT', label: 'Post organ transplant surgery', icd10: 'Z48.8', category: 'Surgical', syn: ['liver transplant', 'kidney transplant'] },
  { code: 'POSTOP_CRANIOFACIAL', label: 'Post craniofacial surgery', icd10: 'Z48.8', category: 'Surgical', syn: ['craniosynostosis', 'cleft'] },
  // Nutrition
  { code: 'SAM', label: 'Severe acute malnutrition (complicated)', icd10: 'E43', category: 'Nutrition', syn: ['sam', 'marasmus', 'kwashiorkor'] },
  { code: 'REFEEDING', label: 'Refeeding syndrome', icd10: 'E87.8', category: 'Nutrition', syn: ['hypophosphataemia'] },
  // Other
  { code: 'CARDIAC_ARREST', label: 'Post cardiac arrest (ROSC)', icd10: 'I46.9', category: 'Other', syn: ['rosc', 'cpr', 'out of hospital arrest'], pim3: 'very_high' },
  { code: 'BRUE', label: 'Apparent life-threatening event / BRUE', icd10: 'R68.8', category: 'Other', syn: ['alte', 'brue', 'apnoea'] },
  { code: 'PALLIATIVE', label: 'Palliative / end-of-life care', icd10: 'Z51.5', category: 'Other', syn: ['end of life', 'comfort care'] },
  { code: 'OTHER', label: 'Other (specify in notes)', icd10: 'R69', category: 'Other' },
];

export const DX_BY_CODE: Record<string, DxEntry> = Object.fromEntries(DX_CATALOGUE.map(d => [d.code, d]));
export const dxLabel = (code: string | null | undefined) => (code && DX_BY_CODE[code]?.label) || code || '—';

/** Simple ranked search over label, code, ICD-10 and synonyms. */
export function searchDx(query: string, recent: string[] = []): DxEntry[] {
  const q = query.trim().toLowerCase();
  const recentRank = (code: string) => { const i = recent.indexOf(code); return i === -1 ? 999 : i; };
  if (!q) return [...DX_CATALOGUE].sort((a, b) => recentRank(a.code) - recentRank(b.code)).slice(0, 12);
  const scored = DX_CATALOGUE.map(d => {
    const hay = [d.label, d.code, d.icd10, ...(d.syn ?? [])].map(s => s.toLowerCase());
    let score = -1;
    if (hay.some(h => h === q)) score = 100;
    else if (hay.some(h => h.startsWith(q))) score = 60;
    else if (hay.some(h => h.split(/[\s/()-]+/).some(w => w.startsWith(q)))) score = 40;
    else if (hay.some(h => h.includes(q))) score = 20;
    return { d, score: score < 0 ? -1 : score + Math.max(0, 10 - recentRank(d.code)) };
  }).filter(x => x.score >= 0);
  return scored.sort((a, b) => b.score - a.score).map(x => x.d).slice(0, 12);
}
