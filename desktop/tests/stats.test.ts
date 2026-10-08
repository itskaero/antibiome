import { describe, expect, it } from 'vitest';
import { chiSquareKx2, chiSquareP, gammaQ, kruskalWallis, logisticRegression } from '../shared/stats';

describe('chi-square family', () => {
  it('chi-square CDF matches tables', () => {
    expect(chiSquareP(3.841, 1)).toBeCloseTo(0.05, 3);
    expect(chiSquareP(5.991, 2)).toBeCloseTo(0.05, 3);
    expect(chiSquareP(11.07, 5)).toBeCloseTo(0.05, 3);
    expect(gammaQ(1, 0)).toBe(1);
  });
  it('k × 2 table', () => {
    // Classic example: 3 groups, yes/no
    const r = chiSquareKx2([[10, 20], [20, 10], [15, 15]]);
    expect(r.df).toBe(2);
    expect(r.stat).toBeCloseTo(6.667, 2);
    expect(r.p).toBeCloseTo(0.0357, 3);
  });
  it('Kruskal–Wallis', () => {
    const r = kruskalWallis([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
    expect(r.H).toBeCloseTo(7.2, 5);
    expect(r.p).toBeCloseTo(0.0273, 3);
  });
});

describe('logistic regression', () => {
  it('recovers the 2×2 odds ratio exactly for a single binary predictor', () => {
    // exposed: 12 events / 20; unexposed: 6 / 30 → OR = (12/8)/(6/24) = 6
    const X: number[][] = [], y: number[] = [];
    for (let i = 0; i < 20; i++) { X.push([1]); y.push(i < 12 ? 1 : 0); }
    for (let i = 0; i < 30; i++) { X.push([0]); y.push(i < 6 ? 1 : 0); }
    const r = logisticRegression(X, y, ['exposed']);
    expect(r.converged).toBe(true);
    expect(r.terms[0].or).toBeCloseTo(6, 4);
    // Woolf SE = sqrt(1/12 + 1/8 + 1/6 + 1/24) = 0.6455
    expect(r.terms[0].se).toBeCloseTo(0.6455, 3);
  });
  it('warns on complete separation', () => {
    const r = logisticRegression([[0], [0], [0], [1], [1], [1]], [0, 0, 0, 1, 1, 1], ['x']);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
