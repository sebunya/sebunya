/**
 * Attribution science (dossier §9.3–9.5, numerical reference §13.4). Pure: no
 * database, no clock. Observational only — none of these is a causal estimate.
 */

export interface Touch { channel: string; at: Date }

/** Exact signed integer allocation; stable largest-remainder tie break by key. */
export function allocateInteger(total: bigint, weights: Record<string, number>): Record<string, bigint> {
  const keys = Object.keys(weights);
  if (keys.some((k) => !(weights[k] >= 0) || !Number.isFinite(weights[k]))) throw new Error('negative or invalid weight');
  // Weights to exact integers (1e12 resolution); the quota arithmetic is then exact.
  const w = Object.fromEntries(keys.map((k) => [k, BigInt(Math.round(weights[k] * 1e12))]));
  const denom = keys.reduce((s, k) => s + w[k], 0n);
  if (denom <= 0n) throw new Error('weights must sum positive');
  const abs = total < 0n ? -total : total;
  const base: Record<string, bigint> = {};
  const rem: Record<string, bigint> = {};
  for (const k of keys) { base[k] = (abs * w[k]) / denom; rem[k] = (abs * w[k]) % denom; }
  let left = abs - keys.reduce((s, k) => s + base[k], 0n);
  const order = [...keys].sort((a, b) => (rem[b] > rem[a] ? 1 : rem[b] < rem[a] ? -1 : a < b ? -1 : a > b ? 1 : 0));
  for (const k of order) { if (left <= 0n) break; base[k] += 1n; left -= 1n; }
  return Object.fromEntries(keys.map((k) => [k, total < 0n ? -base[k] : base[k]]));
}

export const RULE_METHODS = ['first_touch', 'last_touch', 'last_non_direct', 'linear', 'position_based', 'time_decay'] as const;
export type RuleMethod = typeof RULE_METHODS[number];
export interface RulePolicy { positionFirst: number; positionLast: number; halfLifeDays: number }
export const DEFAULT_RULE_POLICY: RulePolicy = { positionFirst: 0.4, positionLast: 0.4, halfLifeDays: 7 };

/** Channel weights (summing to 1) for one journey; null = UNATTRIBUTED. Touches must be time-ordered. */
export function ruleWeights(method: RuleMethod, touches: Touch[], conversionAt: Date, policy: RulePolicy = DEFAULT_RULE_POLICY): Record<string, number> | null {
  if (!touches.length) return null;
  const per: number[] = touches.map(() => 0);
  const n = touches.length;
  switch (method) {
    case 'first_touch': per[0] = 1; break;
    case 'last_touch': per[n - 1] = 1; break;
    case 'last_non_direct': {
      let i = n - 1; while (i >= 0 && touches[i].channel === 'direct') i--;
      per[i >= 0 ? i : n - 1] = 1; break;
    }
    case 'linear': per.fill(1 / n); break;
    case 'position_based':
      if (n === 1) per[0] = 1;
      else if (n === 2) { per[0] = 0.5; per[1] = 0.5; }
      else {
        per[0] = policy.positionFirst; per[n - 1] = policy.positionLast;
        const mid = (1 - policy.positionFirst - policy.positionLast) / (n - 2);
        for (let i = 1; i < n - 1; i++) per[i] = mid;
      }
      break;
    case 'time_decay': {
      const raw = touches.map((t) => 2 ** (-Math.max(0, conversionAt.getTime() - t.at.getTime()) / 86_400_000 / policy.halfLifeDays));
      const s = raw.reduce((a, b) => a + b, 0);
      raw.forEach((r, i) => { per[i] = r / s; });
      break;
    }
  }
  // Touches on one channel combine after touch-level weighting.
  const out: Record<string, number> = {};
  touches.forEach((t, i) => { if (per[i] > 0) out[t.channel] = (out[t.channel] ?? 0) + per[i]; });
  return out;
}

export interface Journey { path: string[]; converted: boolean }
const START = '__START__';

/**
 * START→CONVERSION probability of the observed first-order chain. Channels
 * outside `allowed` are redirect-to-NULL (dossier's removal rule). Throws on an
 * empty, singular or non-absorbing chain rather than manufacturing a number.
 */
