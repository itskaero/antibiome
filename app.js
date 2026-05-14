// ═══════════════════════════════════════════════════════════
//  app.js  —  Antibiome Clinical Analytics  (vanilla JS, Chart.js 4)
// ═══════════════════════════════════════════════════════════

import {
  saveCulture, loadCultures, deleteCulture, subscribeCultures, updateCulture, useFirebase,
  loadGuidelines, saveGuideline, deleteGuideline, updateGuideline, GUIDELINES_PASSCODE
} from './firebase-config.js';

/* ══════════════════════════════════════════════════════════
   DATA CONSTANTS
══════════════════════════════════════════════════════════ */
const ANTIBIOTIC_CLASSES = {
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

const ALL_ANTIBIOTICS = Object.entries(ANTIBIOTIC_CLASSES)
  .flatMap(([cls, drugs]) => drugs.map(d => ({ name: d, cls })))
  .sort((a, b) => a.name.localeCompare(b.name));

const DRUG_TO_CLASS = {};
Object.entries(ANTIBIOTIC_CLASSES).forEach(([cls, drugs]) => drugs.forEach(d => DRUG_TO_CLASS[d] = cls));

const ORGANISMS = [
  // Gram-negative
  'Acinetobacter baumannii',
  'Burkholderia cepacia',
  'Citrobacter freundii',
  'Citrobacter koseri',
  'Enterobacter cloacae',
  'Enterobacter aerogenes (Klebsiella aerogenes)',
  'Escherichia coli',
  'Haemophilus influenzae',
  'Klebsiella oxytoca',
  'Klebsiella pneumoniae',
  'Morganella morganii',
  'Proteus mirabilis',
  'Proteus vulgaris',
  'Providencia stuartii',
  'Pseudomonas aeruginosa',
  'Salmonella spp.',
  'Serratia marcescens',
  'Stenotrophomonas maltophilia',
  // Gram-positive
  'Coagulase-negative Staphylococci (CoNS)',
  'Enterococcus faecalis',
  'Enterococcus faecium',
  'Listeria monocytogenes',
  'Staphylococcus aureus',
  'Staphylococcus epidermidis',
  'Staphylococcus haemolyticus',
  'Streptococcus agalactiae (GBS)',
  'Streptococcus pneumoniae',
  'Streptococcus pyogenes (GAS)',
  'Streptococcus viridans group',
  // Fungi
  'Candida albicans',
  'Candida auris',
  'Candida glabrata',
  'Candida krusei',
  'Candida parapsilosis',
  'Candida tropicalis',
  'Aspergillus fumigatus',
  // Other
  'Other (specify below)',
];

const SPECIMEN_TYPES = ['Blood','CSF','ETT','Peritoneal Fluid','Stool','Urine','Wound','Other'];
const AGE_GROUPS     = ['Neonate','Infant','Child'];

const PALETTE = [
  '#3b82f6','#06b6d4','#10b981','#8b5cf6','#f59e0b',
  '#ef4444','#f97316','#ec4899','#14b8a6','#a3e635',
  '#0ea5e9','#d946ef','#22c55e','#fb923c','#818cf8',
];

/* ══════════════════════════════════════════════════════════
   ORGANISM GROUP MAPS  (for MDR classification)
   Follows WHO/ECDC 2012 categorisation
══════════════════════════════════════════════════════════ */

// Set of gram-positive organism name fragments (lowercase)
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

/**
 * Returns 'gram-positive' | 'gram-negative' | 'fungal' | 'unknown'
 */
function getOrganismGroup(organism) {
  if (!organism) return 'unknown';
  const lc = organism.toLowerCase();
  for (const key of GRAM_POSITIVE_SET) { if (lc.includes(key)) return 'gram-positive'; }
  for (const key of GRAM_NEGATIVE_SET) { if (lc.includes(key)) return 'gram-negative'; }
  for (const key of FUNGAL_SET)        { if (lc.includes(key)) return 'fungal'; }
  return 'unknown';
}

// Relevant antibiotic categories per organism group (WHO/ECDC 2012)
const MDR_RELEVANT_CATEGORIES = {
  'gram-positive': [
    'Penicillins', 'Cephalosporins', 'Carbapenems',
    'Aminoglycosides', 'Fluoroquinolones', 'Macrolides',
    'Lincosamides', 'Glycopeptides', 'Oxazolidinones',
    'Tetracyclines', 'Sulfonamides', 'Rifamycins', 'Lipopeptides',
  ],
  'gram-negative': [
    'Penicillins', 'Cephalosporins', 'Carbapenems',
    'Aminoglycosides', 'Fluoroquinolones', 'Polymyxins',
    'Monobactams', 'Sulfonamides', 'Tetracyclines', 'Phenicols',
  ],
  'fungal': [
    // Use generic fallback — antifungals don't map to standard AB classes here
  ],
  'unknown': [
    'Penicillins', 'Cephalosporins', 'Carbapenems',
    'Aminoglycosides', 'Fluoroquinolones', 'Glycopeptides',
    'Macrolides', 'Polymyxins',
  ],
};

/* Chart.js global defaults */
Chart.defaults.color          = '#64748b';
Chart.defaults.borderColor    = '#1e2d45';
Chart.defaults.font.family    = "'Inter', system-ui, sans-serif";
Chart.defaults.plugins.legend.labels.boxWidth = 12;
Chart.defaults.plugins.legend.labels.padding  = 14;
Chart.defaults.plugins.tooltip.backgroundColor = '#1a2235';
Chart.defaults.plugins.tooltip.borderColor     = '#253550';
Chart.defaults.plugins.tooltip.borderWidth     = 1;
Chart.defaults.plugins.tooltip.padding         = 10;
Chart.defaults.plugins.tooltip.titleColor      = '#e2e8f0';
Chart.defaults.plugins.tooltip.bodyColor       = '#94a3b8';

/* ══════════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════════ */
let allCultures    = [];
let allGuidelines  = [];
let chartInstances = {};
let pendingDeleteId = null;
let editingId = null;
// Guidelines state
let currentGuidelineWard = null;
let editingGuidelineId   = null;

/* ══════════════════════════════════════════════════════════
   HTML ESCAPE HELPER  — prevents XSS when inserting user data
   into innerHTML
══════════════════════════════════════════════════════════ */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ══════════════════════════════════════════════════════════
   BACKGROUND CANVAS ANIMATION
══════════════════════════════════════════════════════════ */
(function initBackground() {
  const canvas = document.getElementById('bg-canvas');
  const ctx    = canvas.getContext('2d');
  let W, H, nodes, animId;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function makeNode() {
    return {
      x:   Math.random() * W,
      y:   Math.random() * H,
      vx:  (Math.random() - 0.5) * 0.35,
      vy:  (Math.random() - 0.5) * 0.35,
      r:   Math.random() * 1.8 + 0.6,
    };
  }

  function init() {
    resize();
    const count = Math.min(Math.floor((W * H) / 14000), 120);
    nodes = Array.from({ length: count }, makeNode);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    /* connections */
    const maxDist = 160;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d < maxDist) {
          const alpha = (1 - d / maxDist) * 0.12;
          ctx.strokeStyle = `rgba(59,130,246,${alpha})`;
          ctx.lineWidth   = 0.8;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.stroke();
        }
      }
    }

    /* nodes */
    nodes.forEach(n => {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(59,130,246,0.35)';
      ctx.fill();

      n.x += n.vx;
      n.y += n.vy;
      if (n.x < 0 || n.x > W) n.vx *= -1;
      if (n.y < 0 || n.y > H) n.vy *= -1;
    });

    animId = requestAnimationFrame(draw);
  }

  init();
  draw();
  window.addEventListener('resize', () => { cancelAnimationFrame(animId); init(); draw(); });
})();

