import { createHash } from 'node:crypto';

export type RateLimitCooldownStatus = 'active' | 'elapsed' | 'unknown' | 'not_applicable';

export interface ParsedRateLimitResponse {
  http_status: number | null;
  provider_error_category: 'rate_limited' | 'other' | 'unknown';
  retryable: boolean;
  retry_after_present: boolean;
  retry_after_seconds: number | null;
  retry_after_timestamp: string | null;
  rate_limit_scope: string | null;
  rate_limit_reset_present: boolean;
  rate_limit_reset_timestamp: string | null;
  provider_request_id_hash: string | null;
  redacted_response_summary: string;
}

export interface CooldownDecisionInput {
  last_attempt_status: number | null;
  last_attempt_category: string | null;
  last_attempt_time: Date;
  retry_after_seconds: number | null;
  retry_after_timestamp: Date | null;
  rate_limit_reset_timestamp: Date | null;
  current_time: Date;
  attempt_budget_for_slice: number;
  attempts_used?: number;
  provider_family: string;
  recipient_classification: 'internal' | 'customer' | 'prospect' | 'unknown';
  broad_live_send_gate_enabled?: boolean;
}

export interface CooldownDecision {
  cooldown_status: RateLimitCooldownStatus;
  cooldown_active: boolean;
  cooldown_reason: string;
  next_eligible_at: string | null;
  safe_to_attempt_now: boolean;
  attempt_budget_remaining: number;
  decision_summary: string;
}

function hash(value: string | null): string | null {
  if (!value) return null;
  return `hash_${createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16)}`;
}

function header(headers: Headers | Record<string, string | undefined>, name: string): string | null {
  const value = headers instanceof Headers ? headers.get(name) : headers[name] ?? headers[name.toLowerCase()];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseReset(value: string | null): Date | null {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return new Date((numeric < 10_000_000_000 ? numeric * 1000 : numeric));
  return parseDate(value);
}

export function parseRateLimitResponse(input: {
  status: number | null;
  headers?: Headers | Record<string, string | undefined>;
  receivedAt?: Date;
}): ParsedRateLimitResponse {
  const status = input.status;
  const headers = input.headers ?? {};
  const receivedAt = input.receivedAt ?? new Date();
  const retryAfter = header(headers, 'retry-after');
  const retrySeconds = retryAfter && /^\d{1,9}$/.test(retryAfter) ? Number(retryAfter) : null;
  const retryDate = retrySeconds === null ? parseDate(retryAfter) : null;
  const reset = parseReset(header(headers, 'x-ratelimit-reset') ?? header(headers, 'ratelimit-reset'));
  const requestId = header(headers, 'x-request-id') ?? header(headers, 'x-zeptomail-request-id');
  const rateLimited = status === 429;
  const next = retrySeconds !== null ? new Date(receivedAt.getTime() + retrySeconds * 1000) : retryDate ?? reset;
  return Object.freeze({
    http_status: status,
    provider_error_category: rateLimited ? 'rate_limited' : status === null ? 'unknown' : 'other',
    retryable: rateLimited,
    retry_after_present: retryAfter !== null,
    retry_after_seconds: retrySeconds,
    retry_after_timestamp: next?.toISOString() ?? null,
    rate_limit_scope: header(headers, 'x-ratelimit-scope') ?? header(headers, 'ratelimit-scope'),
    rate_limit_reset_present: reset !== null,
    rate_limit_reset_timestamp: reset?.toISOString() ?? null,
    provider_request_id_hash: hash(requestId),
    redacted_response_summary: rateLimited
      ? `HTTP 429; retry metadata ${next ? 'present' : 'unknown'}`
      : `HTTP ${status ?? 'unknown'}; rate-limit metadata not applicable`,
  });
}

export class EmailProviderCooldownDecisionService {
  decide(input: CooldownDecisionInput): CooldownDecision {
    const remaining = Math.max(0, input.attempt_budget_for_slice - (input.attempts_used ?? 0));
    const isRateLimited = input.last_attempt_status === 429 || input.last_attempt_category === 'rate_limited';
    const next = input.retry_after_timestamp
      ?? (input.retry_after_seconds !== null ? new Date(input.last_attempt_time.getTime() + input.retry_after_seconds * 1000) : null)
      ?? input.rate_limit_reset_timestamp;
    const internal = input.recipient_classification === 'internal';
    const broadDisabled = input.broad_live_send_gate_enabled !== true;
    if (!isRateLimited) {
      const safe = remaining > 0 && internal && broadDisabled;
      return Object.freeze({ cooldown_status: 'not_applicable', cooldown_active: false, cooldown_reason: 'last attempt was not rate limited', next_eligible_at: null, safe_to_attempt_now: safe, attempt_budget_remaining: remaining, decision_summary: safe ? 'eligible pending diagnostic guards' : 'blocked by recipient, budget or broad-send gate' });
    }
    if (!next || Number.isNaN(next.getTime())) {
      return Object.freeze({ cooldown_status: 'unknown', cooldown_active: true, cooldown_reason: 'provider supplied no safely parseable retry window; defer by default', next_eligible_at: null, safe_to_attempt_now: false, attempt_budget_remaining: remaining, decision_summary: 'deferred; retry window unknown' });
    }
    const active = input.current_time.getTime() < next.getTime();
    const status: RateLimitCooldownStatus = active ? 'active' : 'elapsed';
    const safe = !active && remaining > 0 && internal && broadDisabled;
    return Object.freeze({ cooldown_status: status, cooldown_active: active, cooldown_reason: active ? 'provider cooldown has not elapsed' : 'provider cooldown elapsed', next_eligible_at: next.toISOString(), safe_to_attempt_now: safe, attempt_budget_remaining: remaining, decision_summary: safe ? 'cooldown elapsed; diagnostic guards may authorize one attempt' : active ? 'deferred until cooldown elapses' : 'blocked by recipient, budget or broad-send gate' });
  }
}

export interface DeferredCanaryStatus extends CooldownDecision {
  provider: 'transactional_email';
  last_attempt_category: string | null;
  broad_sends_enabled: false;
  public_saves_enabled: false;
}

export function buildDeferredCanaryStatus(lastAttemptCategory: string | null, decision: CooldownDecision): DeferredCanaryStatus {
  return Object.freeze({ provider: 'transactional_email', last_attempt_category: lastAttemptCategory, broad_sends_enabled: false, public_saves_enabled: false, ...decision });
}

export class DeferredEmailDiagnosticCanaryGuard {
  private attempts = 0;
  authorize(decision: CooldownDecision): { ok: true } | { ok: false; reason: string } {
    if (this.attempts >= 1) return { ok: false, reason: 'slice_attempt_budget_exhausted' };
    if (!decision.safe_to_attempt_now || decision.cooldown_status !== 'elapsed') return { ok: false, reason: decision.cooldown_reason };
    this.attempts += 1;
    return { ok: true };
  }
  lockDown(): void { this.attempts = 1; }
  attemptCount(): number { return this.attempts; }
}
