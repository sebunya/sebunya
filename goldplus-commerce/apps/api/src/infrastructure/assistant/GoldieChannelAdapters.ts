import { META_GRAPH_VERSION } from '../advertising/AdPlatforms';
import type { IGoldieBrain, IWhatsAppMessenger, GoldieWhatsAppSettings } from '../../application/use-cases/assistant/GoldieChannelUseCases';
import type { ICareAlertChannels } from '../../application/use-cases/assistant/CareDeskUseCases';
import type { GoldieSocialSettings, ISocialMessenger } from '../../application/use-cases/assistant/GoldieSocialUseCases';
import type { SocialPlatform } from '../../domain/assistant/SocialGoldie';
import { insertOutboxObject } from './AssistantConversationAdapters';
import { goldieMetrics } from './GoldieMetrics';
import { CARE_ALERT_TEMPLATE } from '../notifications/whatsapp/whatsAppTemplates';
import { generateVapidKeys, sendWebPush, vapidFromEnv, type VapidKeys } from './WebPush';
import { IntegrationCredentialVault } from '../seo/IntegrationCredentialVault';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { carePushKeys, carePushSubscriptions } from '../db/schema/assistant';

/**
 * WhatsApp Cloud API: a free-form text reply inside the customer service window
 * (POST /{phone-number-id}/messages). The token needs whatsapp_business_messaging;
 * GOLDIE_WHATSAPP_TOKEN wins over the token saved with the WhatsApp ads settings.
 */
export class WhatsAppCloudMessenger implements IWhatsAppMessenger {
  constructor(private readonly token: () => Promise<string | null>, private readonly fetchImpl: typeof fetch = fetch) {}

  async sendText(input: { phoneNumberId: string; to: string; text: string }) {
    const token = (process.env.GOLDIE_WHATSAPP_TOKEN || '').trim() || (await this.token());
    if (!token) return { ok: false as const, reason: 'no messaging token' };
    if (!/^\d{5,20}$/.test(input.phoneNumberId) || !/^\d{8,15}$/.test(input.to)) return { ok: false as const, reason: 'bad number' };
    try {
      const res = await this.fetchImpl(`https://graph.facebook.com/${META_GRAPH_VERSION}/${input.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        // A link preview only for a product page (its photo helps); a 'browse the shop' link would put a big generic
        // card above every answer.
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: input.to, type: 'text', text: { body: input.text, preview_url: (input.text.match(/\/products\//g) ?? []).length === 1 } }),
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json().catch(() => null)) as { messages?: Array<{ id?: string }>; error?: { message?: string; code?: number } } | null;
      if (!res.ok) return { ok: false as const, reason: `${res.status}${json?.error?.code ? ` ${json.error.code}` : ''} ${String(json?.error?.message ?? '').slice(0, 120)}`.trim() };
      return { ok: true as const, messageId: json?.messages?.[0]?.id ?? null };
    } catch (e) {
      return { ok: false as const, reason: e instanceof Error ? e.message.slice(0, 120) : 'unreachable' };
    }
  }

  /** Marks the customer's message read (blue ticks) and, while Goldie prepares the answer, shows "typing…". */
  async sendInteractive(input: { phoneNumberId: string; to: string; body: string; buttons: Array<{ id: string; title: string }> }) {
    const token = (process.env.GOLDIE_WHATSAPP_TOKEN || '').trim() || (await this.token());
    if (!token) return { ok: false as const, reason: 'no messaging token' };
    if (!/^\d{5,20}$/.test(input.phoneNumberId) || !/^\d{8,15}$/.test(input.to)) return { ok: false as const, reason: 'bad number' };
    const buttons = input.buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) } }));
    if (buttons.length === 0) return this.sendText({ phoneNumberId: input.phoneNumberId, to: input.to, text: input.body });
    try {
      const res = await this.fetchImpl(`https://graph.facebook.com/${META_GRAPH_VERSION}/${input.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: input.to,
          type: 'interactive',
          interactive: { type: 'button', body: { text: input.body.slice(0, 1024) }, action: { buttons } },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json().catch(() => null)) as { messages?: Array<{ id?: string }>; error?: { message?: string; code?: number } } | null;
      if (!res.ok) return { ok: false as const, reason: `${res.status}${json?.error?.code ? ` ${json.error.code}` : ''} ${String(json?.error?.message ?? '').slice(0, 100)}`.trim() };
      return { ok: true as const, messageId: json?.messages?.[0]?.id ?? null };
    } catch (e) {
      return { ok: false as const, reason: e instanceof Error ? e.message.slice(0, 120) : 'unreachable' };
    }
  }
  async markRead(input: { phoneNumberId: string; messageId: string; typing: boolean }) {
    const token = (process.env.GOLDIE_WHATSAPP_TOKEN || '').trim() || (await this.token());
    if (!token || !/^\d{5,20}$/.test(input.phoneNumberId)) return;
    await this.fetchImpl(`https://graph.facebook.com/${META_GRAPH_VERSION}/${input.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: input.messageId, ...(input.typing ? { typing_indicator: { type: 'text' } } : {}) }),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined);
  }

  /**
   * An approved template message: the only kind WhatsApp allows outside the 24-hour window, so it is how a
   * team member is paged. GOLDIE_ALERT_TEMPLATE names a template with one body variable ({{1}} = the alert).
   */
  async sendTemplate(input: { phoneNumberId: string; to: string; template: string; language: string; body: string }) {
    const token = (process.env.GOLDIE_WHATSAPP_TOKEN || '').trim() || (await this.token());
    if (!token) return { ok: false as const, reason: 'no messaging token' };
    try {
      const res = await this.fetchImpl(`https://graph.facebook.com/${META_GRAPH_VERSION}/${input.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: input.to, type: 'template', template: { name: input.template, language: { code: input.language }, components: [{ type: 'body', parameters: [{ type: 'text', text: templateParam(input.body) }] }] } }),
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok ? { ok: true as const } : { ok: false as const, reason: String(res.status) };
    } catch (e) {
      return { ok: false as const, reason: e instanceof Error ? e.message.slice(0, 120) : 'unreachable' };
    }
  }
}

