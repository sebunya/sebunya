import { createHash } from 'node:crypto';

/**
 * Goldie on WhatsApp: what a customer sent (from the signed Cloud API
 * webhook), and Goldie's answer written for a phone's chat bubble. Pure.
 */

export interface InboundText {
  /** Sender in international digits, e.g. 256772123456 (Meta has verified the number). */
  from: string;
  name: string | null;
  text: string;
  /** WhatsApp message id (wamid): a redelivered webhook carries the same id. */
  messageId: string;
  phoneNumberId: string | null;
  at: Date;
}

const DIGITS = /^\d{8,15}$/;

/** Text the customer typed, or the title of a button / list reply they tapped. Media, reactions and statuses are not conversation turns. */
export function parseInboundTexts(payload: unknown, wabaId: string, now: Date = new Date()): InboundText[] {
  const out: InboundText[] = [];
  const p = payload as { object?: unknown; entry?: unknown } | null;
  if (!p || p.object !== 'whatsapp_business_account' || !Array.isArray(p.entry)) return out;
  for (const entry of p.entry as Array<Record<string, any>>) {
    if (String(entry?.id ?? '') !== wabaId) continue;
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (change?.field !== 'messages') continue;
      const value = change?.value ?? {};
      const names = new Map<string, string>();
      for (const c of Array.isArray(value?.contacts) ? value.contacts : []) {
        const id = String(c?.wa_id ?? '').replace(/\D/g, '');
        if (id && typeof c?.profile?.name === 'string') names.set(id, c.profile.name.slice(0, 80));
      }
      for (const msg of Array.isArray(value?.messages) ? value.messages : []) {
        const from = String(msg?.from ?? '').replace(/\D/g, '');
        const id = typeof msg?.id === 'string' ? msg.id.slice(0, 160) : '';
        if (!DIGITS.test(from) || !id) continue;
        let text = '';
        if (msg?.type === 'text') text = String(msg?.text?.body ?? '');
        else if (msg?.type === 'button') text = String(msg?.button?.text ?? '');
        else if (msg?.type === 'interactive') text = String(msg?.interactive?.button_reply?.title ?? msg?.interactive?.list_reply?.title ?? '');
        text = text.trim().slice(0, 2000);
        if (!text) continue;
        const sec = Number(msg?.timestamp);
        const at = Number.isFinite(sec) && sec > 0 && sec * 1000 <= now.getTime() + 5 * 60_000 ? new Date(sec * 1000) : now;
        out.push({ from, name: names.get(from) ?? null, text, messageId: id, phoneNumberId: typeof value?.metadata?.phone_number_id === 'string' ? value.metadata.phone_number_id : null, at });
      }
    }
  }
  return out;
}

export interface DeliveryReceipt { messageId: string; status: 'sent' | 'delivered' | 'read' | 'failed'; errorCode: number | null; errorTitle: string | null }

/** Delivery receipts for messages we sent (statuses on the same webhook): sent, delivered, read, failed. */
export function parseDeliveryReceipts(payload: unknown, wabaId: string): DeliveryReceipt[] {
  const out: DeliveryReceipt[] = [];
  const p = payload as { object?: unknown; entry?: unknown } | null;
  if (!p || p.object !== 'whatsapp_business_account' || !Array.isArray(p.entry)) return out;
  for (const entry of p.entry as Array<Record<string, any>>) {
    if (String(entry?.id ?? '') !== wabaId) continue;
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (change?.field !== 'messages') continue;
      for (const st of Array.isArray(change?.value?.statuses) ? change.value.statuses : []) {
        const id = typeof st?.id === 'string' ? st.id.slice(0, 160) : '';
        const status = String(st?.status ?? '');
        if (!id || !['sent', 'delivered', 'read', 'failed'].includes(status)) continue;
        const e = Array.isArray(st?.errors) ? st.errors[0] : null;
        out.push({ messageId: id, status: status as DeliveryReceipt['status'], errorCode: Number.isFinite(Number(e?.code)) ? Number(e.code) : null, errorTitle: e ? String(e.title ?? e.message ?? '').slice(0, 200) || null : null });
      }
    }
  }
  return out;
}

/** The archive key for a WhatsApp number: never the number itself as the key. */
export const whatsappKey = (from: string) => createHash('sha256').update(`goldie:wa:${from}`).digest('hex');

export interface ReplyParts {
  text: string;
  products?: Array<{ name: string; url: string; price_ugx: number | null; availability: string }>;
  links?: Array<{ label: string; url: string }>;
}

/** WhatsApp allows 4096 characters; a chat bubble reads best far shorter. */
export const WHATSAPP_MAX = 1500;
const AVAIL: Record<string, string> = { in_stock: 'in stock', low_stock: 'low stock', out_of_stock: 'out of stock', pre_order: 'pre-order' };

/**
 * One WhatsApp message from Goldie's answer: the words, then up to three products as short lines with their
 * link, then up to two useful links. Panel-only links (the in-chat team form) are dropped: on WhatsApp the
 * customer is already talking to the shop.
 */
export function formatWhatsAppReply(r: ReplyParts): string {
  const lines = [r.text.replace(/\*\*/g, '*').trim()];
  const products = (r.products ?? []).slice(0, 3);
  if (products.length) {
    lines.push('');
    for (const p of products) lines.push(`• ${p.name}: ${p.price_ugx == null ? 'price on request' : `UGX ${p.price_ugx.toLocaleString('en-UG')}`}, ${AVAIL[p.availability] ?? p.availability}\n  ${p.url}`);
  }
  const links = (r.links ?? []).filter((l) => !/#goldie-team$/.test(l.url) && !/wa\.me\//.test(l.url) && !/\/wa$/.test(l.url)).slice(0, 2);
  if (links.length) { lines.push(''); for (const l of links) lines.push(`${l.label}: ${l.url}`); }
  const out = lines.join('\n').trim();
  return out.length <= WHATSAPP_MAX ? out : `${out.slice(0, WHATSAPP_MAX - 1).trimEnd()}…`;
}
