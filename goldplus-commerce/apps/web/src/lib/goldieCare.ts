import { apiBase } from './api';
import { apiHeaders } from './forwardClient';
import { orderStatusCopy, paymentStatusCopy } from './orderStatusCopy';

/**
 * Goldie's customer-care tools: the commerce engine read on the customer's
 * behalf, never on anyone else's.
 *
 *  - track_order: an order by its reference AND the phone or email used at
 *    checkout, through the same verified lookup as the Track my order page
 *    (same 5-tries lockout per reference, same "could not verify" answer for a
 *    wrong reference or a wrong contact, so nothing can be enumerated).
 *  - my_orders / my_loyalty: only for a signed-in customer, with THEIR session
 *    token; the API checks ownership. A guest is asked to sign in, never
 *    offered a lookup by phone number alone.
 *  - quote_delivery: the one public delivery quoting service.
 *
 * Kept out of agentTools.ts on purpose: those tools are public and also back
 * /mcp; these act as a customer and must never be reachable from there.
 */
export interface CareContext {
  /** The signed-in customer's API token (fresh from the middleware), or null for a guest. */
  bearer: string | null;
  /** The visitor's address, forwarded so the API's per-client limits apply to them, not to the web container. */
  clientAddress: string | null;
  /** Where links point (https://shopgoldplus.com). */
  site: string;
  /** WhatsApp only: the sender's number as Meta verified it (international digits). It proves THEIR orders and points. */
  verifiedPhone?: string | null;
}

export interface CareAnswer { ok: boolean; text: string; links: Array<{ label: string; url: string }>; facts?: Record<string, unknown> }

/** GP-202610-3F7A9C21 and similar; never a draft. */
export const ORDER_REF = /\bGP-(?!DRAFT)[A-Z0-9]{4,10}-[A-Z0-9]{4,12}\b/i;
const PHONE = /(?:\+?256|0)\s?7\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;

type Turn = { role: 'user' | 'assistant'; content: string };

/** The newest order reference the customer typed in this conversation. */
export function findOrderRef(turns: readonly Turn[]): string | null {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i]!.role !== 'user') continue;
    const m = turns[i]!.content.match(ORDER_REF);
    if (m) return m[0].toUpperCase();
  }
  return null;
}

/** The newest phone number or email the customer typed in this conversation (their proof for an order). */
export function findContact(turns: readonly Turn[]): string | null {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i]!.role !== 'user') continue;
    const t = turns[i]!.content.replace(ORDER_REF, ' ');
    const e = t.match(EMAIL); if (e) return e[0];
    const p = t.match(PHONE); if (p) return p[0].replace(/[\s-]/g, '');
  }
  return null;
}

const ugx = (n: unknown) => `UGX ${Number(n ?? 0).toLocaleString('en-UG')}`;
const date = (iso: unknown) => { try { return new Date(String(iso)).toLocaleDateString('en-GB', { timeZone: 'Africa/Kampala', day: 'numeric', month: 'short' }); } catch { return ''; } };

