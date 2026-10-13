import { apiBase } from './api';
import type { ShopperContext } from './assistant';

/**
 * The web side of Goldie beyond the answer: who she is talking to, what they
 * asked about (Customer DNA), and chats passed on by email. All calls go to the
 * API's internal routes (internal key added by lib/api's fetch patch); the
 * user id comes only from this server's session check, never from the browser.
 */
export interface ShopperIdentity { visitToken: string | null; userId: string | null; fpClientId: string | null; verifiedPhone?: string | null }

type Result<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string };

async function call<T>(path: string, body: unknown, timeoutMs: number): Promise<Result<T>> {
  try {
    const res = await fetch(`${apiBase}/internal/assistant${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const json = (await res.json().catch(() => null)) as { success?: boolean; data?: T; error?: { code?: string; message?: string } } | null;
    if (res.ok && json?.success) return { ok: true, data: json.data as T };
    return { ok: false, status: res.status, code: json?.error?.code ?? 'FAILED', message: json?.error?.message ?? 'Something went wrong.' };
  } catch (e) {
    console.error('[assistant] internal call unreachable', path, e instanceof Error ? e.message : e);
    return { ok: false, status: 503, code: 'UNREACHABLE', message: 'We could not reach the shop just now. Please try again in a moment.' };
  }
}

/**
 * What the shop knows about this shopper changes slowly (visits, orders, interests), but it was read afresh, about
 * eight queries, for the welcome and again for every paid turn. Kept for two minutes per shopper in this process;
 * a shopper's own new order or interest shows up on the next read after that.
 */
const CONTEXT_TTL_MS = 2 * 60_000;
const contextCache = new Map<string, { at: number; value: ShopperContext | null }>();
/** Test seam. */
export function clearShopperContextCache(): void { contextCache.clear(); }

/** Null when nothing could be read; callers then treat the shopper as new. Kept short: it sits in front of an answer. */
export async function shopperContext(who: ShopperIdentity, timeoutMs = 900): Promise<ShopperContext | null> {
  if (!who.visitToken && !who.userId && !who.fpClientId && !who.verifiedPhone) return null;
  const key = JSON.stringify([who.userId ?? '', who.verifiedPhone ?? '', who.visitToken ?? '', who.fpClientId ?? '']);
  const hit = contextCache.get(key);
  if (hit && Date.now() - hit.at < CONTEXT_TTL_MS) return hit.value;
  const r = await call<ShopperContext>('/context', who, timeoutMs);
  const value = r.ok ? r.data : null;
  // A failed read is not remembered: the next turn tries again.
  if (r.ok) {
    if (contextCache.size > 5000) contextCache.clear();
    contextCache.set(key, { at: Date.now(), value });
  }
  return value;
}

/** Fire-and-forget: a lost interest never costs the shopper anything. */
export function recordInterest(who: ShopperIdentity, interest: { intent: string; topic: string; phoneModel: string | null; page: string | null }): void {
  if (!who.fpClientId && !who.userId) return;
  void call('/interest', { ...who, ...interest }, 3000);
}

export const handOver = (body: { userId: string | null; conversationId?: string | null; name: string | null; phone: string | null; email: string | null; note: string | null; page: string | null; sendCopy: boolean; turns: unknown[] }) =>
  call<{ ticketId: string; copySent: boolean }>('/handover', body, 6000);

export const emailTranscript = (body: { email: string; firstName: string | null; requestId: string; turns: unknown[] }) =>
  call<Record<string, never>>('/transcript', body, 6000);

/**
 * A short topic for Customer DNA from what the shopper typed: the router's cleaned query when it has
 * one, never a phone number or an email address, at most 80 characters.
 */
export function interestTopic(query: string, raw: string): string {
  const base = (query || raw).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, ' ').replace(/\+?\d[\d\s-]{6,}\d/g, ' ').replace(/\s+/g, ' ').trim();
  return base.slice(0, 80);
}

/** Files one website turn in the conversation archive (0177). Fire-and-forget: the archive never slows or breaks a reply. */
export function logTurn(body: { conversationId: string; userId: string | null; page: string | null; customer: string; goldie: string | null; intent: string; mood: string; route: string; cacheId?: string | null; nextAction?: string | null }): void {
  void call('/log', { ...body, customer: body.customer.slice(0, 4000), goldie: body.goldie ? body.goldie.slice(0, 8000) : null }, 4000);
}
