// ═══════════════════════════════════════════════════════════
//  MDR classification — v1, ported unchanged from ../app.js
//  (WHO/ECDC 2012-inspired, organism-group aware).
//  Known limitations are documented in docs/PICU_INTELLIGENCE_PLAN.md §5:
//  intrinsic resistance is not excluded and cephalosporins are one category.
//  Any change must ship as a new version, never edit v1 in place.
// ═══════════════════════════════════════════════════════════
import { DRUG_TO_CLASS } from './reference';

export const MDR_DEFINITION_VERSION = 'v1';

const GRAM_POSITIVE_SET = new Set([
  'staphylococcus aureus', 'staphylococcus epidermidis', 'staphylococcus haemolyticus',
  'coagulase-negative staphylococci', 'cons',
  'enterococcus faecalis', 'enterococcus faecium',
  'streptococcus agalactiae', 'streptococcus pneumoniae', 'streptococcus pyogenes',
  'streptococcus viridans', 'listeria monocytogenes',
]);
const GRAM_NEGATIVE_SET = new Set([
  'acinetobacter baumannii', 'burkholderia cepacia',
  'citrobacter freundii', 'citrobacter koseri',
  'enterobacter cloacae', 'enterobacter aerogenes', 'klebsiella aerogenes',
  'escherichia coli', 'haemophilus influenzae',
  'klebsiella oxytoca', 'klebsiella pneumoniae',
  'morganella morganii', 'proteus mirabilis', 'proteus vulgaris',
  'providencia stuartii', 'pseudomonas aeruginosa', 'salmonella',
  'serratia marcescens', 'stenotrophomonas maltophilia',
]);
const FUNGAL_SET = new Set([
  'candida albicans', 'candida auris', 'candida glabrata', 'candida krusei',
  'candida parapsilosis', 'candida tropicalis', 'aspergillus fumigatus',
]);

export type OrganismGroup = 'gram-positive' | 'gram-negative' | 'fungal' | 'unknown';

export function getOrganismGroup(organism: string | null | undefined): OrganismGroup {
  if (!organism) return 'unknown';
  const lc = organism.toLowerCase();
  for (const key of GRAM_POSITIVE_SET) { if (lc.includes(key)) return 'gram-positive'; }
  for (const key of GRAM_NEGATIVE_SET) { if (lc.includes(key)) return 'gram-negative'; }
  for (const key of FUNGAL_SET)        { if (lc.includes(key)) return 'fungal'; }
  return 'unknown';
}

const MDR_RELEVANT_CATEGORIES: Record<OrganismGroup, string[]> = {
  'gram-positive': [
    'Penicillins', 'Cephalosporins', 'Carbapenems', 'Aminoglycosides', 'Fluoroquinolones', 'Macrolides',
    'Lincosamides', 'Glycopeptides', 'Oxazolidinones', 'Tetracyclines', 'Sulfonamides', 'Rifamycins', 'Lipopeptides',
  ],
  'gram-negative': [
    'Penicillins', 'Cephalosporins', 'Carbapenems', 'Aminoglycosides', 'Fluoroquinolones', 'Polymyxins',
    'Monobactams', 'Sulfonamides', 'Tetracyclines', 'Phenicols',
  ],
  'fungal': [],
  'unknown': [
    'Penicillins', 'Cephalosporins', 'Carbapenems', 'Aminoglycosides', 'Fluoroquinolones', 'Glycopeptides',
    'Macrolides', 'Polymyxins',
  ],
};

interface Isolate { organism: string | null; antibiotics?: { name: string; result: string }[] }

export function relevantResistantClasses(entry: Isolate): string[] {
  const group = getOrganismGroup(entry.organism);
  const categories = MDR_RELEVANT_CATEGORIES[group] || MDR_RELEVANT_CATEGORIES.unknown;
  const rc = new Set<string>();
  (entry.antibiotics || []).forEach(({ name, result }) => {
    if (result === 'R' || result === 'I') {
      const cls = DRUG_TO_CLASS[name];
      if (cls && categories.includes(cls)) rc.add(cls);
    }
  });
  return [...rc];
}

/** Non-susceptible (R or I) to ≥1 agent in ≥3 relevant categories. */
export function isMDR(entry: Isolate): boolean {
  return relevantResistantClasses(entry).length >= 3;
}
