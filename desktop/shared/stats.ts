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
