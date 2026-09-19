import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import type { CanonicalTelemetryEvent } from '@goldplus/shared';
import { db } from '../db/client';
import { outboxEvents } from '../db/schema/system';
import { logger } from '../logging/logger';
import { DEAD_LETTER_STATE } from '../../domain/outbox/TerminalState';
import { DrizzleAdDestinationRepository } from '../db/repositories/DrizzleAdDestinationRepository';
import { IntegrationCredentialVault } from '../seo/IntegrationCredentialVault';
import { adPlatform, buildAdRequest } from './AdPlatforms';

/**
 * Server-side conversions to advertising platforms (0138).
 *
 * fanOut: when an event has been accepted for GA4, one AD_CONVERSION outbox row
 * per LIVE platform that has an equivalent event (idempotent on
 * `ad:<platform>:<event id>`), so a replayed or retried GA dispatch never sends
 * a platform the same event twice, and each platform retries independently.
 *
 * processBatch: claims due rows (same lease/claim pattern as telemetry), builds
 * the platform request with the decrypted token, sends it, and records the
 * outcome on the platform (last success / last error shown in admin).
 */
const EVENT_TYPE = 'AD_CONVERSION';
const BATCH = 50;
const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [30_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
const repo = new DrizzleAdDestinationRepository();

let activeCache: { at: number; list: Array<{ platform: string; config: Record<string, string>; secretEnc: string }> } | null = null;
async function activePlatforms() {
  if (!activeCache || Date.now() - activeCache.at > 60_000) activeCache = { at: Date.now(), list: await repo.active() };
  return activeCache.list;
}

export async function fanOutAdConversions(event: CanonicalTelemetryEvent): Promise<number> {
  try {
    const live = await activePlatforms();
    let queued = 0;
    for (const p of live) {
      const def = adPlatform(p.platform);
      if (!def?.build || !def.events[event.event_name as keyof typeof def.events]) continue;
      const r = await db.insert(outboxEvents).values({
        eventType: EVENT_TYPE, payload: { platform: p.platform, event } as any, idempotencyKey: `ad:${p.platform}:${event.event_id}`,
        status: 'pending', dryRunOnly: false, relatedEntity: 'ad_destination', relatedEntityId: p.platform,
      }).onConflictDoNothing({ target: outboxEvents.idempotencyKey }).returning({ id: outboxEvents.id });
      if (r[0]) queued++;
    }
    return queued;
  } catch (err) {
    logger.warn({ err, eventId: event.event_id }, '[Ads] fan-out failed');
    return 0;
  }
}

export async function processAdConversionBatch(): Promise<{ claimed: number; sent: number; retried: number; deadLettered: number; skipped: number }> {
  const now = new Date();
  const candidates = await db.select({ id: outboxEvents.id }).from(outboxEvents)
    .where(and(eq(outboxEvents.eventType, EVENT_TYPE), eq(outboxEvents.isProcessed, false), lte(outboxEvents.nextAttemptAt, now)))
    .orderBy(outboxEvents.nextAttemptAt).limit(BATCH).for('update', { skipLocked: true });
  const out = { claimed: 0, sent: 0, retried: 0, deadLettered: 0, skipped: 0 };
  if (candidates.length === 0) return out;
  const rows = await db.update(outboxEvents).set({ status: 'processing', nextAttemptAt: new Date(now.getTime() + LEASE_MS) })
    .where(and(inArray(outboxEvents.id, candidates.map((c) => c.id)), eq(outboxEvents.isProcessed, false), lte(outboxEvents.nextAttemptAt, now)))
    .returning();
  out.claimed = rows.length;
  const vault = IntegrationCredentialVault.fromEnv();
  const live = new Map((await repo.active()).map((p) => [p.platform, p]));

  for (const row of rows) {
    const raw = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    const { platform, event } = raw as { platform: string; event: CanonicalTelemetryEvent };
    const dest = live.get(platform);
    const finish = (status: string, extra: Record<string, unknown> = {}) =>
      db.update(outboxEvents).set({ isProcessed: true, processedAt: new Date(), status, ...extra }).where(eq(outboxEvents.id, row.id));
    // Switched off (or token removed) since it was queued: nothing is sent.
    if (!dest || !vault) { await finish('withdrawn', { lastError: !vault ? 'credential vault key not set' : 'platform switched off' }); out.skipped++; continue; }
    let secret: string;
    try { secret = String(vault.decrypt<{ apiKey: string }>(dest.secretEnc).apiKey ?? ''); } catch {
      // Shown on the platform in admin: a rotated vault key (or JWT_SECRET, its
      // fallback) makes every stored token unreadable until it is re-entered.
      await finish('withdrawn', { lastError: 'token could not be decrypted' });
      await repo.recordResult(platform, false, 'The stored token could not be decrypted (the server key changed). Re-enter the token.').catch(() => undefined);
      out.skipped++; continue;
    }
    const req = buildAdRequest(platform, event, dest.config, secret);
    if (!req) { await finish('skipped', { lastError: 'no equivalent event or required identifier' }); out.skipped++; continue; }
    const attempt = row.attemptCount + 1;
    try {
      const res = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: AbortSignal.timeout(10_000) });
      const text = await res.text().catch(() => '');
      if (!res.ok) throw Object.assign(new Error(`${platform} HTTP ${res.status}: ${text.slice(0, 300)}`), { status: res.status });
      await finish('sent');
      await repo.recordResult(platform, true);
      out.sent++;
    } catch (err) {
      // Never log the request: the Meta/Snapchat URL carries the token.
      const msg = (err as Error).message.replace(/access_token=[^&\s]+/g, 'access_token=[redacted]').slice(0, 500);
      const status = (err as { status?: number }).status;
      await repo.recordResult(platform, false, msg).catch(() => undefined);
      const permanent = status != null && status >= 400 && status < 500 && status !== 429;
      if (permanent || attempt >= MAX_ATTEMPTS) {
        await db.update(outboxEvents).set({ isProcessed: true, processedAt: new Date(), deadLetteredAt: new Date(), status: DEAD_LETTER_STATE, lastError: msg, attemptCount: attempt }).where(eq(outboxEvents.id, row.id));
        out.deadLettered++;
      } else {
        const delay = Math.floor((BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]) * (0.8 + 0.4 * Math.random()));
        await db.update(outboxEvents).set({ status: 'retrying', attemptCount: sql`${outboxEvents.attemptCount} + 1`, lastError: msg, nextAttemptAt: new Date(Date.now() + delay) }).where(eq(outboxEvents.id, row.id));
        out.retried++;
      }
      logger.warn({ platform, eventId: event?.event_id, attempt, err: msg }, '[Ads] conversion delivery failed');
    }
  }
  return out;
}