/** Meta refuses a template variable with a line break, a tab or more than four spaces in a row: one tidy line. */
export const templateParam = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 1000);

const intl = (phone: string) => { const d = phone.replace(/\D/g, ''); return d.startsWith('0') ? `256${d.slice(1)}` : d; };
const uuidOrNull = (id: string) => (/^[0-9a-f-]{36}$/i.test(id) ? id : null);

/**
 * Care Desk alerts to team members: SMS and email through the outbox (the same governance, retries and
 * provider as every other operational message), WhatsApp through an approved template when one is set.
 */
export class CareAlertChannels implements ICareAlertChannels {
  constructor(
    private readonly messenger: WhatsAppCloudMessenger,
    private readonly settings: () => GoldieWhatsAppSettings,
    /** Meta has approved the alert template (no refused call on every alert before then). */
    private readonly templateApproved: (name: string) => boolean = () => true,
  ) {}

  async sms(input: { to: string; message: string; key: string; taskId: string }) {
    await insertOutboxObject({ eventType: 'CARE_ALERT_SMS', template: 'CARE_ALERT', channel: 'sms', idempotencyKey: input.key.slice(0, 255), relatedEntity: 'care_task', relatedEntityId: uuidOrNull(input.taskId),
      payload: { recipient: input.to, message: input.message, relatedEntity: 'care_task', relatedEntityId: uuidOrNull(input.taskId) } });
    goldieMetrics.careAlerts.inc({ channel: 'sms' });
    return { queued: true };
  }

  async email(input: { to: string; subject: string; text: string; html: string; key: string; taskId: string }) {
    await insertOutboxObject({ eventType: 'CARE_ALERT_EMAIL', template: 'CARE_ALERT_EMAIL', channel: 'email', idempotencyKey: input.key.slice(0, 255), relatedEntity: 'care_task', relatedEntityId: uuidOrNull(input.taskId),
      payload: { recipient: input.to, subject: input.subject, text: input.text, html: input.html, relatedEntity: 'care_task', relatedEntityId: uuidOrNull(input.taskId) } });
    goldieMetrics.careAlerts.inc({ channel: 'email' });
    return { queued: true };
  }