/* ══════════════════════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════════════════════ */
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.page;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('page-' + target).classList.add('active');
    renderActivePage(target);
  });
});

function renderActivePage(page) {
  if (page === 'home')        { populateSpecimenFilters(); populateWardFilters(); renderHome(); }
  if (page === 'trends')      { populateTrendFilters(); populateWardFilters(); renderTrends(); }
  if (page === 'antibiogram') { populateABFilters(); populateWardFilters(); renderAntibiogram(); }
  if (page === 'mdr')         { populateWardFilters(); renderMDR(); }
  if (page === 'records')     { renderRecords(); }
  if (page === 'insights')    { renderInsights(); }
  if (page === 'guidelines')  { renderGuidelines(); }
}

/* ══════════════════════════════════════════════════════════
   MDR LOGIC  (WHO/ECDC 2012 organism-aware)
══════════════════════════════════════════════════════════ */

/**
 * Returns resistant/intermediate classes that are *relevant* to the
 * organism's group, per WHO/ECDC 2012 categories.
 */
function relevantResistantClasses(entry) {
  const group      = getOrganismGroup(entry.organism);
  const categories = MDR_RELEVANT_CATEGORIES[group] || MDR_RELEVANT_CATEGORIES['unknown'];
  const rc         = new Set();
  (entry.antibiotics || []).forEach(({ name, result }) => {
    if (result === 'R' || result === 'I') {
      const cls = DRUG_TO_CLASS[name];
      if (cls && categories.includes(cls)) rc.add(cls);
    }
  });
  return [...rc];
}

/**
 * An isolate is MDR if it is non-susceptible (R or I) to ≥1 agent in
 * ≥3 relevant antimicrobial categories for its organism group.
 */
function isMDR(entry) {
  return relevantResistantClasses(entry).length >= 3;
}

/** Kept for backward compat — returns same relevant resistant classes. */
function resistantClasses(entry) {
  return relevantResistantClasses(entry);
}

/* ══════════════════════════════════════════════════════════
   FILTER HELPERS
══════════════════════════════════════════════════════════ */
function getHomeFiltered() {
  const specimen  = document.getElementById('home-filter-specimen').value;
  const ageGroup  = document.getElementById('home-filter-agegroup').value;
  const month     = document.getElementById('home-filter-month').value;
  const ward      = document.getElementById('home-filter-ward').value;
  return allCultures.filter(c => {
    if (specimen && c.specimen !== specimen) return false;
    if (ageGroup && c.age_group !== ageGroup) return false;
    if (month && !c.date?.startsWith(month)) return false;
    if (ward && c.ward !== ward) return false;
    return true;
  });
}

function getTrendFiltered() {
  const organism  = document.getElementById('trend-filter-organism').value;
  const specimen  = document.getElementById('trend-filter-specimen').value;
  const ward      = document.getElementById('trend-filter-ward').value;
  return allCultures.filter(c => {
    if (organism && c.organism !== organism) return false;
    if (specimen && c.specimen !== specimen) return false;
    if (ward && c.ward !== ward) return false;
    return true;
  });
}

function getMDRFiltered() {
  const ward = document.getElementById('mdr-filter-ward')?.value || '';
  return allCultures.filter(c => {
    if (ward && c.ward !== ward) return false;
    return true;
  });
}

/* ══════════════════════════════════════════════════════════
   POPULATE FILTER SELECTS
══════════════════════════════════════════════════════════ */
function populateSpecimenFilters() {
  ['home-filter-specimen', 'ab-filter-specimen'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    while (sel.options.length > 1) sel.remove(1);
    SPECIMEN_TYPES.forEach(s => { const o = new Option(s, s); sel.add(o); });
    sel.value = cur;
  });
}

function populateWardFilters() {
  const wards = [...new Set(allCultures.map(c => c.ward).filter(Boolean))].sort();
  ['home-filter-ward','trend-filter-ward','ab-filter-ward','mdr-filter-ward'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    while (sel.options.length > 1) sel.remove(1);
    wards.forEach(w => sel.add(new Option(w, w)));
    sel.value = cur;
  });
}

function populateTrendFilters() {
  const organisms = [...new Set(allCultures.map(c => c.organism).filter(Boolean))].sort();
  const sel = document.getElementById('trend-filter-organism');
  if (!sel) return;
  const cur = sel.value;
  while (sel.options.length > 1) sel.remove(1);
  organisms.forEach(o => sel.add(new Option(o, o)));
  sel.value = cur;

  const selS = document.getElementById('trend-filter-specimen');
  if (selS) {
    const curS = selS.value;
    while (selS.options.length > 1) selS.remove(1);
    SPECIMEN_TYPES.forEach(s => selS.add(new Option(s, s)));
    selS.value = curS;
  }
}

function populateABFilters() {
  populateSpecimenFilters();
  const years = [...new Set(allCultures.map(c => c.date?.slice(0, 4)).filter(Boolean))].sort().reverse();
  const sel = document.getElementById('ab-filter-year');
  if (!sel) return;
  const cur = sel.value;
  while (sel.options.length > 1) sel.remove(1);
  years.forEach(y => sel.add(new Option(y, y)));
  sel.value = cur;
}

/* ══════════════════════════════════════════════════════════
   CHART HELPER
══════════════════════════════════════════════════════════ */
function makeChart(id, config) {
  if (chartInstances[id]) { chartInstances[id].destroy(); }
  const canvas = document.getElementById(id);
  if (!canvas) return;
  chartInstances[id] = new Chart(canvas.getContext('2d'), config);
  return chartInstances[id];
}

function sortedMonths(cultures) {
  return [...new Set(cultures.map(c => c.date?.slice(0, 7)).filter(Boolean))].sort();
}

