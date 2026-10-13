import type { ReplyParts } from './WhatsAppGoldie';

/**
 * Goldie on Facebook Messenger and Instagram Direct (Meta's Messenger Platform). Pure: parsing Meta's webhook
 * payload, the archive key for a thread, and the reply as plain text inside each platform's limit.
 *
 * Unlike WhatsApp there is no phone number: the sender is a page-scoped id. So nothing personal (orders, points)
 * is answered from the id; the customer proves an order the same way as on the website (order number + phone).
 */
export type SocialPlatform = 'messenger' | 'instagram';

export interface SocialInbound {
  platform: SocialPlatform;
  /** Page-scoped (Messenger) or Instagram-scoped sender id. */
  senderId: string;
  /** The page or Instagram account that received it. */
  recipientId: string;
  text: string;
  messageId: string;
  at: Date;
}

/** Messenger accepts 2000 characters per text message; Instagram 1000. */
export const SOCIAL_MAX: Record<SocialPlatform, number> = { messenger: 2000, instagram: 1000 };

const ID = /^\d{5,30}$/;

/**
 * Text messages from a Messenger Platform webhook (object "page" for Messenger, "instagram" for Instagram).
 * Echoes of our own replies, reactions, reads, deliveries and attachments without text are ignored.
 */
export function parseSocialMessages(payload: unknown, now: Date = new Date()): SocialInbound[] {
  const p = payload as { object?: unknown; entry?: unknown };
  const platform: SocialPlatform | null = p?.object === 'page' ? 'messenger' : p?.object === 'instagram' ? 'instagram' : null;
  if (!platform || !Array.isArray(p.entry)) return [];
  const out: SocialInbound[] = [];
  for (const entry of p.entry.slice(0, 50)) {
    const events = (entry as { messaging?: unknown })?.messaging;
    if (!Array.isArray(events)) continue;
    for (const ev of events.slice(0, 50)) {
      const e = ev as { sender?: { id?: unknown }; recipient?: { id?: unknown }; timestamp?: unknown; message?: { mid?: unknown; text?: unknown; is_echo?: unknown; is_deleted?: unknown } };
      const m = e?.message;
      if (!m || m.is_echo === true || m.is_deleted === true || typeof m.text !== 'string' || typeof m.mid !== 'string') continue;
      const senderId = String(e.sender?.id ?? ''), recipientId = String(e.recipient?.id ?? '');
      const text = m.text.trim().slice(0, 2000);
      if (!ID.test(senderId) || !ID.test(recipientId) || !text || m.mid.length > 160) continue;
      const ts = Number(e.timestamp);
      out.push({ platform, senderId, recipientId, text, messageId: m.mid, at: Number.isFinite(ts) && ts > 0 ? new Date(ts) : now });
    }
  }
  return out;
}

/** The archive key for one customer's thread on one platform. */
export const socialKey = (platform: SocialPlatform, senderId: string) => `${platform === 'messenger' ? 'fb' : 'ig'}:${senderId}`;

const AVAIL: Record<string, string> = { in_stock: 'in stock', low_stock: 'low stock', out_of_stock: 'out of stock', pre_order: 'pre-order' };

/** Plain text (neither app renders markdown), up to three products with their links, within the platform limit. */
export function formatSocialReply(r: ReplyParts, platform: SocialPlatform): string {
  const lines = [r.text.replace(/\*\*?([^*]+)\*\*?/g, '$1').trim()];
  const products = (r.products ?? []).slice(0, 3);
  if (products.length) {
    lines.push('');
    for (const p of products) lines.push(`${p.name}: ${p.price_ugx == null ? 'price on request' : `UGX ${p.price_ugx.toLocaleString('en-UG')}`}, ${AVAIL[p.availability] ?? p.availability}\n${p.url}`);
  }
  const links = (r.links ?? []).filter((l) => !/#goldie-team$/.test(l.url)).slice(0, 2);
  if (links.length) { lines.push(''); for (const l of links) lines.push(`${l.label}: ${l.url}`); }
  const out = lines.join('\n').trim();
  const max = SOCIAL_MAX[platform];
  return out.length <= max ? out : `${out.slice(0, max - 1).trimEnd()}…`;
}
