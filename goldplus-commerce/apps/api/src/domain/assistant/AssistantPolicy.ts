/**
 * Shop-assistant policy (2026-10-12 mandate §5, §5A). Pure: no I/O, no clock.
 *
 * Three separate concerns, each with its own numbers and its own answer:
 *   fairness   — four meaningful requests per rolling day feel unrestricted;
 *                from the fifth, invisible per-visitor paid-generation allowances
 *   abuse      — bursts and floods are refused from request one, before any
 *                paid call; a shared mobile-carrier address is never a reason
 *                to lock out the people behind it
 *   money      — a monthly cap enforced by an atomic reservation ledger; the
 *                kill threshold sits under the cap so settlement rounding and
 *                in-flight calls cannot overshoot it
 * None of them is a prompt. The model never sees or decides any of this.
 */

export interface AssistantConfig {
  /** Whole assistant (deterministic help + widget). */
  enabled: boolean;
  /** Paid model layer only; off = deterministic help and hand-over keep working. */
  aiEnabled: boolean;
  model: string;
  effort: 'low' | 'medium';
  /** Month cap and the lower kill threshold, in micro-USD (1 USD = 1,000,000). */
  monthlyCapMicroUsd: number;
  killThresholdMicroUsd: number;
  alarmThresholdsMicroUsd: number[];
  /** Fairness: meaningful requests per rolling window that carry no visible friction. */
  freeRequests: number;
  fairnessWindowHours: number;
  /** Progressive (from request freeRequests+1): silent paid-generation allowances per principal. */
  paidPerHour: number;
  paidPerDay: number;
  /** Short pacing window: at most this many paid generations per principal per pacingSeconds. */
  paidPerPacingWindow: number;
  pacingSeconds: number;
  /** Abuse: any request kind, per principal and per network address, per minute. */
  burstPerMinute: number;
  addressPerMinute: number;
  /** Per-turn bounds the engine enforces; they size the reservation. */
  maxOutputTokens: number;
  maxToolRounds: number;
  maxInputTokensPerCall: number;
}

export const DEFAULT_ASSISTANT_CONFIG: AssistantConfig = {
  enabled: true,
  aiEnabled: true,
  model: 'claude-haiku-5-5',
  effort: 'low',
  monthlyCapMicroUsd: 5_000_000,
  killThresholdMicroUsd: 4_500_000,
  alarmThresholdsMicroUsd: [2_500_000, 3_500_000, 4_250_000],
  freeRequests: 4,
  fairnessWindowHours: 24,
  paidPerHour: 12,
  paidPerDay: 24,
  paidPerPacingWindow: 2,
  pacingSeconds: 15,
  burstPerMinute: 20,
  addressPerMinute: 120,
  maxOutputTokens: 1024,
  maxToolRounds: 4,
  maxInputTokensPerCall: 16_000,
};

const int = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.min(Math.max(n, min), max);
};

/** Coerce any stored/submitted value to a safe config; unknown keys are dropped, bad values fall back. */
export function sanitizeAssistantConfig(raw: unknown): AssistantConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_ASSISTANT_CONFIG;
  const cap = int(r.monthlyCapMicroUsd, d.monthlyCapMicroUsd, 0, 1_000_000_000);
  const kill = Math.min(int(r.killThresholdMicroUsd, d.killThresholdMicroUsd, 0, 1_000_000_000), cap);
  const alarms = Array.isArray(r.alarmThresholdsMicroUsd)
    ? r.alarmThresholdsMicroUsd.map((a) => int(a, 0, 0, 1_000_000_000)).filter((a) => a > 0 && a <= cap).sort((a, b) => a - b).slice(0, 6)
    : d.alarmThresholdsMicroUsd.filter((a) => a <= cap);
  const model = typeof r.model === 'string' && /^claude-[a-z0-9-]{3,40}$/.test(r.model) ? r.model : d.model;
  return {
    enabled: r.enabled === undefined ? d.enabled : !!r.enabled,
    aiEnabled: r.aiEnabled === undefined ? d.aiEnabled : !!r.aiEnabled,
    model,
    effort: r.effort === 'medium' ? 'medium' : 'low',
    monthlyCapMicroUsd: cap,
    killThresholdMicroUsd: kill,
    alarmThresholdsMicroUsd: alarms,
    freeRequests: int(r.freeRequests, d.freeRequests, 0, 100),
    fairnessWindowHours: int(r.fairnessWindowHours, d.fairnessWindowHours, 1, 24 * 30),
    paidPerHour: int(r.paidPerHour, d.paidPerHour, 0, 10_000),
    paidPerDay: int(r.paidPerDay, d.paidPerDay, 0, 100_000),
    paidPerPacingWindow: int(r.paidPerPacingWindow, d.paidPerPacingWindow, 1, 100),
    pacingSeconds: int(r.pacingSeconds, d.pacingSeconds, 1, 600),
    burstPerMinute: int(r.burstPerMinute, d.burstPerMinute, 1, 10_000),
    addressPerMinute: int(r.addressPerMinute, d.addressPerMinute, 1, 100_000),
    maxOutputTokens: int(r.maxOutputTokens, d.maxOutputTokens, 128, 8192),
    maxToolRounds: int(r.maxToolRounds, d.maxToolRounds, 0, 8),
    maxInputTokensPerCall: int(r.maxInputTokensPerCall, d.maxInputTokensPerCall, 1000, 200_000),
  };
}

