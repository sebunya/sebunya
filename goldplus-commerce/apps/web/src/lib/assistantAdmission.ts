import { createHash } from 'node:crypto';
import { apiBase } from './api';

/**
 * The web side of admission: a one-way pseudonym for the visitor, the three
 * internal API calls (admit, settle, release), and fail-closed defaults when
 * the API cannot be reached. No raw cookie, user id or address ever leaves
 * this process; the API sees only hashes.
 */
export interface AdmitOutput {
  decision: 'DISABLED' | 'DUPLICATE' | 'DENY_EXPENSIVE' | 'ALLOW_DETERMINISTIC' | 'AI_DISABLED' | 'SOFT_LIMIT' | 'GLOBAL_BUDGET_FALLBACK' | 'ALLOW_AI';
  tier: 'welcome' | 'progressive';
  retryAfterSeconds?: number;
  reason: string;
  reservationId: string | null;
  model: string;
  effort: 'low' | 'medium';
  maxOutputTokens: number;
  maxToolRounds: number;
  degraded: boolean;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Signed-in customer first, then the signed first-party visit cookie, then the network address; purpose-scoped so nothing else can join on it. */
export function principalHash(input: { userId?: string | null; visitToken?: string | null; address?: string | null }): string {
  if (input.userId) return sha(`assistant:user:${input.userId}`);
  if (input.visitToken) return sha(`assistant:visit:${input.visitToken}`);
  return sha(`assistant:address:${input.address ?? 'unknown'}`);
}

export function addressHash(address: string | null | undefined): string | null {
  const a = (address ?? '').trim();
  return a && a !== 'unknown' ? sha(`assistant:net:${a}`).slice(0, 32) : null;
}

async function post<T>(path: string, body: unknown, timeoutMs: number): Promise<T | null> {
  try {
    const res = await fetch(`${apiBase}/internal/assistant${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const json = (await res.json().catch(() => null)) as { success?: boolean; data?: T } | null;
    if (!res.ok || !json?.success) { console.error('[assistant] internal call failed', path, res.status); return null; }
    return json.data ?? null;
  } catch (e) {
    console.error('[assistant] internal call unreachable', path, e instanceof Error ? e.message : e);
    return null;
  }
}

/** Null means the admission authority could not be reached: callers treat that as no paid AI. */
export const admit = (body: { principalHash: string; addressHash: string | null; wantsAi: boolean; conversationId: string | null; requestId?: string | null; continuation?: boolean }) => post<AdmitOutput>('/admit', body, 3000);
export const settle = (body: { reservationId: string; model: string; providerRequestId: string | null; outcome: string; usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number } }) => post<{ costMicroUsd: number }>('/settle', body, 5000);
export const release = (body: { reservationId: string; reason: string }) => post<{ released: boolean }>('/release', body, 5000);