async function api<T>(method: 'GET' | 'POST', path: string, ctx: CareContext, body?: unknown, withSession = false): Promise<{ ok: boolean; status: number; data: T | null; message: string }> {
  try {
    const headers = apiHeaders({ Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(withSession && ctx.bearer ? { Authorization: `Bearer ${ctx.bearer}` } : {}) }, ctx.clientAddress);
    const res = await fetch(`${apiBase}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(6000) });
    const json = (await res.json().catch(() => null)) as { success?: boolean; data?: T; error?: { message?: string } } | null;
    return { ok: res.ok && json?.success === true, status: res.status, data: (json?.data ?? null) as T | null, message: json?.error?.message ?? '' };
  } catch {
    return { ok: false, status: 503, data: null, message: '' };
  }
}

const NEXT_STEP: Record<string, string> = {
  received: 'The team confirms it with you next, usually by phone or WhatsApp.',
  pending_owner_review: 'The team is checking it now and will be in touch.',
  processing: 'It is being picked and packed; the rider takes it next.',
  dispatched: 'It is with our rider. Please keep your phone on so the rider can reach you.',
  delivery_failed: 'The rider could not complete the delivery. The team will call to arrange a new time.',
  delivered: 'It shows as delivered.',
  completed: 'It shows as delivered and complete.',
  cancelled: 'This order was cancelled.',
};

interface LookupDto { orderNumber: string; customerName?: string; deliveryArea?: string; items?: Array<{ name: string; quantity: number }>; totalUgx?: number; deliveryFeeUgx?: number; paymentStatus?: string; orderStatus?: string; createdAt?: string }

/** One order, by reference + contact (guest or signed-in). */
export async function trackOrder(reference: string, contact: string, ctx: CareContext): Promise<CareAnswer> {
  const track = { label: 'Track my order', url: `${ctx.site}/track-order?reference=${encodeURIComponent(reference)}` };
  const r = await api<LookupDto>('POST', '/commerce/orders/lookup', ctx, { reference, contact });
  if (r.status === 429) return { ok: false, text: 'That order has had too many tries in the last few minutes, so it is locked for a short while to keep it safe. Please try again in about ten minutes, or the team can check it for you on WhatsApp.', links: [track] };
  if (!r.ok || !r.data) {
    if (r.status >= 500) return { ok: false, text: "I can't reach our order system just now. The Track my order page or the team on WhatsApp can check it.", links: [track] };
    return { ok: false, text: `I couldn't match ${reference} with that phone number or email. Please check both are exactly as used at checkout; the reference is in your order SMS or email.`, links: [track] };
  }
  const o = r.data;
  const status = String(o.orderStatus ?? '').toLowerCase();
  const pay = String(o.paymentStatus ?? '').toLowerCase();
  const sc = orderStatusCopy(status), pc = paymentStatusCopy(pay);
  const items = (o.items ?? []).slice(0, 4).map((i) => `${i.name}${i.quantity > 1 ? ` x${i.quantity}` : ''}`).join(', ');
  const waitingPay = pay === 'unpaid' && !['cancelled', 'failed'].includes(status);
  const parts = [
    `Order ${o.orderNumber}${o.createdAt ? ` from ${date(o.createdAt)}` : ''}: ${sc.label.toLowerCase()}.`,
    NEXT_STEP[status] ?? sc.meaning,
    `Payment: ${pc.label.toLowerCase()}${waitingPay ? '; you can pay from the Track my order page' : ''}.`,
    items ? `It has ${items}, ${ugx(o.totalUgx)} in total${o.deliveryArea ? `, going to ${o.deliveryArea}` : ''}.` : '',
  ].filter(Boolean);
  return { ok: true, text: parts.join(' '), links: [track], facts: { orderNumber: o.orderNumber, status, paymentStatus: pay } };
}

interface OrderSummary { orderNumber: string; status: string; paymentStatus?: string; totalAmountUgx: number; itemCount: number; createdAt: string }

interface PhoneCare { orders: Array<{ orderNumber: string; status: string; paymentStatus: string; totalUgx: number; createdAt: string; deliveryArea: string; items: number }>; loyalty: LoyaltyDto | null; hasAccount: boolean }

/** WhatsApp: the verified number's own orders and points (internal route; the API started this turn). */
async function phoneCare(ctx: CareContext): Promise<PhoneCare | null> {
  if (!ctx.verifiedPhone || !/^\d{9,15}$/.test(ctx.verifiedPhone)) return null;
  const r = await api<PhoneCare>('POST', '/internal/assistant/care-by-phone', ctx, { phone: ctx.verifiedPhone });
  return r.ok ? r.data : null;
}

/** A signed-in customer's latest orders (WhatsApp: the orders placed with this number). */
export async function myOrders(ctx: CareContext): Promise<CareAnswer> {
  const signIn = { label: 'Sign in', url: `${ctx.site}/login?returnTo=/account/orders` };
  if (!ctx.bearer && ctx.verifiedPhone) {
    const pc = await phoneCare(ctx);
    if (!pc) return { ok: false, text: "I can't reach our order system just now. The team here on WhatsApp can check it for you.", links: [] };
    if (!pc.orders.length) return { ok: true, text: "I don't see any orders placed with this WhatsApp number. If you used a different number at checkout, send me the order reference (it starts with GP-) and that number, and I'll check it.", links: [] };
    const o = pc.orders[0]!;
    const rest = pc.orders.slice(1).map((x) => `${x.orderNumber} (${date(x.createdAt)}): ${orderStatusCopy(x.status).label.toLowerCase()}`);
    return {
      ok: true,
      text: `Your latest order is ${o.orderNumber} from ${date(o.createdAt)}, ${ugx(o.totalUgx)}: ${orderStatusCopy(o.status).label.toLowerCase()}, ${paymentStatusCopy(o.paymentStatus).label.toLowerCase()}. ${NEXT_STEP[o.status.toLowerCase()] ?? ''}${rest.length ? ` Before that: ${rest.join('; ')}.` : ''}`.trim(),
      links: [{ label: 'Track my order', url: `${ctx.site}/track-order?reference=${encodeURIComponent(o.orderNumber)}` }],
      facts: { count: pc.orders.length },
    };
  }
  if (!ctx.bearer) return { ok: false, text: 'To see your orders here, sign in first. Or send me the order reference (it starts with GP-) and the phone number or email you used at checkout, and I will check it.', links: [signIn] };
  const r = await api<OrderSummary[]>('GET', '/account/orders', ctx, undefined, true);
  if (r.status === 401) return { ok: false, text: 'Your sign-in has expired. Please sign in again and I will check your orders.', links: [signIn] };
  if (!r.ok || !Array.isArray(r.data)) return { ok: false, text: "I can't reach your orders just now. Your account page shows them too.", links: [{ label: 'My orders', url: `${ctx.site}/account/orders` }] };
  if (!r.data.length) return { ok: true, text: 'I don\'t see any orders on your account yet. If you ordered as a guest, send me the reference and the phone number you used and I will find it.', links: [] };
  const lines = r.data.slice(0, 3).map((o) => `${o.orderNumber} (${date(o.createdAt)}, ${ugx(o.totalAmountUgx)}): ${orderStatusCopy(o.status).label.toLowerCase()}, ${paymentStatusCopy(o.paymentStatus).label.toLowerCase()}`);
  const latest = r.data[0]!;
  return {
    ok: true,
    text: `Your latest order is ${lines[0]}. ${NEXT_STEP[String(latest.status).toLowerCase()] ?? ''}${lines.length > 1 ? ` Before that: ${lines.slice(1).join('; ')}.` : ''}`.trim(),
    links: [{ label: 'My orders', url: `${ctx.site}/account/orders` }],
    facts: { count: r.data.length },
  };
}

interface LoyaltyDto { programmeActive: boolean; balance?: { available: number; pendingExpiry?: number; lifetimeEarned?: number }; pendingPoints?: number; tier?: { current: { name: string } | null; next: { name: string; pointsToGo: number } | null } | null; soonestExpiry?: string | null }

/** A signed-in customer's points, tier and what expires next. */
export async function myLoyalty(ctx: CareContext): Promise<CareAnswer> {
  const page = { label: 'My rewards', url: `${ctx.site}/account/loyalty` };
  if (!ctx.bearer && ctx.verifiedPhone) {
    const pc = await phoneCare(ctx);
    if (!pc) return { ok: false, text: "I can't reach your rewards just now. Your rewards page shows them too.", links: [page] };
    if (!pc.loyalty) return { ok: true, text: pc.hasAccount ? "I can't read your points just now." : "I don't see a GoldPlus account with this WhatsApp number verified. Create one or sign in on shopgoldplus.com and verify this number, and your orders will earn points.", links: [page] };
    return describeLoyalty(pc.loyalty, page);
  }
  if (!ctx.bearer) return { ok: false, text: 'Your points live on your GoldPlus account, so please sign in and I will tell you your balance and tier. Every order you place while signed in earns points.', links: [{ label: 'Sign in', url: `${ctx.site}/login?returnTo=/account/loyalty` }] };
  const r = await api<LoyaltyDto>('GET', '/account/loyalty', ctx, undefined, true);
  if (r.status === 401) return { ok: false, text: 'Your sign-in has expired. Please sign in again and I will check your points.', links: [{ label: 'Sign in', url: `${ctx.site}/login?returnTo=/account/loyalty` }] };
  if (!r.ok || !r.data) return { ok: false, text: "I can't reach your rewards just now. Your rewards page shows them too.", links: [page] };
  return describeLoyalty(r.data, page);
}

function describeLoyalty(l: LoyaltyDto, page: { label: string; url: string }): CareAnswer {
  if (!l.programmeActive) return { ok: true, text: 'Our Friends & Family points are not switched on for your account yet. When they are, your balance will show on your rewards page.', links: [page] };
  const avail = Number(l.balance?.available ?? 0);
  const parts = [`You have ${avail.toLocaleString('en-UG')} points to use.`];
  if (l.pendingPoints) parts.push(`Another ${Number(l.pendingPoints).toLocaleString('en-UG')} arrive once your current order is delivered.`);
  if (l.tier?.current) parts.push(`You're on ${l.tier.current.name}.`);
  if (l.tier?.next) parts.push(`${l.tier.next.pointsToGo.toLocaleString('en-UG')} more lifetime points take you to ${l.tier.next.name}.`);
  if (l.soonestExpiry && (l.balance?.pendingExpiry ?? 0) > 0) parts.push(`${Number(l.balance?.pendingExpiry).toLocaleString('en-UG')} points expire on ${date(l.soonestExpiry)}, so use them before then.`);
  return { ok: true, text: parts.join(' '), links: [page], facts: { available: avail } };
}

interface QuoteDto { tone?: string; feeUgx?: number | null; message?: string; windowSentence?: string; disclaimer?: string }

/** The delivery fee and window for an area, from the one quoting service. */
export async function quoteDelivery(area: string, ctx: CareContext): Promise<CareAnswer> {
  const link = { label: 'Delivery in Kampala and Wakiso', url: `${ctx.site}/delivery/kampala-wakiso` };
  const r = await api<QuoteDto>('POST', '/delivery/quote', ctx, { deliveryArea: area.slice(0, 80) });
  if (!r.ok || !r.data) return { ok: false, text: `I couldn't get a delivery quote for ${area} just now. Checkout shows the exact fee for your address before you pay.`, links: [link] };
  const q = r.data;
  const text = [q.message, q.windowSentence, q.feeUgx != null && !String(q.message ?? '').includes('UGX') ? `The fee is ${ugx(q.feeUgx)}.` : '', q.disclaimer].filter(Boolean).join(' ');
  return { ok: true, text: text || `Checkout shows the exact fee for ${area} before you pay.`, links: [link] };
}

/** The same tools for the paid model, in the Messages API shape. Always offered (a stable tool list keeps the prompt cache); a guest gets the sign-in answer. */
export const CARE_TOOLS = [
  { name: 'track_order', description: "Look up one order's status, payment and items. Needs the order reference (starts GP-) AND the phone number or email the customer used at checkout (on WhatsApp their own number counts); ask for whichever is missing. Never guess either.", input_schema: { type: 'object', properties: { reference: { type: 'string', description: 'Order reference, e.g. GP-202610-3F7A9C21' }, contact: { type: 'string', description: "Phone number or email used at checkout. On WhatsApp leave it out to use the customer's own verified number." } }, required: ['reference'], additionalProperties: false } },
  { name: 'my_orders', description: "The signed-in customer's latest orders and their status. If the customer is not signed in, the result says so; then ask for the order reference and contact instead.", input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'my_loyalty', description: "The signed-in customer's points balance, points pending, tier, points to the next tier and soonest expiry.", input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'quote_delivery', description: 'Delivery fee and time window for a named area or town, from the shop\'s quoting service.', input_schema: { type: 'object', properties: { area: { type: 'string', description: 'Area, suburb or town, e.g. Ntinda or Mukono' } }, required: ['area'], additionalProperties: false } },
] as const;
export type CareToolName = (typeof CARE_TOOLS)[number]['name'];
export const isCareTool = (n: string): n is CareToolName => CARE_TOOLS.some((t) => t.name === n);

export async function callCareTool(name: CareToolName, input: Record<string, unknown>, ctx: CareContext): Promise<CareAnswer> {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string).trim() : '');
  switch (name) {
    case 'track_order': {
      const ref = (s('reference').match(ORDER_REF)?.[0] ?? '').toUpperCase();
      const contact = s('contact') || (ctx.verifiedPhone ? `+${ctx.verifiedPhone}` : '');
      if (!ref || !contact) return { ok: false, text: 'I need both the order reference (it starts GP-) and the phone number or email used at checkout.', links: [] };
      return trackOrder(ref, contact, ctx);
    }
    case 'my_orders': return myOrders(ctx);
    case 'my_loyalty': return myLoyalty(ctx);
    case 'quote_delivery': return s('area') ? quoteDelivery(s('area'), ctx) : { ok: false, text: 'Which area or town is it for?', links: [] };
  }
}
