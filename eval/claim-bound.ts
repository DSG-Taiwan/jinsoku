/** One-sided 95% upper bound on a fallback rate. Zero failures in 120 runs is 2.5%. */
export function fallbackUpperBound(failures: number, runs: number): number {
  if (runs <= 0) throw new Error("runs required");
  if (failures < 0 || failures > runs) throw new Error("failures out of range");
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 60; step += 1) {
    const mid = (lo + hi) / 2;
    if (binomCdf(failures, runs, mid) > 0.05) lo = mid;
    else hi = mid;
  }
  return hi;
}

function binomCdf(failures: number, runs: number, rate: number): number {
  if (rate <= 0) return 1;
  if (rate >= 1) return failures === runs ? 1 : 0;
  let term = (1 - rate) ** runs;
  let sum = term;
  for (let seen = 0; seen < failures; seen += 1) {
    term *= ((runs - seen) / (seen + 1)) * (rate / (1 - rate));
    sum += term;
  }
  return sum;
}
