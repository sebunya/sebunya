/**
 * A Goldie conversation as it leaves the chat: to the shop (a handover) or to
 * the customer (a copy they asked for). Pure: no I/O, no framework.
 *
 * The server never stored the chat (the browser holds it), so what arrives
 * here is whatever the browser sends. Two rules follow from that:
 *  - the customer's own lines are data, never markup: everything is escaped,
 *    and links are removed from them, so a copy sent to an email address
 *    cannot be used to deliver someone else's link from our domain;
 *  - the size is bounded: at most MAX_TURNS lines, each cut at MAX_LINE.
 */

export interface TranscriptTurn { role: 'user' | 'assistant'; content: string }

export const MAX_TURNS = 30;
export const MAX_LINE = 1200;

const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|info|biz|xyz|top|ly|io|co|me|app|link|click|site|online|ug)(?:\/\S*)?/gi;

// eslint-disable-next-line no-control-regex -- stripping control characters IS the point
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/** Validated, bounded, link-free (customer lines) turns; null when nothing usable is left. */
export function cleanTranscript(raw: unknown): TranscriptTurn[] | null {
  if (!Array.isArray(raw)) return null;
  const out: TranscriptTurn[] = [];
  for (const item of raw.slice(-MAX_TURNS)) {
    if (!item || typeof item !== 'object') continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') continue;
    let text = content.replace(CONTROL, '').trim().slice(0, MAX_LINE);
    if (role === 'user') text = text.replace(LINK, '[link removed]');
    if (text) out.push({ role, content: text });
  }
  return out.some((t) => t.role === 'user') ? out : null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface RenderedMail { subject: string; text: string; html: string }

const shell = (title: string, intro: string, body: string, footer: string) => `<!doctype html><html><body style="margin:0;background:#f6f4ef;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:600px;background:#ffffff;border-radius:12px" cellpadding="0" cellspacing="0">
<tr><td style="padding:20px 24px;border-bottom:3px solid #c6f25a"><strong style="font-size:18px">GoldPlus</strong></td></tr>
<tr><td style="padding:20px 24px"><h1 style="font-size:18px;margin:0 0 8px">${esc(title)}</h1><p style="margin:0 0 16px;line-height:1.5">${intro}</p>${body}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #eee;font-size:12px;color:#666;line-height:1.5">${footer}</td></tr>
</table></td></tr></table></body></html>`;

const lines = (turns: TranscriptTurn[], customerLabel: string) => turns.map((t) => {
  const who = t.role === 'user' ? customerLabel : 'Goldie';
  const bg = t.role === 'user' ? '#eef7d9' : '#f4f1ea';
  return `<p style="margin:0 0 10px;padding:10px 12px;border-radius:10px;background:${bg};line-height:1.5"><strong>${esc(who)}:</strong> ${esc(t.content).replace(/\n/g, '<br>')}</p>`;
}).join('');

const textLines = (turns: TranscriptTurn[], customerLabel: string) => turns.map((t) => `${t.role === 'user' ? customerLabel : 'Goldie'}: ${t.content}`).join('\n\n');

const when = (at: Date) => at.toLocaleString('en-GB', { timeZone: 'Africa/Kampala', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export interface HandoverMailInput {
  name: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
  page: string | null;
  turns: TranscriptTurn[];
  at: Date;
  adminUrl: string;
}

/** To the shop: who to reply to, how, what they still need, and the whole chat. */
export function renderHandoverMail(i: HandoverMailInput): RenderedMail {
  const who = i.name || 'A shopper';
  const reach = [i.phone ? `Phone/WhatsApp: ${i.phone}` : null, i.email ? `Email: ${i.email}` : null].filter(Boolean) as string[];
  const subject = `Goldie handover: ${who}${i.phone ? ` (${i.phone})` : ''}`.slice(0, 160);
  const intro = `${esc(who)} asked Goldie to pass this chat to the team on ${esc(when(i.at))}. Please reply ${i.phone ? 'on WhatsApp or by phone' : 'by email'}.`;
  const facts = [...reach, i.note ? `Still needs: ${i.note}` : null, i.page ? `Was on: ${i.page}` : null].filter(Boolean) as string[];
  const body = `<p style="margin:0 0 16px;line-height:1.6">${facts.map(esc).join('<br>')}</p>${lines(i.turns, who)}<p style="margin:16px 0 0"><a href="${esc(i.adminUrl)}" style="color:#1a1a1a">Open the support inbox</a></p>`;
  const text = [`${who} asked Goldie to pass this chat to the team (${when(i.at)}).`, ...facts, '', textLines(i.turns, who), '', `Support inbox: ${i.adminUrl}`].join('\n');
  return { subject, text, html: shell('A shopper wants the team', intro, body, 'Sent by Goldie, the GoldPlus personal shopper. The customer typed their own lines; check facts before you promise anything.') };
}

export interface TranscriptMailInput { firstName: string | null; turns: TranscriptTurn[]; at: Date; whatsappUrl: string; siteUrl: string }

/** To the customer, at their request: their chat, and how to reach a person. */
export function renderTranscriptMail(i: TranscriptMailInput): RenderedMail {
  const hello = i.firstName ? `Hello ${i.firstName},` : 'Hello,';
  const subject = 'Your chat with Goldie at GoldPlus';
  const intro = `${esc(hello)} here is your chat with Goldie from ${esc(when(i.at))}, as you asked. Prices and stock change, so check the product page before you pay.`;
  const body = `${lines(i.turns, 'You')}<p style="margin:16px 0 0;line-height:1.5">Need a person? <a href="${esc(i.whatsappUrl)}" style="color:#1a1a1a">WhatsApp us</a> or visit <a href="${esc(i.siteUrl)}" style="color:#1a1a1a">shopgoldplus.com</a>.</p>`;
  const text = [hello, '', `Here is your chat with Goldie from ${when(i.at)}, as you asked. Prices and stock change, so check the product page before you pay.`, '', textLines(i.turns, 'You'), '', `Need a person? WhatsApp us: ${i.whatsappUrl}`, i.siteUrl].join('\n');
  return { subject, text, html: shell('Your chat with Goldie', intro, body, 'You asked for this copy from the chat on shopgoldplus.com. We do not add you to any mailing list for it.') };
}