export function markovProbability(journeys: Journey[], allowed?: Set<string>): number {
  if (!journeys.length) throw new Error('empty journeys');
  const channels = [...new Set(journeys.flatMap((j) => j.path))].sort();
  if (channels.some((c) => c.startsWith('__'))) throw new Error('reserved channel name');
  const ok = allowed ?? new Set(channels);
  for (const c of ok) if (!channels.includes(c)) throw new Error('unknown coalition channel');
  const states = [START, ...channels];
  const idx = new Map(states.map((s, i) => [s, i]));
  const counts = states.map(() => new Map<string, number>());
  for (const j of journeys) {
    const seq = [START, ...j.path, j.converted ? '__CONVERSION__' : '__NULL__'];
    for (let i = 0; i + 1 < seq.length; i++) {
      const m = counts[idx.get(seq[i])!];
      m.set(seq[i + 1], (m.get(seq[i + 1]) ?? 0) + 1);
    }
  }
  const n = states.length;
  const A = states.map((_, i) => states.map((__, k) => (i === k ? 1 : 0)));
  const r = states.map(() => 0);
  states.forEach((s, i) => {
    if (s !== START && !ok.has(s)) return;
    const total = [...counts[i].values()].reduce((a, b) => a + b, 0);
    if (!total) return;
    for (const [to, c] of counts[i]) {
      const p = c / total;
      if (to === '__CONVERSION__') r[i] += p;
      else if (ok.has(to)) A[i][idx.get(to)!] -= p;
    }
  });
  // Gaussian elimination with partial pivoting on (I − Q) p = r.
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let i = col + 1; i < n; i++) if (Math.abs(A[i][col]) > Math.abs(A[piv][col])) piv = i;
    if (Math.abs(A[piv][col]) < 1e-12) throw new Error('ill-conditioned or nonabsorbing chain');
    [A[col], A[piv]] = [A[piv], A[col]]; [r[col], r[piv]] = [r[piv], r[col]];
    for (let i = 0; i < n; i++) {
      if (i === col) continue;
      const f = A[i][col] / A[col][col];
      if (!f) continue;
      for (let k = col; k < n; k++) A[i][k] -= f * A[col][k];
      r[i] -= f * r[col];
    }
  }
  const p = r[0] / A[0][0];
  if (!Number.isFinite(p) || p < -1e-10 || p > 1 + 1e-10) throw new Error('invalid probability');
  return Math.min(1, Math.max(0, p));
}

/** Raw removal effects (p_full − p_without)/p_full. Not clipped: negatives are diagnostics. */
export function markovRemovalEffects(journeys: Journey[]): { full: number; effects: Record<string, number> } {
  const channels = [...new Set(journeys.flatMap((j) => j.path))].sort();
  const full = markovProbability(journeys);
  const effects: Record<string, number> = {};
  for (const c of channels) {
    const without = markovProbability(journeys, new Set(channels.filter((x) => x !== c)));
    effects[c] = full > 0 ? (full - without) / full : 0;
  }
  return { full, effects };
}

export const SHAPLEY_EXACT_LIMIT = 8;
/** Exact Shapley over grouped channels; value = Markov START→CONVERSION under the coalition. */
export function exactShapley(journeys: Journey[], maxPlayers = SHAPLEY_EXACT_LIMIT): { baseline: number; full: number; shapley: Record<string, number> } {
  const ch = [...new Set(journeys.flatMap((j) => j.path))].sort();
  const n = ch.length;
  if (n > maxPlayers) throw new Error('exact coalition budget exceeded');
  const v = new Map<number, number>();
  for (let mask = 0; mask < 1 << n; mask++) v.set(mask, markovProbability(journeys, new Set(ch.filter((_, i) => mask & (1 << i)))));
  const fact = (k: number) => { let f = 1; for (let i = 2; i <= k; i++) f *= i; return f; };
  const pop = (m: number) => { let c = 0; while (m) { c += m & 1; m >>= 1; } return c; };
  const shapley: Record<string, number> = {};
  ch.forEach((c, i) => {
    let s = 0;
    for (let mask = 0; mask < 1 << n; mask++) {
      if (mask & (1 << i)) continue;
      const k = pop(mask);
      s += (fact(k) * fact(n - k - 1) / fact(n)) * (v.get(mask | (1 << i))! - v.get(mask)!);
    }
    shapley[c] = s;
  });
  return { baseline: v.get(0)!, full: v.get((1 << n) - 1)!, shapley };
}
