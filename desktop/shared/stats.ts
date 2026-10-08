// Small, dependency-free statistics used by change detection and summaries.

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
export function medianIqr(values: number[]): { median: number; q1: number; q3: number; n: number } | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return { median: quantile(s, 0.5), q1: quantile(s, 0.25), q3: quantile(s, 0.75), n: s.length };
}

function logFactorial(n: number): number {
  let r = 0; for (let i = 2; i <= n; i++) r += Math.log(i); return r;
}
const logChoose = (n: number, k: number) => logFactorial(n) - logFactorial(k) - logFactorial(n - k);

/** Two-sided Fisher exact test for a 2×2 table [[a,b],[c,d]]. */
export function fisherExact(a: number, b: number, c: number, d: number): number {
  const r1 = a + b, r2 = c + d, c1 = a + c, n = r1 + r2;
  const logDenom = logChoose(n, c1);
  const p = (x: number) => Math.exp(logChoose(r1, x) + logChoose(r2, c1 - x) - logDenom);
  const pObs = p(a);
  let total = 0;
  for (let x = Math.max(0, c1 - r2); x <= Math.min(r1, c1); x++) {
    const px = p(x);
    if (px <= pObs * (1 + 1e-7)) total += px;
  }
  return Math.min(1, total);
}

/** Two-sided exact binomial test P(X as or more extreme than k | n, p). */
export function binomialTwoSided(k: number, n: number, p: number): number {
  if (n === 0) return 1;
  const pmf = (x: number) => Math.exp(logChoose(n, x) + x * Math.log(p) + (n - x) * Math.log(1 - p));
  const pObs = pmf(k);
  let total = 0;
  for (let x = 0; x <= n; x++) { const px = pmf(x); if (px <= pObs * (1 + 1e-7)) total += px; }
  return Math.min(1, total);
}

/**
 * Compare two Poisson counts with exposures (e.g. events per patient-day) using the
 * conditional binomial test: given k1+k2, k1 ~ Bin(k1+k2, e1/(e1+e2)) under H0.
 */
export function poissonRateTest(k1: number, e1: number, k2: number, e2: number): number {
  if (e1 <= 0 || e2 <= 0) return 1;
  return binomialTwoSided(k1, k1 + k2, e1 / (e1 + e2));
}

/** Wilson 95% interval for a proportion. */
export function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, den = 1 + z * z / n;
  const centre = (p + z * z / (2 * n)) / den;
  const half = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / den;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Standard normal CDF (Abramowitz–Stegun 26.2.17, |error| < 7.5e-8). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

/**
 * Two-sided Mann–Whitney U test, normal approximation with tie and continuity correction.
 * Approximate for small samples; callers label it as such.
 */
export function mannWhitney(a: number[], b: number[]): { U: number; p: number } {
  const n1 = a.length, n2 = b.length;
  if (!n1 || !n2) return { U: NaN, p: 1 };
  const all = [...a.map(v => ({ v, g: 0 })), ...b.map(v => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  const ranks = new Array(all.length);
  let tieTerm = 0;
  for (let i = 0; i < all.length;) {
    let j = i; while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const r = (i + j) / 2 + 1, t = j - i + 1;
    for (let k = i; k <= j; k++) ranks[k] = r;
    tieTerm += t ** 3 - t;
    i = j + 1;
  }
  const r1 = all.reduce((s, x, i) => s + (x.g === 0 ? ranks[i] : 0), 0);
  const U1 = r1 - n1 * (n1 + 1) / 2, U = Math.min(U1, n1 * n2 - U1);
  const n = n1 + n2;
  const sigma = Math.sqrt((n1 * n2 / 12) * ((n + 1) - tieTerm / (n * (n - 1))));
  if (!sigma) return { U, p: 1 };
  const z = (Math.abs(U1 - n1 * n2 / 2) - 0.5) / sigma;
  return { U, p: Math.min(1, 2 * (1 - normalCdf(Math.max(0, z)))) };
}

// ── Chi-square family ────────────────────────────────────────

function logGamma(x: number): number {
  // Lanczos approximation (g = 7, n = 9)
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularised upper incomplete gamma Q(a, x) (series / continued fraction, Numerical Recipes). */
export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let sum = 1 / a, del = sum, ap = a;
    for (let n = 0; n < 500; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-14) break; }
    return Math.max(0, 1 - sum * Math.exp(-x + a * Math.log(x) - logGamma(a)));
  }
  let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a); b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.min(1, Math.exp(-x + a * Math.log(x) - logGamma(a)) * h);
}
export const chiSquareP = (stat: number, df: number) => gammaQ(df / 2, stat / 2);

