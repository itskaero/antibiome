// ═══════════════════════════════════════════════════════════
//  app.js  —  NICU Antibiogram  (vanilla JS, Chart.js 4)
// ═══════════════════════════════════════════════════════════

import { saveCulture, loadCultures, deleteCulture, subscribeCultures, updateCulture, useFirebase }
  from './firebase-config.js';

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
let allCultures  = [];
let chartInstances = {};
let pendingDeleteId = null;
let editingId = null;

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
  if (page === 'home')        { populateSpecimenFilters(); renderHome(); }
  if (page === 'trends')      { populateTrendFilters(); renderTrends(); }
  if (page === 'antibiogram') { populateABFilters(); renderAntibiogram(); }
  if (page === 'mdr')         { renderMDR(); }
  if (page === 'records')     { renderRecords(); }
}

/* ══════════════════════════════════════════════════════════
   MDR LOGIC
══════════════════════════════════════════════════════════ */
function isMDR(entry) {
  const rc = new Set();
  (entry.antibiotics || []).forEach(({ name, result }) => {
    if (result === 'R' || result === 'I') {
      const cls = DRUG_TO_CLASS[name];
      if (cls) rc.add(cls);
    }
  });
  return rc.size >= 3;
}

function resistantClasses(entry) {
  const rc = new Set();
  (entry.antibiotics || []).forEach(({ name, result }) => {
    if (result === 'R' || result === 'I') {
      const cls = DRUG_TO_CLASS[name];
      if (cls) rc.add(cls);
    }
  });
  return [...rc];
}

/* ══════════════════════════════════════════════════════════
   FILTER HELPERS
══════════════════════════════════════════════════════════ */
function getHomeFiltered() {
  const specimen  = document.getElementById('home-filter-specimen').value;
  const ageGroup  = document.getElementById('home-filter-agegroup').value;
  const month     = document.getElementById('home-filter-month').value;   // "YYYY-MM"
  return allCultures.filter(c => {
    if (specimen && c.specimen !== specimen) return false;
    if (ageGroup && c.age_group !== ageGroup) return false;
    if (month && !c.date?.startsWith(month)) return false;
    return true;
  });
}

function getTrendFiltered() {
  const organism  = document.getElementById('trend-filter-organism').value;
  const specimen  = document.getElementById('trend-filter-specimen').value;
  return allCultures.filter(c => {
    if (organism && c.organism !== organism) return false;
    if (specimen && c.specimen !== specimen) return false;
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
}

/* ══════════════════════════════════════════════════════════
   ANTIBIOGRAM PAGE
══════════════════════════════════════════════════════════ */
function renderAntibiogram() {
  const specFilter = document.getElementById('ab-filter-specimen')?.value || '';
  const yearFilter = document.getElementById('ab-filter-year')?.value || '';
  const data = allCultures.filter(c => {
    if (specFilter && c.specimen !== specFilter) return false;
    if (yearFilter && c.date?.slice(0, 4) !== yearFilter) return false;
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
  const mdrCases = allCultures.filter(isMDR);
  const total    = allCultures.length;
  const rate     = total ? Math.round(mdrCases.length / total * 100) : 0;
  const mdrOrgs  = new Set(mdrCases.map(c => c.organism).filter(Boolean)).size;

  document.getElementById('mdr-kpi-total').textContent = mdrCases.length;
  document.getElementById('mdr-kpi-rate').textContent  = rate + '%';
  document.getElementById('mdr-kpi-orgs').textContent  = mdrOrgs;

  // MDR trend chart
  const months = sortedMonths(allCultures);
  const mdrByM  = months.map(m => allCultures.filter(c => c.date?.startsWith(m) && isMDR(c)).length);
  const pctByM  = months.map((m, i) => {
    const tot = allCultures.filter(c => c.date?.startsWith(m)).length;
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
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.date || '—'}</td>
      <td>${c.patient_name || '—'}</td>
      <td>${c.age_group || '—'}</td>
      <td>${c.organism || '—'}</td>
      <td>${c.specimen || '—'}</td>
      <td><small style="color:#f87171">${cls.join(', ')}</small></td>
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
  const mdr = isMDR(entry);
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
      <div class="view-field"><span class="view-label">Organism</span><span class="view-val">${entry.organism || '\u2014'}</span></div>
      <div class="view-field"><span class="view-label">MDR Status</span><span class="view-val">${mdr ? '<span class="badge-mdr">MDR</span>' : '<span class="badge-ok">Non-MDR</span>'}</span></div>
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
['home-filter-specimen','home-filter-agegroup','home-filter-month'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', renderHome);
});
['trend-filter-organism','trend-filter-specimen'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', renderTrends);
});
['ab-filter-specimen','ab-filter-year'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', renderAntibiogram);
});

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
   INIT — load data & wire up real-time listener
══════════════════════════════════════════════════════════ */
(async function init() {
  setStatus('connecting', 'Connecting…');

  try {
    allCultures = await loadCultures();
    setStatus(useFirebase ? 'connected' : 'connected', useFirebase ? 'Firebase' : 'Local');
  } catch (e) {
    setStatus('disconnected', 'Offline');
    console.error('[Load]', e);
  }

  // Populate specimen selects with static list immediately
  populateSpecimenFilters();

  // Subscribe to real-time updates
  subscribeCultures(cultures => {
    allCultures = cultures;
    const activePage = document.querySelector('.page.active')?.id?.replace('page-', '');
    if (activePage) renderActivePage(activePage);
  });

  // Render default page
  renderHome();
})();