function fmtMonth(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function countBy(arr, key) {
  const map = {};
  arr.forEach(e => { const v = e[key]; if (v) map[v] = (map[v] || 0) + 1; });
  return map;
}

/* ══════════════════════════════════════════════════════════
   HOME PAGE
══════════════════════════════════════════════════════════ */
function renderHome() {
  const data = getHomeFiltered();
  const mdrAll  = data.filter(isMDR);
  const mdrPct  = data.length ? Math.round(mdrAll.length / data.length * 100) : 0;
  const uniqOrgs = new Set(data.map(c => c.organism).filter(Boolean)).size;

  document.getElementById('kpi-total').textContent    = data.length;
  document.getElementById('kpi-mdr').textContent      = mdrAll.length;
  document.getElementById('kpi-mdr-pct').textContent  = mdrPct + '%';
  document.getElementById('kpi-orgs').textContent     = uniqOrgs;

  // Chart: cultures per month
  const months   = sortedMonths(data);
  const byMonth  = months.map(m => data.filter(c => c.date?.startsWith(m)).length);
  makeChart('chart-monthly', {
    type: 'bar',
    data: {
      labels: months.map(fmtMonth),
      datasets: [{ label: 'Cultures', data: byMonth, backgroundColor: 'rgba(59,130,246,0.7)', borderColor: '#3b82f6', borderWidth: 1, borderRadius: 5 }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#1e2d45' } }, x: { grid: { display: false } } } }
  });

  // Chart: specimen pie
  const specMap  = countBy(data, 'specimen');
  const specKeys = Object.keys(specMap);
  makeChart('chart-specimen', {
    type: 'doughnut',
    data: {
      labels: specKeys,
      datasets: [{ data: specKeys.map(k => specMap[k]), backgroundColor: PALETTE, borderColor: '#111827', borderWidth: 2 }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } }, cutout: '62%' }
  });

  // Chart: top organisms
  const orgMap  = countBy(data, 'organism');
  const topOrgs = Object.entries(orgMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
  makeChart('chart-organisms', {
    type: 'bar',
    data: {
      labels: topOrgs.map(([o]) => o.length > 25 ? o.slice(0, 23) + '…' : o),
      datasets: [{ label: 'Cases', data: topOrgs.map(([, n]) => n), backgroundColor: PALETTE, borderRadius: 4 }]
    },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, grid: { color: '#1e2d45' } }, y: { grid: { display: false} } } }
  });

  // Chart: age groups
  const ageMap = countBy(data, 'age_group');
  const ages = [...AGE_GROUPS, ...[...Object.keys(ageMap)].filter(k => !AGE_GROUPS.includes(k))];
  makeChart('chart-age', {
    type: 'pie',
    data: {
      labels: ages,
      datasets: [{ data: ages.map(k => ageMap[k] || 0), backgroundColor: PALETTE, borderColor: '#111827', borderWidth: 2 }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
  });
}

/* ══════════════════════════════════════════════════════════
   TRENDS PAGE
══════════════════════════════════════════════════════════ */
function renderTrends() {
  const data = getTrendFiltered();

  // ── Organism freq per month (stacked bar)
  const months = sortedMonths(data);
  const topOrgsAll = Object.entries(countBy(data, 'organism')).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([o]) => o);
  const orgMonthlyDatasets = topOrgsAll.map((org, i) => ({
    label: org.length > 30 ? org.slice(0, 28) + '…' : org,
    data: months.map(m => data.filter(c => c.date?.startsWith(m) && c.organism === org).length),
    backgroundColor: PALETTE[i % PALETTE.length],
    borderRadius: 3,
    stack: 'a',
  }));
  makeChart('chart-org-monthly', {
    type: 'bar',
    data: { labels: months.map(fmtMonth), datasets: orgMonthlyDatasets },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, stacked: true, grid: { color: '#1e2d45' } } } }
  });

  // ── Organisms per specimen (horizontal stacked)
  const topOrgs5   = Object.entries(countBy(data, 'organism')).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([o]) => o);
  const specDatasets = topOrgs5.map((org, i) => ({
    label: org.length > 28 ? org.slice(0, 26) + '…' : org,
    data: SPECIMEN_TYPES.map(s => data.filter(c => c.organism === org && c.specimen === s).length),
    backgroundColor: PALETTE[i % PALETTE.length],
    borderRadius: 2,
    stack: 'b',
  }));
  makeChart('chart-org-specimen', {
    type: 'bar',
    data: { labels: SPECIMEN_TYPES, datasets: specDatasets },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { position: 'bottom' } }, scales: { x: { beginAtZero: true, stacked: true, grid: { color: '#1e2d45' } }, y: { stacked: true, grid: { display: false } } } }
  });

  // ── MDR per month
  const mdrByMonth  = months.map(m => data.filter(c => c.date?.startsWith(m) && isMDR(c)).length);
  const totByMonth  = months.map(m => data.filter(c => c.date?.startsWith(m)).length);
  makeChart('chart-mdr-monthly', {
    type: 'line',
    data: {
      labels: months.map(fmtMonth),
      datasets: [
        { label: 'MDR Cases', data: mdrByMonth, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', fill: true, tension: .35, pointRadius: 4, pointBackgroundColor: '#ef4444' },
        { label: 'Total',     data: totByMonth, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.05)', fill: true, tension: .35, pointRadius: 4, pointBackgroundColor: '#3b82f6' },
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } }, scales: { y: { beginAtZero: true, grid: { color: '#1e2d45' } }, x: { grid: { display: false } } } }
  });

  // ── Organisms per age group
  const ageDatasets = AGE_GROUPS.map((ag, i) => ({
    label: ag,
    data: topOrgsAll.map(org => data.filter(c => c.organism === org && c.age_group === ag).length),
    backgroundColor: PALETTE[i % PALETTE.length],
    borderRadius: 3,
    stack: 'c',
  }));
  makeChart('chart-org-age', {
    type: 'bar',
    data: {
      labels: topOrgsAll.map(o => o.length > 22 ? o.slice(0, 20) + '…' : o),
      datasets: ageDatasets
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, stacked: true, grid: { color: '#1e2d45' } }, x: { stacked: true, grid: { display: false } } } }
  });

  // ── Specimen per month (line)
  const specLineDatasets = SPECIMEN_TYPES.map((sp, i) => {
    const vals = months.map(m => data.filter(c => c.date?.startsWith(m) && c.specimen === sp).length);
    if (!vals.some(v => v > 0)) return null;
    return { label: sp, data: vals, borderColor: PALETTE[i % PALETTE.length], backgroundColor: 'transparent', tension: .3, pointRadius: 3 };
  }).filter(Boolean);
  makeChart('chart-specimen-monthly', {
    type: 'line',
    data: { labels: months.map(fmtMonth), datasets: specLineDatasets },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, grid: { color: '#1e2d45' } }, x: { grid: { display: false } } } }
  });

  // ── Cultures by Ward (stacked bar per month)
  const wards = [...new Set(data.map(c => c.ward).filter(Boolean))].sort();
  if (wards.length) {
    const wardDatasets = wards.map((w, i) => ({
      label: w,
      data: months.map(m => data.filter(c => c.date?.startsWith(m) && c.ward === w).length),
      backgroundColor: PALETTE[i % PALETTE.length],
      borderRadius: 3,
      stack: 'w',
    }));
    makeChart('chart-ward', {
      type: 'bar',
      data: { labels: months.map(fmtMonth), datasets: wardDatasets },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, grid: { color: '#1e2d45' } } } }
    });
  } else {
    // No ward data — show placeholder
    if (chartInstances['chart-ward']) { chartInstances['chart-ward'].destroy(); delete chartInstances['chart-ward']; }
    const cv = document.getElementById('chart-ward');
    if (cv) {
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = '#64748b';
      ctx.font = '13px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No ward data recorded yet — add ward/bay to culture entries.', cv.width / 2, cv.height ? cv.height / 2 : 60);
    }
  }
}

