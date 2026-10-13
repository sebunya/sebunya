import { META_GRAPH_VERSION } from '../advertising/AdPlatforms';
import type { IGoldieBrain, IWhatsAppMessenger, GoldieWhatsAppSettings } from '../../application/use-cases/assistant/GoldieChannelUseCases';

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