/** Published Claude API prices (micro-USD per token), verified 2026-10-12 against platform.claude.com. */
export interface ModelPrice { input: number; output: number; cacheRead: number; cacheWrite: number }
export const MODEL_PRICES: Record<string, ModelPrice> = {
  // $0.10 / $0.50 per MTok; cache read $0.01, 5-minute cache write $0.125 (prompts ≤ 100k tokens).
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  // $2 / $10; cache read 5% of input ($0.10), write $2.50.
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  // $4 / $20; cache read 5% ($0.20), write $5.
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};
/** An unknown model is priced at the dearest known rate: never cheaper than reality. */
export const PESSIMISTIC_PRICE: ModelPrice = MODEL_PRICES['claude-opus-5-5']!;
export const priceFor = (model: string): ModelPrice => MODEL_PRICES[model] ?? PESSIMISTIC_PRICE;

export interface Usage { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }

/** Whole micro-USD, rounded up: the ledger never under-counts. */
export function costMicroUsd(usage: Usage, model: string): number {
  const p = priceFor(model);
  const raw = usage.inputTokens * p.input + usage.outputTokens * p.output + usage.cacheReadTokens * p.cacheRead + usage.cacheWriteTokens * p.cacheWrite;
  return Math.ceil(Math.max(0, raw));
}

/**
 * What one customer turn can cost at most, priced as if nothing were cached:
 * (rounds + 1) model calls, each at the input ceiling and the output ceiling.
 * This is what is reserved before the first call; settlement replaces it with
 * the provider-reported usage.
 */
export function reservationMicroUsd(config: AssistantConfig, model = config.model): number {
  const p = priceFor(model);
  const calls = config.maxToolRounds + 1;
  return Math.ceil(calls * (config.maxInputTokensPerCall * p.input + config.maxOutputTokens * p.output));
}

export const monthKey = (at: Date): string => `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;

export type AdmissionDecision =
  | 'DISABLED'
  | 'DENY_EXPENSIVE'
  | 'ALLOW_DETERMINISTIC'
  | 'AI_DISABLED'
  | 'SOFT_LIMIT'
  | 'GLOBAL_BUDGET_FALLBACK'
  | 'ALLOW_AI';

export type AdmissionTier = 'welcome' | 'progressive';

export interface AdmissionSignals {
  /** Meaningful requests by this principal in the fairness window, including this one. */
  meaningfulInWindow: number;
  /** Any requests by this principal / this network address in the last minute, including this one. */
  burstInMinute: number;
  addressInMinute: number;
  /** Paid generations by this principal, including this one when counted. */
  paidInHour: number;
  paidInDay: number;
  paidInPacingWindow: number;
  /** Month ledger before this request. */
  settledMicroUsd: number;
  reservedMicroUsd: number;
}

export interface AdmissionResult {
  decision: AdmissionDecision;
  tier: AdmissionTier;
  retryAfterSeconds?: number;
  /** Operator-facing reason; never shown to customers verbatim. */
  reason: string;
}

/**
 * The decision table (§5A.G). Order matters: hostile traffic is refused before
 * anything is counted or reserved; a deterministic answer never needs budget;
 * fairness tiers only govern PAID generation; the global ledger is the last word.
 */
export function decideAdmission(config: AssistantConfig, wantsAi: boolean, s: AdmissionSignals): AdmissionResult {
  const tier: AdmissionTier = s.meaningfulInWindow <= config.freeRequests ? 'welcome' : 'progressive';
  if (!config.enabled) return { decision: 'DISABLED', tier, reason: 'assistant switched off' };
  if (s.burstInMinute > config.burstPerMinute) return { decision: 'DENY_EXPENSIVE', tier, retryAfterSeconds: 60, reason: `principal burst ${s.burstInMinute}/min` };
  if (s.addressInMinute > config.addressPerMinute) return { decision: 'DENY_EXPENSIVE', tier, retryAfterSeconds: 60, reason: `address burst ${s.addressInMinute}/min` };
  if (!wantsAi) return { decision: 'ALLOW_DETERMINISTIC', tier, reason: 'deterministic route' };
  if (!config.aiEnabled) return { decision: 'AI_DISABLED', tier, reason: 'paid layer switched off' };
  if (tier === 'progressive') {
    if (s.paidInDay > config.paidPerDay) return { decision: 'SOFT_LIMIT', tier, reason: `paid/day ${s.paidInDay} > ${config.paidPerDay}` };
    if (s.paidInHour > config.paidPerHour) return { decision: 'SOFT_LIMIT', tier, reason: `paid/hour ${s.paidInHour} > ${config.paidPerHour}` };
    if (s.paidInPacingWindow > config.paidPerPacingWindow) return { decision: 'SOFT_LIMIT', tier, retryAfterSeconds: config.pacingSeconds, reason: `pacing ${s.paidInPacingWindow} in ${config.pacingSeconds}s` };
  }
  const committed = s.settledMicroUsd + s.reservedMicroUsd + reservationMicroUsd(config);
  if (committed > config.killThresholdMicroUsd) return { decision: 'GLOBAL_BUDGET_FALLBACK', tier, reason: `month committed ${committed} > kill ${config.killThresholdMicroUsd}` };
  return { decision: 'ALLOW_AI', tier, reason: tier === 'welcome' ? 'welcome tier' : 'progressive tier within allowance' };
}

/** Alarm thresholds crossed by a settlement that moved the month total from `before` to `after`. */
export function alarmsCrossed(before: number, after: number, thresholds: number[]): number[] {
  return thresholds.filter((t) => before < t && after >= t);
}