  async whatsapp(input: { to: string; message: string }) {
    // The template Admin > Notifications > WhatsApp templates submits (goldplus_care_alert) unless another is named.
    const template = (process.env.GOLDIE_ALERT_TEMPLATE || '').trim() || CARE_ALERT_TEMPLATE.name;
    const s = this.settings();
    if (!s.phoneNumberId) return { queued: false, reason: 'WhatsApp alerts need the Cloud API number id' };
    if (!process.env.GOLDIE_ALERT_TEMPLATE && !this.templateApproved(template)) return { queued: false, reason: `the ${template} template is not approved by Meta yet` };
    const r = await this.messenger.sendTemplate({ phoneNumberId: s.phoneNumberId, to: intl(input.to), template, language: (process.env.GOLDIE_ALERT_TEMPLATE_LANG || 'en').trim(), body: input.message });
    if (r.ok) goldieMetrics.careAlerts.inc({ channel: 'whatsapp' });
    return r.ok ? { queued: true } : { queued: false, reason: r.reason };
  }

  /** Push to every staff phone that subscribed on the Care Desk; a subscription the browser dropped is deleted. */
  async push(input: { title: string; body: string; url: string; key: string }) {
    const keys = await careVapidKeys().catch(() => null);
    if (!keys) return { sent: 0 };
    // Only staff who still have an active account with an admin role: an alert carries a customer's name and number.
    const subs = await db.select().from(carePushSubscriptions)
      .where(sql`exists (select 1 from users u where u.id = ${carePushSubscriptions.userId} and u.is_active)
        and exists (select 1 from user_roles r where r.user_id = ${carePushSubscriptions.userId})`).limit(100);
    let sent = 0;
    // Sent side by side (each has its own timeout), so a few slow push services cannot hold up the ticker.
    const outcomes = await Promise.all(subs.map((s) => sendWebPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, { title: input.title, body: input.body, url: input.url }, keys).catch(() => 'failed' as const)));
    for (const [i, s] of subs.entries()) {
      const outcome = outcomes[i];
      if (outcome === 'sent') { sent += 1; await db.update(carePushSubscriptions).set({ lastSuccessAt: sql`now()`, failures: 0 }).where(eq(carePushSubscriptions.id, s.id)); }
      else if (outcome === 'gone' || s.failures >= 9) await db.delete(carePushSubscriptions).where(eq(carePushSubscriptions.id, s.id));
      else await db.update(carePushSubscriptions).set({ failures: sql`${carePushSubscriptions.failures} + 1` }).where(eq(carePushSubscriptions.id, s.id));
    }
    if (sent) goldieMetrics.careAlerts.inc({ channel: 'push' }, sent);
    return { sent };
  }
}

/**
 * The Care Desk's VAPID keys: the environment's when set, otherwise the pair the api generated and stored (0182),
 * created on first use, so push alerts need no server settings. Cached; null only without vault material.
 */
let vapidCache: VapidKeys | null = null;
export async function careVapidKeys(): Promise<VapidKeys | null> {
  const fromEnv = vapidFromEnv();
  if (fromEnv) return fromEnv;
  if (vapidCache) return vapidCache;
  const vault = IntegrationCredentialVault.fromEnv();
  if (!vault) return null;
  const contact = (process.env.CARE_PUSH_CONTACT ?? '').trim() || 'mailto:support@shopgoldplus.com';
  let [row] = await db.select().from(carePushKeys).limit(1);
  if (!row) {
    const k = generateVapidKeys();
    // Two replicas may race on first use: the row id is fixed, so exactly one pair wins and both read it back.
    await db.insert(carePushKeys).values({ id: 1, publicKey: k.publicKey, privateKeyEnc: vault.encrypt({ d: k.privateKey }) }).onConflictDoNothing();
    [row] = await db.select().from(carePushKeys).limit(1);
  }
  if (!row) return null;
  vapidCache = { publicKey: row.publicKey, privateKey: vault.decrypt<{ d: string }>(row.privateKeyEnc).d, contact };
  return vapidCache;
}