/* ══════════════════════════════════════════════════════════
   ANTIBIOGRAM PAGE
══════════════════════════════════════════════════════════ */
function renderAntibiogram() {
  const specFilter = document.getElementById('ab-filter-specimen')?.value || '';
  const yearFilter = document.getElementById('ab-filter-year')?.value || '';
  const wardFilter = document.getElementById('ab-filter-ward')?.value || '';
  const data = allCultures.filter(c => {
    if (specFilter && c.specimen !== specFilter) return false;
    if (yearFilter && c.date?.slice(0, 4) !== yearFilter) return false;
    if (wardFilter && c.ward !== wardFilter) return false;
    return true;
  });

  const raw = {};
  data.forEach(entry => {
    const org = entry.organism;
    if (!org) return;
    if (!raw[org]) raw[org] = { drugs: {}, count: 0 };
    raw[org].count++;
    (entry.antibiotics || []).forEach(({ name, result }) => {
      if (!name || !['S', 'I', 'R'].includes(result)) return;
      if (!raw[org].drugs[name]) raw[org].drugs[name] = { S: 0, I: 0, R: 0 };
      raw[org].drugs[name][result]++;
    });
  });

  const tbody = document.getElementById('ab-tbody');
  const thead = document.getElementById('ab-thead');
  const empty = document.getElementById('ab-empty');
  tbody.innerHTML = '';
  thead.innerHTML = '';

  if (!Object.keys(raw).length) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  const allDrugs = [...new Set(Object.values(raw).flatMap(o => Object.keys(o.drugs)))].sort();
  const orgs     = Object.keys(raw).sort();

  // Header
  const hrow = document.createElement('tr');
  hrow.innerHTML = `<th>Organism</th>` + allDrugs.map(d => `<th>${d}</th>`).join('');
  thead.appendChild(hrow);

  // Rows
  orgs.forEach(org => {
    const row = document.createElement('tr');
    let cells = `<td><strong>${org}</strong> <span class="org-count">(n=${raw[org].count})</span></td>`;
    allDrugs.forEach(drug => {
      const counts = raw[org].drugs[drug];
      if (!counts) { cells += `<td><span class="pct-na">—</span></td>`; return; }
      const total = counts.S + counts.I + counts.R;
      const pct   = total > 0 ? Math.round(counts.S / total * 100) : null;
      if (pct === null) { cells += `<td><span class="pct-na">—</span></td>`; return; }
      const cls = pct >= 80 ? 'pct-high' : pct >= 50 ? 'pct-mid' : 'pct-low';
      cells += `<td><span class="pct-cell ${cls}">${pct}%</span></td>`;
    });
    row.innerHTML = cells;
    tbody.appendChild(row);
  });
}

