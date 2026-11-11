'use strict';
/**
 * GDR progressive allocation curve — ILLUSTRATIVE MODEL.
 *
 * Spec constraints (Smart Contract Spec §3.2):
 *   A(1) = 21 GDR, A(N) = 0.21 GDR, N = 10,000,000 positions,
 *   sum A(n) for n=1..N = 10,000,000 GDR, non-increasing.
 *
 * NOTE: a plain exponential decay between 21 and 0.21 would distribute ~45M GDR,
 * i.e. 4.5x the budget. To honour all three constraints this model uses a
 * power-decay curve:
 *
 *   A(n) = MIN + (MAX - MIN) * (1 - x)^k,   x = (n - 1) / (N - 1)
 *
 * with k solved so the total equals the 10M budget. The final on-chain formula
 * must be approved by the tokenomics owner; the UI labels every figure produced
 * here as an estimate.
 */

const N = 10_000_000;
const MAX = 21;
const MIN = 0.21;
const BUDGET = 10_000_000;
const SPAN = MAX - MIN;

// Euler–Maclaurin: sum ≈ (N-1)·∫f + (f(0)+f(1))/2, ∫f = MIN + SPAN/(k+1)
const targetMean = (BUDGET - (MAX + MIN) / 2) / (N - 1);
const K = SPAN / (targetMean - MIN) - 1;

function allocationAt(n) {
  if (!Number.isInteger(n) || n < 1 || n > N) {
    throw new RangeError(`claim position must be an integer in 1..${N}`);
  }
  const x = (n - 1) / (N - 1);
  return MIN + SPAN * Math.pow(1 - x, K);
}

/** Approximate GDR distributed after the first m claims (0 <= m <= N). */
function distributedAfter(m) {
  if (m <= 0) return 0;
  if (m >= N) return BUDGET;
  const xm = (m - 1) / (N - 1);
  const integral = MIN * xm + (SPAN / (K + 1)) * (1 - Math.pow(1 - xm, K + 1));
  return (N - 1) * integral + (MAX + allocationAt(m)) / 2;
}

/** Downsampled points for charting (x = claim position, y = GDR). */
function samplePoints(count = 120) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    // denser sampling at the start where the curve is steep
    const t = Math.pow(i / (count - 1), 2);
    const n = Math.max(1, Math.round(1 + t * (N - 1)));
    pts.push([n, +allocationAt(n).toFixed(6)]);
  }
  return pts;
}

module.exports = {
  N, MAX, MIN, BUDGET, K,
  allocationAt, distributedAfter, samplePoints,
  meta: {
    model: 'power-decay',
    formula: 'A(n) = 0.21 + 20.79 × (1 − (n−1)/(N−1))^k',
    k: +K.toFixed(6),
    status: 'Illustrative — final formula pending tokenomics & engineering approval',
  },
};
