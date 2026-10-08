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