/* ══════════════════════════════════════════════════════════
   MDR PAGE
══════════════════════════════════════════════════════════ */
function renderMDR() {
  const filtered = getMDRFiltered();
  const mdrCases = filtered.filter(isMDR);
  const total    = filtered.length;
  const rate     = total ? Math.round(mdrCases.length / total * 100) : 0;
  const mdrOrgs  = new Set(mdrCases.map(c => c.organism).filter(Boolean)).size;

  document.getElementById('mdr-kpi-total').textContent = mdrCases.length;
  document.getElementById('mdr-kpi-rate').textContent  = rate + '%';
  document.getElementById('mdr-kpi-orgs').textContent  = mdrOrgs;

  // MDR trend chart
  const months = sortedMonths(filtered);
  const mdrByM  = months.map(m => filtered.filter(c => c.date?.startsWith(m) && isMDR(c)).length);
  const pctByM  = months.map((m, i) => {
    const tot = filtered.filter(c => c.date?.startsWith(m)).length;
    return tot ? Math.round(mdrByM[i] / tot * 100) : 0;
  });
  makeChart('chart-mdr-trend', {
    type: 'line',
    data: {
      labels: months.map(fmtMonth),
      datasets: [
        { label: 'MDR Count',  data: mdrByM, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.15)', fill: true, tension: .35, yAxisID: 'y', pointRadius: 4, pointBackgroundColor: '#ef4444' },
        { label: 'MDR %',      data: pctByM, borderColor: '#f97316', backgroundColor: 'transparent', tension: .35, yAxisID: 'y1', borderDash: [4,4], pointRadius: 3 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: {
        y:  { beginAtZero: true, grid: { color: '#1e2d45' }, title: { display: true, text: 'Count', color: '#64748b' } },
        y1: { beginAtZero: true, max: 100, position: 'right', grid: { display: false }, title: { display: true, text: '%', color: '#64748b' }, ticks: { callback: v => v + '%' } },
        x:  { grid: { display: false } }
      }
    }
  });

  // Top MDR organisms
  const mdrOrgMap = countBy(mdrCases, 'organism');
  const topMDR    = Object.entries(mdrOrgMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
  makeChart('chart-mdr-orgs', {
    type: 'bar',
    data: {
      labels: topMDR.map(([o]) => o.length > 25 ? o.slice(0, 23) + '…' : o),
      datasets: [{ label: 'MDR Cases', data: topMDR.map(([, n]) => n), backgroundColor: topMDR.map((_, i) => PALETTE[i % PALETTE.length]), borderRadius: 4 }]
    },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, grid: { color: '#1e2d45' } }, y: { grid: { display: false } } } }
  });

  // MDR case list
  const tbody = document.getElementById('mdr-list-body');
  const empty = document.getElementById('mdr-empty');
  tbody.innerHTML = '';
  if (!mdrCases.length) { empty.style.display = ''; return; }
  empty.style.display = 'none';
  mdrCases.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).forEach(c => {
    const cls = resistantClasses(c);
    const group = getOrganismGroup(c.organism);
    const tooltip = escHtml(`MDR: non-susceptible in ${cls.length} relevant categories (${cls.join(', ')}) — organism group: ${group}`);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escHtml(c.date) || '—'}</td>
      <td>${escHtml(c.patient_name) || '—'}</td>
      <td>${escHtml(c.age_group) || '—'}</td>
      <td>${escHtml(c.organism) || '—'}</td>
      <td>${escHtml(c.specimen) || '—'}</td>
      <td><small style="color:#f87171" title="${tooltip}">${cls.map(escHtml).join(', ')}</small></td>
    `;
    tbody.appendChild(tr);
  });
}

/* ══════════════════════════════════════════════════════════
   RECORDS PAGE
══════════════════════════════════════════════════════════ */
function renderRecords() {
  const q   = document.getElementById('records-search')?.value?.toLowerCase() || '';
  const data = allCultures.filter(c => {
    if (!q) return true;
    return (c.patient_name || '').toLowerCase().includes(q) || (c.organism || '').toLowerCase().includes(q);
  });

  const tbody = document.getElementById('records-body');
  const empty = document.getElementById('records-empty');
  tbody.innerHTML = '';

  if (!data.length) { empty.style.display = ''; return; }
  empty.style.display = 'none';

  data.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).forEach(entry => {
    const mdr = isMDR(entry);
    const abList = (entry.antibiotics || []).slice(0, 3).map(ab => `${ab.name}:${ab.result}`).join(', ');
    const more   = (entry.antibiotics || []).length > 3 ? ` +${entry.antibiotics.length - 3}` : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${entry.date || '—'}</td>
      <td>${entry.patient_name || '—'}</td>
      <td>${entry.age_group || '—'}</td>
      <td>${entry.organism || '—'}</td>
      <td>${entry.specimen || '—'}</td>
      <td>${mdr ? '<span class="badge-mdr">MDR</span>' : '<span class="badge-ok">—</span>'}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#64748b">${abList}${more}</td>
      <td class="row-actions">
        <button class="btn-view-row" data-id="${entry.id}" title="View / Edit">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        <button class="btn-remove-row" data-id="${entry.id}" title="Delete">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.btn-view-row').forEach(btn => {
    btn.addEventListener('click', () => openViewModal(btn.dataset.id));
  });
  tbody.querySelectorAll('.btn-remove-row').forEach(btn => {
    btn.addEventListener('click', () => openDeleteModal(btn.dataset.id));
  });
}

/* ── View modal ──────────────────────────────────────────── */
function openViewModal(id) {
  const entry = allCultures.find(e => e.id === id);
  if (!entry) return;
  const mdr   = isMDR(entry);
  const group = getOrganismGroup(entry.organism);
  const rCls  = resistantClasses(entry);
  const mdrNote = mdr
    ? `<span class="badge-mdr" title="Non-susceptible in ${rCls.length} categories: ${rCls.join(', ')}">MDR</span> <small style="color:#64748b;font-size:11px">(${rCls.join(', ')})</small>`
    : '<span class="badge-ok">Non-MDR</span>';
  const abRows = (entry.antibiotics || []).map(ab => {
    const cls = ab.result === 'S' ? 'pct-high' : ab.result === 'I' ? 'pct-mid' : 'pct-low';
    return `<tr><td>${ab.name}</td><td><span class="pct-cell ${cls}">${ab.result}</span></td></tr>`;
  }).join('');
  document.getElementById('modal-view-body').innerHTML = `
    <div class="view-grid">
      <div class="view-field"><span class="view-label">Date</span><span class="view-val">${entry.date || '\u2014'}</span></div>
      <div class="view-field"><span class="view-label">Patient</span><span class="view-val">${entry.patient_name || '\u2014'}</span></div>
      <div class="view-field"><span class="view-label">Age Group</span><span class="view-val">${entry.age_group || '\u2014'}</span></div>
      <div class="view-field"><span class="view-label">Ward</span><span class="view-val">${entry.ward || '\u2014'}</span></div>
      <div class="view-field"><span class="view-label">Specimen</span><span class="view-val">${entry.specimen || '\u2014'}</span></div>
      <div class="view-field"><span class="view-label">Organism</span><span class="view-val">${entry.organism || '\u2014'} <small style="color:var(--text-muted)">(${group})</small></span></div>
      <div class="view-field" style="grid-column:span 2"><span class="view-label">MDR Status</span><span class="view-val">${mdrNote}</span></div>
    </div>
    ${abRows
      ? `<div class="view-ab-section"><p class="view-label" style="margin-bottom:8px">Antibiotic Susceptibility</p><table class="data-table"><thead><tr><th>Antibiotic</th><th>Result</th></tr></thead><tbody>${abRows}</tbody></table></div>`
      : '<p style="color:#64748b;margin-top:12px;font-size:13px">No antibiotic data recorded.</p>'}
  `;
  document.getElementById('modal-view-edit').dataset.id = id;
  document.getElementById('modal-view-overlay').style.display = 'grid';
}

function closeViewModal() {
  document.getElementById('modal-view-overlay').style.display = 'none';
}

document.getElementById('modal-view-close').addEventListener('click', closeViewModal);
document.getElementById('modal-view-cancel').addEventListener('click', closeViewModal);
document.getElementById('modal-view-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-view-overlay')) closeViewModal();
});

document.getElementById('modal-view-edit').addEventListener('click', () => {
  const id = document.getElementById('modal-view-edit').dataset.id;
  closeViewModal();
  openEditForm(id);
});

function openEditForm(id) {
  const entry = allCultures.find(e => e.id === id);
  if (!entry) return;
  editingId = id;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelector('[data-page="entry"]').classList.add('active');
  document.getElementById('page-entry').classList.add('active');
  document.getElementById('entry-page-title').textContent = 'Edit Culture Entry';
  document.getElementById('entry-page-sub').textContent   = 'Update the existing culture record';
  document.getElementById('form-submit-label').textContent = 'Update Culture';
  document.getElementById('f-date').value         = entry.date || '';
  document.getElementById('f-patient-name').value = entry.patient_name || '';
  document.getElementById('f-age-group').value    = entry.age_group || '';
  document.getElementById('f-ward').value         = entry.ward || '';
  document.getElementById('f-specimen').value     = entry.specimen || '';
  const orgEl = document.getElementById('f-organism');
  const customGroup = document.getElementById('custom-org-group');
  if (!ORGANISMS.includes(entry.organism) || entry.organism === 'Other (specify below)') {
    orgEl.value = 'Other (specify below)';
    customGroup.style.display = 'flex';
    document.getElementById('f-custom-organism').value = entry.organism || '';
  } else {
    orgEl.value = entry.organism || '';
    customGroup.style.display = 'none';
  }
  document.getElementById('antibiotic-rows').innerHTML = '';
  if ((entry.antibiotics || []).length) {
    entry.antibiotics.forEach(ab => addABRow(ab.name, ab.result));
  } else {
    addABRow();
  }
}

/* ── Delete modal ────────────────────────────────────────── */
function openDeleteModal(id) {
  pendingDeleteId = id;
  document.getElementById('modal-overlay').style.display = 'grid';
}

document.getElementById('modal-cancel').addEventListener('click', () => {
  document.getElementById('modal-overlay').style.display = 'none';
  pendingDeleteId = null;
});

document.getElementById('modal-confirm').addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  const entry = allCultures.find(e => e.id === pendingDeleteId);
  if (entry) {
    await deleteCulture(entry);
    allCultures = allCultures.filter(e => e.id !== pendingDeleteId);
    if (!useFirebase) { /* localStorage already updated by deleteCulture */ }
  }
  document.getElementById('modal-overlay').style.display = 'none';
  pendingDeleteId = null;
  renderRecords();
});

/* ── CSV export ──────────────────────────────────────────── */
document.getElementById('export-btn').addEventListener('click', () => {
  const headers = ['Date', 'Patient Name', 'Age Group', 'Organism', 'Specimen', 'MDR', 'Ward', 'Antibiotics'];
  const rows    = allCultures.map(c => [
    c.date || '',
    c.patient_name || '',
    c.age_group || '',
    c.organism || '',
    c.specimen || '',
    isMDR(c) ? 'Yes' : 'No',
    c.ward || '',
    (c.antibiotics || []).map(ab => `${ab.name}:${ab.result}`).join(' | '),
  ]);
  const csv  = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `nicu-cultures-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

/* ── Search ──────────────────────────────────────────────── */
document.getElementById('records-search').addEventListener('input', renderRecords);

/* ══════════════════════════════════════════════════════════
   CULTURE ENTRY FORM
══════════════════════════════════════════════════════════ */
(function initForm() {
  document.getElementById('f-date').valueAsDate = new Date();

  // Show custom organism field
  document.getElementById('f-organism').addEventListener('change', function() {
    document.getElementById('custom-org-group').style.display =
      this.value === 'Other (specify below)' ? 'flex' : 'none';
  });

  // Add antibiotic row
  document.getElementById('add-antibiotic').addEventListener('click', addABRow);
  addABRow(); // start with one row

  // Antibiotic rows container delegation
  document.getElementById('antibiotic-rows').addEventListener('click', e => {
    if (e.target.closest('.btn-remove-row')) {
      e.target.closest('.ab-row').remove();
    }
    if (e.target.classList.contains('sus-btn')) {
      const btn  = e.target;
      const row  = btn.closest('.ab-row');
      const val  = btn.dataset.val;
      row.querySelectorAll('.sus-btn').forEach(b => b.className = 'sus-btn');
      btn.classList.add('active-' + val);
      row.querySelector('.sus-hidden').value = val;
    }
  });

  // Submit
  document.getElementById('culture-form').addEventListener('submit', handleFormSubmit);

  // Reset
  document.getElementById('culture-form').addEventListener('reset', () => {
    setTimeout(() => {
      editingId = null;
      document.getElementById('entry-page-title').textContent  = 'Add Culture Entry';
      document.getElementById('entry-page-sub').textContent    = 'Record a new culture result with susceptibility data';
      document.getElementById('form-submit-label').textContent = 'Save Culture';
      document.getElementById('f-date').valueAsDate = new Date();
      document.getElementById('antibiotic-rows').innerHTML = '';
      document.getElementById('custom-org-group').style.display = 'none';
      addABRow();
      document.getElementById('form-success').style.display = 'none';
      document.getElementById('form-error').style.display   = 'none';
    }, 0);
  });
})();

function addABRow(prefillName = '', prefillResult = '') {
  const container = document.getElementById('antibiotic-rows');
  const row       = document.createElement('div');
  row.className   = 'ab-row';

  const opts = ALL_ANTIBIOTICS.map(ab =>
    `<option value="${ab.name}" data-class="${ab.cls}"${ab.name === prefillName ? ' selected' : ''}>${ab.name}</option>`
  ).join('');

  row.innerHTML = `
    <select class="form-input ab-select">
      <option value="">— Select antibiotic —</option>
      ${opts}
    </select>
    <div class="sus-btns" style="justify-content:center">
      <button type="button" class="sus-btn${prefillResult === 'S' ? ' active-S' : ''}" data-val="S">S</button>
      <button type="button" class="sus-btn${prefillResult === 'I' ? ' active-I' : ''}" data-val="I">I</button>
      <button type="button" class="sus-btn${prefillResult === 'R' ? ' active-R' : ''}" data-val="R">R</button>
      <input type="hidden" class="sus-hidden" value="${prefillResult}" />
    </div>
    <button type="button" class="btn-remove-row" title="Remove">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;
  container.appendChild(row);
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const errEl  = document.getElementById('form-error');
  const succEl = document.getElementById('form-success');
  errEl.style.display  = 'none';
  succEl.style.display = 'none';

  const organism = document.getElementById('f-organism').value;
  const date     = document.getElementById('f-date').value;
  const specimen = document.getElementById('f-specimen').value;
  const ageGroup = document.getElementById('f-age-group').value;

  if (!date)     { showFormError('Date is required.'); return; }
  if (!specimen) { showFormError('Specimen type is required.'); return; }
  if (!organism) { showFormError('Organism is required.'); return; }
  if (!ageGroup) { showFormError('Age group is required.'); return; }
  if (organism === 'Other (specify below)' && !document.getElementById('f-custom-organism').value.trim()) {
    showFormError('Please specify the organism.'); return;
  }

  const antibiotics = [];
  document.querySelectorAll('#antibiotic-rows .ab-row').forEach(row => {
    const name   = row.querySelector('.ab-select').value;
    const result = row.querySelector('.sus-hidden').value;
    if (name && result) antibiotics.push({ name, result });
  });

  const entry = {
    id:           crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2)),
    patient_name: document.getElementById('f-patient-name').value.trim(),
    date,
    age_group:    ageGroup,
    ward:         document.getElementById('f-ward').value.trim(),
    specimen,
    organism:     organism === 'Other (specify below)' ? document.getElementById('f-custom-organism').value.trim() : organism,
    antibiotics,
  };

  try {
    if (editingId) {
      const existing = allCultures.find(c => c.id === editingId);
      const updated  = { ...existing, ...entry, id: editingId };
      const saved    = await updateCulture(updated);
      allCultures    = allCultures.map(c => c.id === editingId ? saved : c);
      editingId      = null;
      document.getElementById('entry-page-title').textContent  = 'Add Culture Entry';
      document.getElementById('entry-page-sub').textContent    = 'Record a new culture result with susceptibility data';
      document.getElementById('form-submit-label').textContent = 'Save Culture';
    } else {
      const saved = await saveCulture(entry);
      allCultures.unshift(saved);
    }
    succEl.style.display = 'flex';
    setTimeout(() => { succEl.style.display = 'none'; }, 3500);
    e.target.reset();
  } catch (err) {
    showFormError('Failed to save: ' + err.message);
  }
}

function showFormError(msg) {
  const el = document.getElementById('form-error');
  el.textContent   = msg;
  el.style.display = 'block';
}

/* ══════════════════════════════════════════════════════════
   FILTER EVENT LISTENERS (re-render on change)
══════════════════════════════════════════════════════════ */
['home-filter-specimen','home-filter-agegroup','home-filter-month','home-filter-ward'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', renderHome);
});
['trend-filter-organism','trend-filter-specimen','trend-filter-ward'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', renderTrends);
});
['ab-filter-specimen','ab-filter-year','ab-filter-ward'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', renderAntibiogram);
});
document.getElementById('mdr-filter-ward')?.addEventListener('change', renderMDR);

/* ══════════════════════════════════════════════════════════
   CONNECTION STATUS UI
══════════════════════════════════════════════════════════ */
function setStatus(state, label) {
  const dot  = document.querySelector('.status-dot');
  const span = document.querySelector('.connection-status span');
  dot.className  = 'status-dot ' + state;
  span.textContent = label;
}

/* ══════════════════════════════════════════════════════════
   INSIGHTS PAGE
══════════════════════════════════════════════════════════ */
function renderInsights() {
  const data = allCultures;
  if (!data.length) {
    document.getElementById('tidbits-list').innerHTML = '<p style="color:var(--text-muted);font-size:13px">No data yet. Add culture entries to see insights.</p>';
    document.getElementById('insights-ab-table').innerHTML = '';
    document.getElementById('blank-ab-list').innerHTML = '';
    ['ins-kpi-gp','ins-kpi-gn','ins-kpi-fungal','ins-kpi-alerts'].forEach(id => {
      document.getElementById(id).textContent = '0';
    });
    return;
  }

  // ── GP / GN / Fungal KPIs
  const gpCount     = data.filter(c => getOrganismGroup(c.organism) === 'gram-positive').length;
  const gnCount     = data.filter(c => getOrganismGroup(c.organism) === 'gram-negative').length;
  const fungalCount = data.filter(c => getOrganismGroup(c.organism) === 'fungal').length;
  document.getElementById('ins-kpi-gp').textContent     = gpCount;
  document.getElementById('ins-kpi-gn').textContent     = gnCount;
  document.getElementById('ins-kpi-fungal').textContent = fungalCount;

  // ── Prevalence tidbits
  const tidbits = [];
  const months = sortedMonths(data);
  const lastMonth  = months[months.length - 1];
  const prevMonth  = months[months.length - 2];

  // Top organism this month vs last
  if (lastMonth) {
    const thisMonthData = data.filter(c => c.date?.startsWith(lastMonth));
    const prevMonthData = prevMonth ? data.filter(c => c.date?.startsWith(prevMonth)) : [];
    if (thisMonthData.length) {
      const orgMap   = countBy(thisMonthData, 'organism');
      const topOrg   = Object.entries(orgMap).sort((a,b)=>b[1]-a[1])[0];
      if (topOrg) {
        const pct = Math.round(topOrg[1] / thisMonthData.length * 100);
        const prevOrgMap = countBy(prevMonthData, 'organism');
        const prevPct = prevMonthData.length && prevOrgMap[topOrg[0]]
          ? Math.round(prevOrgMap[topOrg[0]] / prevMonthData.length * 100) : null;
        const delta = prevPct !== null ? (pct - prevPct) : null;
        const deltaStr = delta !== null ? (delta >= 0 ? ` — ${escHtml(String(delta))} pp above last month ▲` : ` — ${escHtml(String(Math.abs(delta)))} pp below last month ▼`) : '';
        tidbits.push({ type:'info', msg: `${fmtMonth(lastMonth)}: <strong>${escHtml(topOrg[0])}</strong> is the top organism, accounting for ${pct}% of isolates (n=${topOrg[1]})${deltaStr}.` });
      }
    }

    // MDR trend
    if (months.length >= 3) {
      const last3 = months.slice(-3);
      const mdrPcts = last3.map(m => {
        const md = data.filter(c => c.date?.startsWith(m));
        return md.length ? Math.round(md.filter(isMDR).length / md.length * 100) : 0;
      });
      const rising = mdrPcts[0] < mdrPcts[1] && mdrPcts[1] < mdrPcts[2];
      const falling = mdrPcts[0] > mdrPcts[1] && mdrPcts[1] > mdrPcts[2];
      if (rising) {
        tidbits.push({ type:'warn', msg: `MDR rate has risen for 3 consecutive months (${mdrPcts.join('% → ')}%) — consider reviewing empiric protocols.` });
      } else if (falling) {
        tidbits.push({ type:'good', msg: `MDR rate has fallen for 3 consecutive months (${mdrPcts.join('% → ')}%) — current protocols appear effective.` });
      }
    }
  }

  // Dominant organism group
  if (gpCount > gnCount * 1.5) {
    tidbits.push({ type:'info', msg: `Gram-positive organisms dominate (${gpCount} vs ${gnCount} gram-negative) — consider cover for <em>Staphylococci</em> and <em>Enterococci</em>.` });
  } else if (gnCount > gpCount * 1.5) {
    tidbits.push({ type:'info', msg: `Gram-negative organisms dominate (${gnCount} vs ${gpCount} gram-positive) — extended-spectrum coverage may be warranted.` });
  }

  // Total isolates
  tidbits.push({ type:'stat', msg: `Total isolates in database: <strong>${data.length}</strong> | MDR: <strong>${data.filter(isMDR).length}</strong> (${data.length ? Math.round(data.filter(isMDR).length/data.length*100) : 0}%)` });

  const tidbitIcons = { info:'ℹ️', warn:'⚠️', good:'✅', stat:'📊' };
  document.getElementById('tidbits-list').innerHTML = tidbits.length
    ? tidbits.map(t => `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 14px;font-size:13px;color:var(--text-dim)">${tidbitIcons[t.type] || ''} ${t.msg}</div>`).join('')
    : '<p style="color:var(--text-muted);font-size:13px">Not enough data to generate tidbits yet.</p>';

  // ── Antibiotic effectiveness per organism
  const rawAB = {};
  data.forEach(entry => {
    const org = entry.organism;
    if (!org) return;
    if (!rawAB[org]) rawAB[org] = {};
    (entry.antibiotics || []).forEach(({ name, result }) => {
      if (!name || !['S','I','R'].includes(result)) return;
      if (!rawAB[org][name]) rawAB[org][name] = { S:0, I:0, R:0 };
      rawAB[org][name][result]++;
    });
  });

  const topOrgs = Object.entries(countBy(data,'organism')).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([o])=>o);
  let abHtml = '';
  topOrgs.forEach(org => {
    const drugs = rawAB[org] || {};
    const rows = Object.entries(drugs).map(([drug, counts]) => {
      const total = counts.S + counts.I + counts.R;
      const pct   = total ? Math.round(counts.S / total * 100) : null;
      if (pct === null) return null;
      const cls   = pct >= 80 ? 'pct-high' : pct >= 50 ? 'pct-mid' : 'pct-low';
      const reco  = pct >= 80 ? '✅ Likely effective' : pct < 50 ? '🚫 Avoid / High resistance' : '⚠️ Use with caution';
      return `<tr><td>${escHtml(drug)}</td><td><span class="pct-cell ${cls}">${pct}%</span></td><td style="font-size:12px;color:var(--text-muted)">${reco}</td><td style="font-size:11px;color:var(--text-muted)">${total} isolates</td></tr>`;
    }).filter(Boolean).sort((a,b) => {
      // Sort: high pct first
      const pa = parseInt(a.match(/(\d+)%/)?.[1] || '0');
      const pb = parseInt(b.match(/(\d+)%/)?.[1] || '0');
      return pb - pa;
    });
    if (!rows.length) return;
    const groupLabel = getOrganismGroup(org);
    abHtml += `
      <div style="margin-bottom:20px">
        <h4 style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:8px">${escHtml(org)} <small style="color:var(--text-muted);font-weight:400">(${escHtml(groupLabel)})</small></h4>
        <div class="table-scroll"><table class="data-table" style="font-size:12px">
          <thead><tr><th>Antibiotic</th><th>%S (susceptible)</th><th>Recommendation</th><th>n</th></tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table></div>
      </div>`;
  });
  document.getElementById('insights-ab-table').innerHTML = abHtml || '<p style="color:var(--text-muted);font-size:13px">No antibiotic susceptibility data yet.</p>';

  // ── Blank antibiogram alerts
  // Common empiric antibiotics — flag if no local data for a common organism
  const COMMON_EMPIRIC = ['Ampicillin','Gentamicin','Meropenem','Vancomycin','Piperacillin-Tazobactam','Ceftriaxone','Amikacin','Ciprofloxacin'];
  const alertItems = [];
  topOrgs.forEach(org => {
    COMMON_EMPIRIC.forEach(drug => {
      const counts = (rawAB[org] || {})[drug];
      if (!counts) {
        alertItems.push(`<li style="margin-bottom:6px;font-size:13px;color:var(--text-dim)"><strong>${escHtml(drug)}</strong> — no local susceptibility data for <em>${escHtml(org)}</em></li>`);
      }
    });
  });
  document.getElementById('ins-kpi-alerts').textContent = alertItems.length;
  document.getElementById('blank-ab-list').innerHTML = alertItems.length
    ? `<ul style="padding-left:18px">${alertItems.join('')}</ul>`
    : '<p style="color:var(--green);font-size:13px">✅ All common empiric antibiotics have susceptibility data for the top organisms.</p>';
}

