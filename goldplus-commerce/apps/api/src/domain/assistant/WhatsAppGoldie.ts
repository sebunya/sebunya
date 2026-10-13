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
  /** A photo, voice note, video, document or sticker: Goldie cannot see it, so a person is asked to. */
  media?: { kind: MediaKind; id: string; mimeType: string | null } | null;
}

export type MediaKind = 'image' | 'audio' | 'video' | 'document' | 'sticker';
const MEDIA_LABEL: Record<MediaKind, string> = { image: 'Photo', audio: 'Voice note', video: 'Video', document: 'Document', sticker: 'Sticker' };

/** The marker a media message is filed with, so the admin can show it: [Photo ⟦media:<id>:<mime>⟧] caption */
export const mediaMarker = (kind: MediaKind, id: string, mime: string | null) => `[${MEDIA_LABEL[kind]} ⟦media:${id}:${mime ?? ''}⟧]`;
export const MEDIA_MARKER_RE = /⟦media:([0-9]{5,30}):([^⟧]*)⟧/g;

const DIGITS = /^\d{8,15}$/;

/**
 * What the customer sent: text, a button / list reply, a location, a contact card, or a photo / voice note / video /
 * document / sticker (filed with a marker; Goldie cannot see media, so a person is asked to look). Reactions and
 * statuses are not conversation turns.
 */
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
        let media: InboundText['media'] = null;
        const type = String(msg?.type ?? '');
        if (type === 'text') text = String(msg?.text?.body ?? '');
        else if (type === 'button') text = String(msg?.button?.text ?? '');
        else if (type === 'interactive') text = String(msg?.interactive?.button_reply?.title ?? msg?.interactive?.list_reply?.title ?? '');
        else if (type === 'image' || type === 'audio' || type === 'video' || type === 'document' || type === 'sticker') {
          // Never dropped: filed with a marker so the team can open it, and the caption (if any) is the words.
          const m = msg?.[type] ?? {};
          const mediaId = String(m?.id ?? '');
          if (/^\d{5,30}$/.test(mediaId)) {
            media = { kind: type, id: mediaId, mimeType: typeof m?.mime_type === 'string' ? m.mime_type.slice(0, 60) : null };
            text = `${mediaMarker(type, mediaId, media.mimeType)}${m?.caption ? ` ${String(m.caption)}` : ''}`;
          }
        } else if (type === 'location') {
          const l = msg?.location ?? {};
          const place = [l?.name, l?.address].filter((x: unknown) => typeof x === 'string' && x).join(', ');
          if (Number.isFinite(Number(l?.latitude)) && Number.isFinite(Number(l?.longitude))) text = `My location: ${place ? `${place} ` : ''}(${Number(l.latitude).toFixed(5)}, ${Number(l.longitude).toFixed(5)})`;
        } else if (type === 'contacts') {
          const c = Array.isArray(msg?.contacts) ? msg.contacts[0] : null;
          const phone = c?.phones?.[0]?.phone ?? c?.phones?.[0]?.wa_id;
          if (c) text = `[Contact card] ${String(c?.name?.formatted_name ?? '').slice(0, 80)} ${phone ? String(phone).slice(0, 20) : ''}`.trim();
        } else if (type === 'reaction' || type === 'unsupported' || type === 'system' || type === 'ephemeral') continue;
        text = text.trim().slice(0, 2000);
        if (!text) continue;
        const sec = Number(msg?.timestamp);
        const at = Number.isFinite(sec) && sec > 0 && sec * 1000 <= now.getTime() + 5 * 60_000 ? new Date(sec * 1000) : now;
        out.push({ from, name: names.get(from) ?? null, text, messageId: id, phoneNumberId: typeof value?.metadata?.phone_number_id === 'string' ? value.metadata.phone_number_id : null, at, media });
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

/** "STOP" on WhatsApp: no more WhatsApp updates to this number (SMS carries them instead). "START" undoes it. */
export function optOutWord(text: string): 'STOP' | 'START' | null {
  const t = text.trim().toLowerCase().replace(/[.!]+$/, '');
  if (/^(stop|stop all|unsubscribe|opt out|optout|stop messages|stop whatsapp)$/.test(t)) return 'STOP';
  if (/^(start|unstop|opt in|resume)$/.test(t)) return 'START';
  return null;
}

/**
 * Meta telling us about the account itself (same webhook, other fields): a template approved, rejected, paused or
 * disabled; the number's quality or messaging limit changing; the account restricted. Each becomes an event the
 * shop can act on.
 */
export interface AccountEvent { field: string; event: string; subject: string | null; detail: string | null; bad: boolean }
const BAD_EVENTS = new Set(['REJECTED', 'PAUSED', 'DISABLED', 'FLAGGED', 'DOWNGRADE', 'PENDING_DELETION', 'ACCOUNT_RESTRICTION', 'ACCOUNT_VIOLATION', 'DISABLED_UPDATE', 'ACCOUNT_DELETED', 'RED']);
export function parseAccountEvents(payload: unknown, wabaId: string): AccountEvent[] {
  const out: AccountEvent[] = [];
  const p = payload as { object?: unknown; entry?: unknown } | null;
  if (!p || p.object !== 'whatsapp_business_account' || !Array.isArray(p.entry)) return out;
  for (const entry of p.entry as Array<Record<string, any>>) {
    if (String(entry?.id ?? '') !== wabaId) continue;
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const field = String(change?.field ?? '');
      if (!field || field === 'messages') continue;
      const v = change?.value ?? {};
      const event = String(v?.event ?? v?.new_quality_score ?? v?.current_limit ?? v?.ban_info?.waba_ban_state ?? 'UPDATE').toUpperCase().slice(0, 40);
      const subject = String(v?.message_template_name ?? v?.display_phone_number ?? v?.phone_number ?? '').slice(0, 120) || null;
      const detail = String(v?.reason ?? v?.violation_info?.violation_type ?? v?.restriction_info?.[0]?.restriction_type ?? v?.current_limit ?? '').slice(0, 200) || null;
      const quality = String(v?.new_quality_score ?? '').toUpperCase();
      out.push({ field: field.slice(0, 60), event, subject, detail: detail && detail !== 'NONE' ? detail : null, bad: BAD_EVENTS.has(event) || quality === 'RED' });
    }
  }
  return out;
}
