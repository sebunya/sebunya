import { createHash, randomUUID } from 'crypto';
import { z } from 'zod';
import { BrowserTelemetryEventSchema } from '@goldplus/shared';
import { canonicalJson } from '../../../domain/measurement/BusinessEvents';
import { classifyChannel } from '../../../domain/measurement/Channels';

/**
 * Browser collector contract v2 (dossier §7.1):
 *   202 durable receipt with per-event accepted/rejected results;
 *   the same batchId + same body → the stored receipt, nothing duplicated;
 *   the same batchId + a different body → 409; invalid envelope → 422.
 * The browser observes; it cannot claim server authority: user ids, network
 * identity, purchases, refunds and origin fields are rejected, not ignored.
 */
export const MAX_EVENTS = 20;
export const MAX_BYTES = 64 * 1024;

const LandingTouch = z.object({
  event_name: z.literal('landing_touch'),
  event_id: z.string().uuid(),
  event_time: z.number().int().positive(),
  source: z.literal('browser'),
  user_data: z.object({ fp_client_id: z.string().min(1).max(255), session_id: z.string().max(255).optional() }).strict(),
  touch: z.object({
    source: z.string().max(100).nullable(), medium: z.string().max(100).nullable(), campaign: z.string().max(150).nullable(),
    referrer_host: z.string().max(253).nullable(), landing_path: z.string().max(300).nullable(),
    click_id_types: z.array(z.enum(['gclid', 'gbraid', 'wbraid', 'msclkid', 'fbclid', 'ttclid', 'twclid', 'ScCid', 'li_fat_id', 'epik', 'clickid', 'click_id'])).max(12),
  }).strict(),
}).strict();

export const BatchEnvelope = z.object({
  batchId: z.string().uuid(),
  schemaVersion: z.literal(1),
  pageInstanceId: z.string().max(64).optional(),
  events: z.array(z.unknown()).min(1).max(MAX_EVENTS),
}).strict();

const FORBIDDEN_USER_FIELDS = ['user_id', 'ip_address', 'user_agent', 'hashed_email', 'hashed_phone'];

export interface CollectorStore {
  findBatch(batchId: string): Promise<{ contentSha256: string; receipt: BatchReceipt } | null>;
  saveBatch(batchId: string, contentSha256: string, pageInstanceId: string | null, receipt: BatchReceipt): Promise<'SAVED' | 'EXISTS'>;
  saveTouch(t: { touchId: string; anonymousId: string; clientEventId: string; occurredAt: Date; channel: string; source: string | null; medium: string | null;
    campaign: string | null; referrerHost: string | null; landingPath: string | null; clickIdTypes: string[] }): Promise<void>;
}
export interface BatchReceipt { receiptId: string; accepted: string[]; rejected: Array<{ eventId: string; reason: string }> }
export type CollectResult =
  | { status: 202; receipt: BatchReceipt; replay: boolean }
  | { status: 409 | 413 | 422; error: string };

export class CollectBrowserBatchUseCase {
  constructor(
    private readonly store: CollectorStore,
    /** Durable per-event write for behavioural events (the existing outbox path). */
    private readonly trackEvent: (event: unknown) => Promise<void>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(rawBody: string): Promise<CollectResult> {
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BYTES) return { status: 413, error: 'PAYLOAD_TOO_LARGE' };
    let json: unknown;
    try { json = JSON.parse(rawBody); } catch { return { status: 422, error: 'INVALID_JSON' }; }
    const env = BatchEnvelope.safeParse(json);
    if (!env.success) return { status: 422, error: 'INVALID_ENVELOPE' };
    const digest = createHash('sha256').update(canonicalJson(env.data)).digest('hex');
    const prior = await this.store.findBatch(env.data.batchId);
    if (prior) return prior.contentSha256 === digest ? { status: 202, receipt: prior.receipt, replay: true } : { status: 409, error: 'BATCH_ID_REUSED' };

    const accepted: string[] = [];
    const rejected: Array<{ eventId: string; reason: string }> = [];
    for (const item of env.data.events) {
      const id = String((item as { event_id?: unknown })?.event_id ?? 'unknown').slice(0, 64);
      const name = (item as { event_name?: unknown })?.event_name;
      if (name === 'purchase' || name === 'refund') { rejected.push({ eventId: id, reason: 'SERVER_ONLY_EVENT' }); continue; }
      const ud = (item as { user_data?: Record<string, unknown> })?.user_data ?? {};
      if (FORBIDDEN_USER_FIELDS.some((k) => k in ud)) { rejected.push({ eventId: id, reason: 'SERVER_AUTHORITY_FIELD' }); continue; }
      if (name === 'landing_touch') {
        const t = LandingTouch.safeParse(item);
        if (!t.success) { rejected.push({ eventId: id, reason: 'SCHEMA_VIOLATION' }); continue; }
        const at = new Date(t.data.event_time * 1000);
        const skewOk = Math.abs(this.now().getTime() - at.getTime()) < 7 * 24 * 3600_000;
        if (!skewOk) { rejected.push({ eventId: id, reason: 'EVENT_TIME_OUT_OF_RANGE' }); continue; }
        await this.store.saveTouch({ touchId: randomUUID(), anonymousId: t.data.user_data.fp_client_id, clientEventId: t.data.event_id, occurredAt: at,
          channel: classifyChannel({ source: t.data.touch.source, medium: t.data.touch.medium, referrerHost: t.data.touch.referrer_host, clickIdTypes: t.data.touch.click_id_types }),
          source: t.data.touch.source, medium: t.data.touch.medium, campaign: t.data.touch.campaign, referrerHost: t.data.touch.referrer_host,
          landingPath: t.data.touch.landing_path, clickIdTypes: t.data.touch.click_id_types });
        accepted.push(t.data.event_id);
        continue;
      }
      const parsed = BrowserTelemetryEventSchema.safeParse(item);
      if (!parsed.success) { rejected.push({ eventId: id, reason: 'SCHEMA_VIOLATION' }); continue; }
      await this.trackEvent(parsed.data);
      accepted.push(parsed.data.event_id);
    }
    const receipt: BatchReceipt = { receiptId: randomUUID(), accepted, rejected };
    // Two identical batches racing: the loser answers with the winner's receipt.
    if ((await this.store.saveBatch(env.data.batchId, digest, env.data.pageInstanceId ?? null, receipt)) === 'EXISTS') {
      const won = await this.store.findBatch(env.data.batchId);
      if (won && won.contentSha256 === digest) return { status: 202, receipt: won.receipt, replay: true };
      return { status: 409, error: 'BATCH_ID_REUSED' };
    }
    return { status: 202, receipt, replay: false };
  }
}