/* ══════════════════════════════════════════════════════════
   GUIDELINES PAGE
══════════════════════════════════════════════════════════ */

/** Compute local susceptibility % for a drug against an organism. Returns null if no data. */
function localSusceptibility(drug, organism) {
  const entries = allCultures.filter(c => c.organism === organism);
  let S=0, total=0;
  entries.forEach(e => {
    (e.antibiotics||[]).forEach(ab => {
      if (ab.name === drug) {
        total++;
        if (ab.result === 'S') S++;
      }
    });
  });
  return total >= 3 ? Math.round(S / total * 100) : null;
}

function renderGuidelines() {
  const wards = [...new Set(allGuidelines.map(p => p.ward).filter(Boolean))].sort();

  // Populate ward select
  const wsel = document.getElementById('gl-ward-select');
  const curWard = wsel.value;
  while (wsel.options.length > 1) wsel.remove(1);
  wards.forEach(w => wsel.add(new Option(w, w)));
  if (curWard && wards.includes(curWard)) wsel.value = curWard;

  const selectedWard = wsel.value;
  const addBtn = document.getElementById('gl-add-protocol-btn');

  if (!selectedWard) {
    document.getElementById('gl-empty').style.display = '';
    document.getElementById('gl-protocols-area').style.display = 'none';
    addBtn.style.display = 'none';
    return;
  }

  document.getElementById('gl-empty').style.display = 'none';
  document.getElementById('gl-protocols-area').style.display = '';
  addBtn.style.display = '';
  document.getElementById('gl-ward-title').textContent = selectedWard + ' — Protocols';
  currentGuidelineWard = selectedWard;

  const protocols = allGuidelines.filter(p => p.ward === selectedWard);
  const container = document.getElementById('gl-protocols-list');
  container.innerHTML = '';

  if (!protocols.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;margin-bottom:16px">No protocols defined for this ward yet. Click "Add Protocol" to add one.</p>';
    return;
  }

  protocols.forEach(proto => {
    // Check drug susceptibility threshold
    const THRESHOLD = 70;
    const linesToCheck = [proto.line1, proto.line2, proto.line3].filter(Boolean);
    let belowThreshold = false;
    const alertDrugs = [];
    linesToCheck.forEach(line => {
      line.split(/[,+/]/).map(d => d.trim()).filter(Boolean).forEach(drug => {
        const drugName = ALL_ANTIBIOTICS.find(ab => ab.name.toLowerCase() === drug.toLowerCase())?.name || drug;
        const pct = localSusceptibility(drugName, proto.organism_target);
        if (pct !== null && pct < THRESHOLD) {
          belowThreshold = true;
          alertDrugs.push(`${drugName} (${pct}% susceptible)`);
        }
      });
    });

    const borderColor = belowThreshold ? 'var(--orange)' : 'var(--border)';
    const alertBanner = belowThreshold
      ? `<div style="background:rgba(249,115,22,0.1);border:1px solid rgba(249,115,22,0.3);border-radius:6px;padding:8px 12px;margin-top:10px;font-size:12px;color:var(--orange)">⚠️ Local susceptibility below ${THRESHOLD}% threshold: ${alertDrugs.map(escHtml).join('; ')}. Consider reviewing this protocol.</div>`
      : '';

    const card = document.createElement('div');
    card.className = 'card';
    card.style.borderColor = borderColor;
    card.style.marginBottom = '14px';
    card.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
            <span style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:2px 10px;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">${escHtml(proto.infection_type) || '—'}</span>
            <span style="font-size:13px;color:var(--text-dim)">Target: <strong style="color:var(--text)">${escHtml(proto.organism_target) || 'Any'}</strong></span>
          </div>
          <div style="display:grid;gap:5px">
            ${proto.line1 ? `<div style="font-size:13px"><span style="color:var(--green);font-weight:600;min-width:60px;display:inline-block">1st Line:</span> ${escHtml(proto.line1)}</div>` : ''}
            ${proto.line2 ? `<div style="font-size:13px"><span style="color:var(--yellow);font-weight:600;min-width:60px;display:inline-block">2nd Line:</span> ${escHtml(proto.line2)}</div>` : ''}
            ${proto.line3 ? `<div style="font-size:13px"><span style="color:var(--orange);font-weight:600;min-width:60px;display:inline-block">3rd Line:</span> ${escHtml(proto.line3)}</div>` : ''}
            ${proto.exceptions ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px;border-left:2px solid var(--border2);padding-left:8px"><em>${escHtml(proto.exceptions)}</em></div>` : ''}
          </div>
          ${alertBanner}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn-outline gl-edit-proto" data-id="${escHtml(proto.id)}" style="padding:5px 10px;font-size:12px">Edit</button>
          <button class="btn-danger gl-del-proto" data-id="${escHtml(proto.id)}" style="padding:5px 10px;font-size:12px">Delete</button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll('.gl-edit-proto').forEach(btn => {
    btn.addEventListener('click', () => openGuidelineProtocolModal(btn.dataset.id));
  });
  container.querySelectorAll('.gl-del-proto').forEach(btn => {
    btn.addEventListener('click', () => deleteGuidelineProtocol(btn.dataset.id));
  });
}

function openGuidelineProtocolModal(editId = null) {
  editingGuidelineId = editId || null;
  const proto = editId ? allGuidelines.find(p => p.id === editId) : null;
  document.getElementById('gl-proto-modal-title').textContent = editId ? 'Edit Protocol' : 'Add Protocol';
  document.getElementById('gl-proto-type').value       = proto?.infection_type || '';
  document.getElementById('gl-proto-organism').value   = proto?.organism_target || '';
  document.getElementById('gl-proto-1st').value        = proto?.line1 || '';
  document.getElementById('gl-proto-2nd').value        = proto?.line2 || '';
  document.getElementById('gl-proto-3rd').value        = proto?.line3 || '';
  document.getElementById('gl-proto-exceptions').value = proto?.exceptions || '';
  document.getElementById('gl-proto-error').style.display = 'none';
  document.getElementById('modal-gl-protocol').style.display = 'grid';
}

async function deleteGuidelineProtocol(id) {
  const proto = allGuidelines.find(p => p.id === id);
  if (!proto) return;
  if (!confirm('Delete this protocol?')) return;
  await deleteGuideline(proto);
  allGuidelines = allGuidelines.filter(p => p.id !== id);
  renderGuidelines();
}

// Wire up guidelines buttons
document.getElementById('gl-ward-select').addEventListener('change', () => {
  currentGuidelineWard = document.getElementById('gl-ward-select').value;
  renderGuidelines();
});

document.getElementById('gl-new-ward-btn').addEventListener('click', () => {
  document.getElementById('gl-new-ward-input').value = '';
  document.getElementById('modal-gl-ward').style.display = 'grid';
});

document.getElementById('gl-ward-modal-cancel').addEventListener('click', () => {
  document.getElementById('modal-gl-ward').style.display = 'none';
});

document.getElementById('gl-ward-modal-confirm').addEventListener('click', () => {
  const name = document.getElementById('gl-new-ward-input').value.trim();
  if (!name) return;
  document.getElementById('modal-gl-ward').style.display = 'none';
  currentGuidelineWard = name;
  // Add a placeholder protocol so ward appears; just set selection
  document.getElementById('gl-ward-select').add(new Option(name, name));
  document.getElementById('gl-ward-select').value = name;
  renderGuidelines();
});

document.getElementById('gl-add-protocol-btn').addEventListener('click', () => {
  openGuidelineProtocolModal();
});

document.getElementById('gl-proto-modal-cancel').addEventListener('click', () => {
  document.getElementById('modal-gl-protocol').style.display = 'none';
  editingGuidelineId = null;
});

document.getElementById('gl-proto-modal-confirm').addEventListener('click', async () => {
  const type = document.getElementById('gl-proto-type').value;
  const org  = document.getElementById('gl-proto-organism').value.trim();
  if (!type || !org) {
    const errEl = document.getElementById('gl-proto-error');
    errEl.textContent = 'Infection type and target organism are required.';
    errEl.style.display = 'block';
    return;
  }
  document.getElementById('gl-proto-error').style.display = 'none';

  const proto = {
    id:              editingGuidelineId || (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)),
    ward:            currentGuidelineWard,
    infection_type:  type,
    organism_target: org,
    line1:           document.getElementById('gl-proto-1st').value.trim(),
    line2:           document.getElementById('gl-proto-2nd').value.trim(),
    line3:           document.getElementById('gl-proto-3rd').value.trim(),
    exceptions:      document.getElementById('gl-proto-exceptions').value.trim(),
  };

  if (editingGuidelineId) {
    const existing = allGuidelines.find(p => p.id === editingGuidelineId);
    const merged   = { ...existing, ...proto };
    await updateGuideline(merged);
    allGuidelines = allGuidelines.map(p => p.id === editingGuidelineId ? merged : p);
  } else {
    const saved = await saveGuideline(proto);
    allGuidelines.push(saved);
  }
  editingGuidelineId = null;
  document.getElementById('modal-gl-protocol').style.display = 'none';
  renderGuidelines();
});

/* ══════════════════════════════════════════════════════════
   INIT — load data & wire up real-time listener
══════════════════════════════════════════════════════════ */
(async function init() {
  setStatus('connecting', 'Connecting…');

  try {
    [allCultures, allGuidelines] = await Promise.all([loadCultures(), loadGuidelines()]);
    setStatus(useFirebase ? 'connected' : 'connected', useFirebase ? 'Firebase' : 'Local');
  } catch (e) {
    setStatus('disconnected', 'Offline');
    console.error('[Load]', e);
  }

  // Populate specimen selects with static list immediately
  populateSpecimenFilters();
  populateWardFilters();

  // Subscribe to real-time updates
  subscribeCultures(cultures => {
    allCultures = cultures;
    populateWardFilters();
    const activePage = document.querySelector('.page.active')?.id?.replace('page-', '');
    if (activePage) renderActivePage(activePage);
  });

  // Render default page
  renderHome();
})();