/** Staff push subscriptions (0181): one row per phone or browser, keyed by the push endpoint. */
export const carePushStore = {
  async save(userId: string, sub: { endpoint: string; p256dh: string; auth: string }, label: string | null) {
    await db.insert(carePushSubscriptions).values({ userId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, label })
      .onConflictDoUpdate({ target: carePushSubscriptions.endpoint, set: { userId, p256dh: sub.p256dh, auth: sub.auth, label, failures: 0 } });
  },
  /** Only the caller's own subscription: one staff member cannot switch off a colleague's alerts. */
  async remove(endpoint: string, userId: string) { await db.delete(carePushSubscriptions).where(and(eq(carePushSubscriptions.endpoint, endpoint), eq(carePushSubscriptions.userId, userId))); },
  async count() { const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(carePushSubscriptions); return Number(r?.n ?? 0); },
};

/**
 * Goldie's brain lives in the web container (router, model, catalogue). The API
 * asks it for one turn over the internal network, with the internal key.
 */
export class HttpGoldieBrain implements IGoldieBrain {
  constructor(private readonly origin: string = (process.env.WEB_INTERNAL_ORIGIN || 'http://web:4321').replace(/\/+$/, ''), private readonly fetchImpl: typeof fetch = fetch) {}

  async turn(input: Parameters<IGoldieBrain['turn']>[0]) {
    const key = process.env.INTERNAL_API_KEY ?? '';
    if (key.length < 32) return null;
    try {
      const res = await this.fetchImpl(`${this.origin}/api/internal/goldie/turn`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goldplus-internal-key': key }, body: JSON.stringify(input), signal: AbortSignal.timeout(45_000),
      });
      const json = (await res.json().catch(() => null)) as { success?: boolean; data?: Awaited<ReturnType<IGoldieBrain['turn']>> } | null;
      return res.ok && json?.success ? json.data ?? null : null;
    } catch {
      return null;
    }
  }
}

/**
 * Meta's Send API for Messenger and Instagram Direct (page token: GOLDIE_META_PAGE_TOKEN, a Page access token with
 * pages_messaging, plus instagram_manage_messages for Instagram). A RESPONSE inside the 24-hour window only.
 */
export class MetaSocialMessenger implements ISocialMessenger {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}
  async sendText(input: { platform: SocialPlatform; recipientId: string; text: string }) {
    const token = (process.env.GOLDIE_META_PAGE_TOKEN || '').trim();
    if (!token) return { ok: false as const, reason: 'no page token' };
    if (!/^\d{5,30}$/.test(input.recipientId)) return { ok: false as const, reason: 'bad recipient' };
    try {
      const res = await this.fetchImpl(`https://graph.facebook.com/${META_GRAPH_VERSION}/me/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: input.recipientId }, messaging_type: 'RESPONSE', message: { text: input.text } }),
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json().catch(() => null)) as { message_id?: string; error?: { message?: string; code?: number } } | null;
      if (!res.ok) return { ok: false as const, reason: `${res.status}${json?.error?.code ? ` ${json.error.code}` : ''} ${String(json?.error?.message ?? '').slice(0, 120)}`.trim() };
      return { ok: true as const, messageId: json?.message_id ?? null };
    } catch (e) {
      return { ok: false as const, reason: e instanceof Error ? e.message.slice(0, 120) : 'unreachable' };
    }
  }
}

export function goldieSocialSettings(env: NodeJS.ProcessEnv = process.env): GoldieSocialSettings {
  const token = !!(env.GOLDIE_META_PAGE_TOKEN ?? '').trim();
  return { messenger: token && env.GOLDIE_MESSENGER_ENABLED === 'true', instagram: token && env.GOLDIE_INSTAGRAM_ENABLED === 'true' };
}

export function goldieWhatsAppSettings(env: NodeJS.ProcessEnv = process.env): GoldieWhatsAppSettings {
  return {
    enabled: env.GOLDIE_WHATSAPP_ENABLED === 'true',
    onlyNumbers: String(env.GOLDIE_WHATSAPP_TEST_NUMBERS ?? '').split(',').map((n) => n.replace(/\D/g, '')).filter((n) => /^\d{8,15}$/.test(n)),
    phoneNumberId: /^\d{5,20}$/.test(String(env.GOLDIE_WHATSAPP_PHONE_NUMBER_ID ?? '')) ? String(env.GOLDIE_WHATSAPP_PHONE_NUMBER_ID) : null,
  };
}
