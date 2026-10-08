// ═══════════════════════════════════════════════════════════
//  Clinical reference data.
//  Antibiotic classes, organisms and specimen types are ported verbatim
//  from the original Antibiome web app (../app.js) so antibiograms and
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
// Local PICU list mapped to ICD-10. `syn` feeds the autocomplete.

export interface DxEntry { code: string; label: string; icd10: string; category: string; syn?: string[] }

export const DX_CATALOGUE: DxEntry[] = [
  // Infection / sepsis
  { code: 'SEPSIS', label: 'Sepsis', icd10: 'A41.9', category: 'Infection', syn: ['septicaemia', 'septicemia'] },
  { code: 'SEPTIC_SHOCK', label: 'Septic shock', icd10: 'R65.21', category: 'Infection', syn: ['shock septic'] },
  { code: 'MENINGITIS', label: 'Bacterial meningitis', icd10: 'G00.9', category: 'Neuro', syn: ['meningitis', 'pyogenic meningitis'] },
  { code: 'TBM', label: 'Tuberculous meningitis', icd10: 'A17.0', category: 'Neuro', syn: ['tbm', 'tb meningitis'] },
  { code: 'ENCEPHALITIS', label: 'Encephalitis', icd10: 'G04.9', category: 'Neuro', syn: ['viral encephalitis', 'aes', 'acute encephalitis syndrome'] },
  { code: 'DENGUE', label: 'Dengue (severe / with warning signs)', icd10: 'A91', category: 'Infection', syn: ['dhf', 'dss', 'dengue shock'] },
  { code: 'MALARIA', label: 'Severe malaria', icd10: 'B50.9', category: 'Infection', syn: ['cerebral malaria'] },
  { code: 'TYPHOID', label: 'Enteric fever', icd10: 'A01.0', category: 'Infection', syn: ['typhoid'] },
  { code: 'DIPHTHERIA', label: 'Diphtheria', icd10: 'A36.9', category: 'Infection' },
  { code: 'TETANUS', label: 'Tetanus', icd10: 'A35', category: 'Infection' },
  { code: 'MEASLES', label: 'Measles with complications', icd10: 'B05.9', category: 'Infection' },
  // Respiratory
  { code: 'PNEUMONIA', label: 'Pneumonia', icd10: 'J18.9', category: 'Respiratory', syn: ['lrti', 'cap', 'bronchopneumonia', 'chest infection'] },
  { code: 'SEVERE_PNEUMONIA', label: 'Severe pneumonia', icd10: 'J18.9', category: 'Respiratory', syn: ['severe lrti'] },
  { code: 'BRONCHIOLITIS', label: 'Bronchiolitis', icd10: 'J21.9', category: 'Respiratory', syn: ['rsv'] },
  { code: 'ASTHMA', label: 'Acute severe asthma', icd10: 'J46', category: 'Respiratory', syn: ['status asthmaticus', 'wheeze'] },
  { code: 'ARDS', label: 'ARDS', icd10: 'J80', category: 'Respiratory', syn: ['pards'] },
  { code: 'EMPYEMA', label: 'Empyema', icd10: 'J86.9', category: 'Respiratory', syn: ['pleural effusion infected'] },
  { code: 'CROUP', label: 'Croup / upper airway obstruction', icd10: 'J05.0', category: 'Respiratory', syn: ['laryngotracheobronchitis', 'uao'] },
  { code: 'FOREIGN_BODY', label: 'Foreign body aspiration', icd10: 'T17.9', category: 'Respiratory' },
  // Neuro
  { code: 'STATUS_EPILEPTICUS', label: 'Status epilepticus', icd10: 'G41.9', category: 'Neuro', syn: ['se', 'seizures', 'convulsions'] },
  { code: 'GBS', label: 'Guillain–Barré syndrome', icd10: 'G61.0', category: 'Neuro', syn: ['gbs', 'aidp', 'guillain barre', 'afp'] },
  { code: 'HIE', label: 'Hypoxic-ischaemic encephalopathy', icd10: 'G93.1', category: 'Neuro', syn: ['hie', 'anoxic brain injury', 'post arrest'] },
  { code: 'RAISED_ICP', label: 'Raised ICP / cerebral oedema', icd10: 'G93.6', category: 'Neuro' },
  { code: 'MYASTHENIA', label: 'Myasthenic crisis', icd10: 'G70.0', category: 'Neuro' },
  { code: 'ADEM', label: 'ADEM', icd10: 'G04.0', category: 'Neuro' },
  // Endocrine / metabolic
  { code: 'DKA', label: 'Diabetic ketoacidosis', icd10: 'E10.1', category: 'Endocrine', syn: ['dka', 'ketoacidosis'] },
  { code: 'IEM', label: 'Inborn error of metabolism (crisis)', icd10: 'E88.9', category: 'Endocrine', syn: ['metabolic crisis', 'hyperammonaemia'] },
  { code: 'ADRENAL_CRISIS', label: 'Adrenal crisis', icd10: 'E27.2', category: 'Endocrine' },
  // Renal
  { code: 'AKI', label: 'Acute kidney injury', icd10: 'N17.9', category: 'Renal', syn: ['aki', 'arf'] },
  { code: 'NEPHROTIC', label: 'Nephrotic syndrome (complicated)', icd10: 'N04.9', category: 'Renal' },
  { code: 'HUS', label: 'Haemolytic uraemic syndrome', icd10: 'D59.3', category: 'Renal', syn: ['hus'] },
  // Cardiac / shock
  { code: 'SHOCK_HYPOVOLAEMIC', label: 'Hypovolaemic shock / severe dehydration', icd10: 'R57.1', category: 'Cardiovascular', syn: ['dehydration', 'age with shock', 'gastroenteritis shock'] },
  { code: 'MYOCARDITIS', label: 'Myocarditis', icd10: 'I40.9', category: 'Cardiovascular' },
  { code: 'CHD', label: 'Congenital heart disease (decompensated)', icd10: 'Q24.9', category: 'Cardiovascular', syn: ['chd', 'cyanotic spell'] },
  { code: 'HEART_FAILURE', label: 'Heart failure / cardiomyopathy', icd10: 'I50.9', category: 'Cardiovascular', syn: ['dcm'] },
  { code: 'ARRHYTHMIA', label: 'Arrhythmia (SVT etc.)', icd10: 'I49.9', category: 'Cardiovascular', syn: ['svt'] },
  { code: 'MISC', label: 'MIS-C / Kawasaki shock', icd10: 'M30.3', category: 'Cardiovascular' },
  // GI / hepatic
  { code: 'ALF', label: 'Acute liver failure', icd10: 'K72.0', category: 'GI/Hepatic', syn: ['fulminant hepatic failure', 'hepatic encephalopathy'] },
  { code: 'GI_BLEED', label: 'Upper GI bleed', icd10: 'K92.2', category: 'GI/Hepatic' },
  { code: 'PANCREATITIS', label: 'Acute pancreatitis', icd10: 'K85.9', category: 'GI/Hepatic' },
  // Haematology / oncology
  { code: 'TUMOUR_LYSIS', label: 'Tumour lysis / oncology emergency', icd10: 'E88.3', category: 'Haem/Onc' },
  { code: 'FEBRILE_NEUTROPENIA', label: 'Febrile neutropenia', icd10: 'D70', category: 'Haem/Onc' },
  { code: 'SEVERE_ANAEMIA', label: 'Severe anaemia / haemolytic crisis', icd10: 'D64.9', category: 'Haem/Onc', syn: ['sickle crisis', 'thalassaemia'] },
  { code: 'HLH', label: 'HLH', icd10: 'D76.1', category: 'Haem/Onc' },
  // Trauma / toxicology / surgical
  { code: 'TBI', label: 'Traumatic brain injury', icd10: 'S06.9', category: 'Trauma', syn: ['head injury'] },
  { code: 'POLYTRAUMA', label: 'Polytrauma', icd10: 'T07', category: 'Trauma', syn: ['rta'] },
  { code: 'BURNS', label: 'Burns', icd10: 'T30.0', category: 'Trauma' },
  { code: 'DROWNING', label: 'Drowning', icd10: 'T75.1', category: 'Trauma' },
  { code: 'POISONING', label: 'Poisoning / ingestion', icd10: 'T65.9', category: 'Toxicology', syn: ['organophosphate', 'kerosene', 'overdose'] },
  { code: 'SNAKEBITE', label: 'Envenomation (snake / scorpion)', icd10: 'T63.0', category: 'Toxicology', syn: ['snake bite', 'scorpion sting'] },
  { code: 'POSTOP', label: 'Post-operative care', icd10: 'Z48.8', category: 'Surgical', syn: ['post op', 'elective surgery'] },
  { code: 'POSTOP_CARDIAC', label: 'Post cardiac surgery', icd10: 'Z48.8', category: 'Surgical' },
  // Nutrition / other
  { code: 'SAM', label: 'Severe acute malnutrition (complicated)', icd10: 'E43', category: 'Nutrition', syn: ['sam', 'marasmus', 'kwashiorkor'] },
  { code: 'ANAPHYLAXIS', label: 'Anaphylaxis', icd10: 'T78.2', category: 'Other' },
  { code: 'CARDIAC_ARREST', label: 'Post cardiac arrest (ROSC)', icd10: 'I46.9', category: 'Other', syn: ['rosc', 'cpr'] },
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
