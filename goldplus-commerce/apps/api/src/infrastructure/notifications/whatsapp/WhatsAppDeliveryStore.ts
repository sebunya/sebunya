import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { channelSuppressions } from '../../db/schema/consent-foundation';
import { whatsappSentMessages } from '../../db/schema/assistant';
import { getConsentOperatingRuntime } from '../../consent/ConsentOperatingRuntime';
import type { NotificationDispatchPayload } from '../../../application/ports/INotificationProvider';

const NOT_ON_WHATSAPP_DAYS = 30;
const KEEP_SENT_DAYS = 7;
const FALLBACK_WITHIN_HOURS = 24;

/**
 * Who should not get WhatsApp from the shop, and what was sent (for the SMS fallback). On the shop's existing
 * channel_suppressions, keyed like an SMS STOP (phone:+256…, channel whatsapp):
 *   scope 'channel'  — the customer replied STOP (until START);
 *   scope 'delivery' — Meta could not deliver to this number (131026: not on WhatsApp, old app, terms not accepted),
 *                      skipped for 30 days so their updates go straight to SMS instead of failing first.
 */
export const whatsAppDeliveryStore = {
  /** STOP: through the audited consent ledger when its intake is switched on, otherwise straight to the suppression. */
  async stop(phoneE164: string, messageId: string): Promise<void> {
    if (await whatsAppDeliveryStore.blockReason(phoneE164) === 'RECIPIENT_OPTED_OUT') return;
    const now = new Date().toISOString();
    const r = await getConsentOperatingRuntime().recordProviderStopSignal.execute({
      customer_identity_ref: null, endpoint_ref: `phone:${phoneE164}`, channel_key: 'whatsapp' as never, purpose_key: null, scope: 'channel',
      reason: 'Customer replied STOP on WhatsApp', source_surface: 'whatsapp_stop_reply', provider_callback_ref: messageId.slice(0, 255),
      correlation_id: `wa-stop:${messageId}`.slice(0, 120), idempotency_key: `wa-stop:${messageId}`.slice(0, 120), effective_at: now,
      provider_key: 'meta_whatsapp', provider_event_ref: messageId.slice(0, 255), authenticity_verified: true, freshness_verified: true,
      provider_occurred_at: now, normalized_evidence: { keyword: 'STOP', channel: 'whatsapp' },
    }).catch(() => ({ ok: false as const }));
    if ((r as { ok?: boolean }).ok) return;
    await db.insert(channelSuppressions).values({
      endpointRef: `phone:${phoneE164}`, channelKey: 'whatsapp', purposeKey: null, scope: 'channel',
      reason: 'Customer replied STOP on WhatsApp', sourceSurface: 'whatsapp_stop_reply', providerCallbackRef: messageId.slice(0, 255),
      suppressionActive: true, effectiveAt: new Date(),
    });
  },

  async start(phoneE164: string): Promise<void> {
    await db.update(channelSuppressions).set({ suppressionActive: false, liftedAt: new Date(), liftedBy: 'customer:whatsapp_start', liftReason: 'Customer replied START on WhatsApp' })
      .where(and(eq(channelSuppressions.endpointRef, `phone:${phoneE164}`), eq(channelSuppressions.channelKey, 'whatsapp'), eq(channelSuppressions.suppressionActive, true)));
  },

  /** Why WhatsApp should not be used for this number right now, or null. */
  async blockReason(phoneE164: string): Promise<'RECIPIENT_OPTED_OUT' | 'RECIPIENT_NOT_ON_WHATSAPP' | null> {
    const rows = await db.select({ scope: channelSuppressions.scope }).from(channelSuppressions)
      .where(and(eq(channelSuppressions.endpointRef, `phone:${phoneE164}`), eq(channelSuppressions.channelKey, 'whatsapp'), eq(channelSuppressions.suppressionActive, true),
        or(isNull(channelSuppressions.expiresAt), gt(channelSuppressions.expiresAt, new Date())))).limit(5);
    if (rows.some((r) => r.scope === 'channel')) return 'RECIPIENT_OPTED_OUT';
    if (rows.some((r) => r.scope === 'delivery')) return 'RECIPIENT_NOT_ON_WHATSAPP';
    return null;
  },

  async markNotOnWhatsApp(phoneE164: string, ref: string): Promise<void> {
    if (await whatsAppDeliveryStore.blockReason(phoneE164)) return;
    await db.insert(channelSuppressions).values({
      endpointRef: `phone:${phoneE164}`, channelKey: 'whatsapp', purposeKey: null, scope: 'delivery',
      reason: 'Meta could not deliver to this number on WhatsApp (131026)', sourceSurface: 'meta_delivery_failure', providerCallbackRef: ref.slice(0, 255),
      suppressionActive: true, effectiveAt: new Date(), expiresAt: new Date(Date.now() + NOT_ON_WHATSAPP_DAYS * 86_400_000),
    });
  },

  async rememberSent(messageId: string, payload: NotificationDispatchPayload): Promise<void> {
    await db.insert(whatsappSentMessages).values({ messageId: messageId.slice(0, 160), recipient: payload.recipient.slice(0, 40), template: payload.template.slice(0, 100), payload: payload as never }).onConflictDoNothing();
    // Kept a week: long enough for any receipt, short enough not to become a store of customer messages.
    if (Math.random() < 0.02) await db.delete(whatsappSentMessages).where(lt(whatsappSentMessages.sentAt, new Date(Date.now() - KEEP_SENT_DAYS * 86_400_000))).catch(() => undefined);
  },

  /** The message to resend by SMS after a FAILED receipt: at most once, and only within 24 hours of sending. */
  async takeForSmsFallback(messageId: string): Promise<NotificationDispatchPayload | null> {
    const [row] = await db.update(whatsappSentMessages).set({ smsFallbackAt: sql`now()` })
      .where(and(eq(whatsappSentMessages.messageId, messageId.slice(0, 160)), isNull(whatsappSentMessages.smsFallbackAt), gt(whatsappSentMessages.sentAt, new Date(Date.now() - FALLBACK_WITHIN_HOURS * 3600_000))))
      .returning({ payload: whatsappSentMessages.payload });
    return row ? (row.payload as NotificationDispatchPayload) : null;
  },
};