/** Pearson chi-square test of independence for a k × 2 table [[yes, no], …]. */
export function chiSquareKx2(table: [number, number][]): { stat: number; df: number; p: number; minExpected: number } {
  const rows = table.filter(([a, b]) => a + b > 0);
  const N = rows.reduce((s, [a, b]) => s + a + b, 0);
  const colYes = rows.reduce((s, [a]) => s + a, 0), colNo = N - colYes;
  let stat = 0, minExpected = Infinity;
  rows.forEach(([a, b]) => {
    const n = a + b;
    const ea = (n * colYes) / N, eb = (n * colNo) / N;
    minExpected = Math.min(minExpected, ea, eb);
    if (ea > 0) stat += (a - ea) ** 2 / ea;
    if (eb > 0) stat += (b - eb) ** 2 / eb;
  });
  const df = rows.length - 1;
  return { stat, df, p: df > 0 && colYes > 0 && colNo > 0 ? chiSquareP(stat, df) : 1, minExpected };
}

/** Kruskal–Wallis H test with tie correction. */
export function kruskalWallis(groups: number[][]): { H: number; df: number; p: number } {
  const gs = groups.filter(g => g.length);
  const all = gs.flatMap((g, gi) => g.map(v => ({ v, gi }))).sort((a, b) => a.v - b.v);
  const N = all.length;
  const rankSum = new Array(gs.length).fill(0);
  let tie = 0;
  for (let i = 0; i < N;) {
    let j = i; while (j + 1 < N && all[j + 1].v === all[i].v) j++;
    const r = (i + j) / 2 + 1, t = j - i + 1;
    for (let k = i; k <= j; k++) rankSum[all[k].gi] += r;
    tie += t ** 3 - t;
    i = j + 1;
  }
  let H = (12 / (N * (N + 1))) * gs.reduce((s, g, i) => s + rankSum[i] ** 2 / g.length, 0) - 3 * (N + 1);
  const C = 1 - tie / (N ** 3 - N);
  if (C > 0) H /= C;
  const df = gs.length - 1;
  return { H, df, p: df > 0 && C > 0 ? chiSquareP(H, df) : 1 };
}

// ── Logistic regression (IRLS) ───────────────────────────────

function invert(m: number[][]): number[][] | null {
  const n = m.length, a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) return null;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c]; for (let k = 0; k < 2 * n; k++) a[c][k] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = a[r][c]; if (f) for (let k = 0; k < 2 * n; k++) a[r][k] -= f * a[c][k]; }
  }
  return a.map(row => row.slice(n));
}

export interface LogisticResult {
  terms: { name: string; beta: number; se: number; or: number; lo: number; hi: number; p: number }[];
  n: number; events: number; converged: boolean; iterations: number; warnings: string[];
}

/** Logistic regression by iteratively re-weighted least squares; Wald 95% CIs. X excludes the intercept. */
export function logisticRegression(X: number[][], y: number[], names: string[]): LogisticResult {
  const n = y.length, p = names.length + 1;
  const Z = X.map(r => [1, ...r]);
  let beta = new Array(p).fill(0);
  let converged = false, it = 0, cov: number[][] | null = null;
  for (it = 1; it <= 50; it++) {
    const H = Array.from({ length: p }, () => new Array(p).fill(0)), g = new Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      const eta = Z[i].reduce((s, v, j) => s + v * beta[j], 0);
      const mu = 1 / (1 + Math.exp(-eta)), w = Math.max(mu * (1 - mu), 1e-10);
      for (let j = 0; j < p; j++) { g[j] += Z[i][j] * (y[i] - mu); for (let k = 0; k < p; k++) H[j][k] += w * Z[i][j] * Z[i][k]; }
    }
    cov = invert(H);
    if (!cov) break;
    const step = cov.map(row => row.reduce((s, v, k) => s + v * g[k], 0));
    beta = beta.map((b, j) => b + step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) { converged = true; break; }
  }
  const warnings: string[] = [];
  const events = Math.min(y.filter(v => v === 1).length, y.filter(v => v === 0).length);
  if (!cov) warnings.push('The model could not be estimated (collinear or constant predictors).');
  if (!converged) warnings.push('The model did not converge — often a sign of complete separation; estimates are unreliable.');
  if (beta.some(b => Math.abs(b) > 10)) warnings.push('Very large coefficients suggest (quasi-)separation; odds ratios are unreliable.');
  const terms = names.map((name, j) => {
    const b = beta[j + 1], se = cov ? Math.sqrt(Math.max(cov[j + 1][j + 1], 0)) : NaN;
    const z = b / se;
    return { name, beta: b, se, or: Math.exp(b), lo: Math.exp(b - 1.96 * se), hi: Math.exp(b + 1.96 * se), p: Number.isFinite(z) ? 2 * (1 - normalCdf(Math.abs(z))) : NaN };
  });
  return { terms, n, events, converged, iterations: it, warnings };
}
