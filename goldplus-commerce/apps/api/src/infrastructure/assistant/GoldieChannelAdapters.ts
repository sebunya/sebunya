import { META_GRAPH_VERSION } from '../advertising/AdPlatforms';
import type { IGoldieBrain, IWhatsAppMessenger, GoldieWhatsAppSettings } from '../../application/use-cases/assistant/GoldieChannelUseCases';
import type { ICareAlertChannels } from '../../application/use-cases/assistant/CareDeskUseCases';
import { insertOutboxObject } from './AssistantConversationAdapters';

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
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: input.to, type: 'text', text: { body: input.text, preview_url: true } }),
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json().catch(() => null)) as { messages?: Array<{ id?: string }>; error?: { message?: string; code?: number } } | null;
      if (!res.ok) return { ok: false as const, reason: `${res.status}${json?.error?.code ? ` ${json.error.code}` : ''} ${String(json?.error?.message ?? '').slice(0, 120)}`.trim() };
      return { ok: true as const, messageId: json?.messages?.[0]?.id ?? null };
    } catch (e) {
      return { ok: false as const, reason: e instanceof Error ? e.message.slice(0, 120) : 'unreachable' };
    }
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
        body: JSON.stringify({ messaging_product: 'whatsapp', to: input.to, type: 'template', template: { name: input.template, language: { code: input.language }, components: [{ type: 'body', parameters: [{ type: 'text', text: input.body.slice(0, 1000) }] }] } }),
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok ? { ok: true as const } : { ok: false as const, reason: String(res.status) };
    } catch (e) {
      return { ok: false as const, reason: e instanceof Error ? e.message.slice(0, 120) : 'unreachable' };
    }
  }
}

const intl = (phone: string) => { const d = phone.replace(/\D/g, ''); return d.startsWith('0') ? `256${d.slice(1)}` : d; };
const uuidOrNull = (id: string) => (/^[0-9a-f-]{36}$/i.test(id) ? id : null);

/**
 * Care Desk alerts to team members: SMS and email through the outbox (the same governance, retries and
 * provider as every other operational message), WhatsApp through an approved template when one is set.
 */
export class CareAlertChannels implements ICareAlertChannels {
  constructor(private readonly messenger: WhatsAppCloudMessenger, private readonly settings: () => GoldieWhatsAppSettings) {}

  async sms(input: { to: string; message: string; key: string; taskId: string }) {
    await insertOutboxObject({ eventType: 'CARE_ALERT_SMS', template: 'CARE_ALERT', channel: 'sms', idempotencyKey: input.key.slice(0, 255), relatedEntity: 'care_task', relatedEntityId: uuidOrNull(input.taskId),
      payload: { recipient: input.to, message: input.message, relatedEntity: 'care_task', relatedEntityId: uuidOrNull(input.taskId) } });
    return { queued: true };
  }

  async email(input: { to: string; subject: string; text: string; html: string; key: string; taskId: string }) {
    await insertOutboxObject({ eventType: 'CARE_ALERT_EMAIL', template: 'CARE_ALERT_EMAIL', channel: 'email', idempotencyKey: input.key.slice(0, 255), relatedEntity: 'care_task', relatedEntityId: uuidOrNull(input.taskId),
      payload: { recipient: input.to, subject: input.subject, text: input.text, html: input.html, relatedEntity: 'care_task', relatedEntityId: uuidOrNull(input.taskId) } });
    return { queued: true };
  }

  async whatsapp(input: { to: string; message: string }) {
    const template = (process.env.GOLDIE_ALERT_TEMPLATE || '').trim();
    const s = this.settings();
    if (!template || !s.phoneNumberId) return { queued: false, reason: 'WhatsApp alerts need GOLDIE_ALERT_TEMPLATE and the number id' };
    const r = await this.messenger.sendTemplate({ phoneNumberId: s.phoneNumberId, to: intl(input.to), template, language: (process.env.GOLDIE_ALERT_TEMPLATE_LANG || 'en').trim(), body: input.message });
    return r.ok ? { queued: true } : { queued: false, reason: r.reason };
  }
}

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

export function goldieWhatsAppSettings(env: NodeJS.ProcessEnv = process.env): GoldieWhatsAppSettings {
  return {
    enabled: env.GOLDIE_WHATSAPP_ENABLED === 'true',
    onlyNumbers: String(env.GOLDIE_WHATSAPP_TEST_NUMBERS ?? '').split(',').map((n) => n.replace(/\D/g, '')).filter((n) => /^\d{8,15}$/.test(n)),
    phoneNumberId: /^\d{5,20}$/.test(String(env.GOLDIE_WHATSAPP_PHONE_NUMBER_ID ?? '')) ? String(env.GOLDIE_WHATSAPP_PHONE_NUMBER_ID) : null,
  };
}
