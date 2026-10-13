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
  /** Where the conversation lives, so a task links to the thread the team will read. */
  channel?: 'web' | 'whatsapp' | 'messenger' | 'instagram';
  conversationKey?: string | null;
  /** How the customer feels this turn (lib/goldieEmpathy), so an upset customer's task is urgent. */
  mood?: string | null;
  /** The customer's name if they gave one (WhatsApp profile name). */
  customerName?: string | null;
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

// ---- Actions: Goldie hands work to people (the Care Desk) and files bulk quotes. ----

interface TaskBody { kind: 'callback' | 'follow_up' | 'order_change' | 'order_problem' | 'bulk_lead' | 'urgent'; title: string; detail?: string | null; customerName?: string | null; customerPhone?: string | null; customerEmail?: string | null; orderNumber?: string | null; urgent?: boolean; units?: number | null; proposedAction?: Record<string, unknown> | null }

async function openTask(ctx: CareContext, body: TaskBody): Promise<{ ok: boolean; priority?: string; alerted?: number }> {
  const r = await api<{ taskId: string; priority: string; alerted: number }>('POST', '/internal/assistant/care-task', ctx, {
    ...body, channel: ctx.channel ?? 'web', conversationKey: ctx.conversationKey ?? null, mood: ctx.mood ?? null,
    customerName: body.customerName ?? ctx.customerName ?? null,
  });
  return r.ok && r.data ? { ok: true, priority: r.data.priority, alerted: r.data.alerted } : { ok: false };
}

const ownPhone = (ctx: CareContext) => (ctx.verifiedPhone ? `+${ctx.verifiedPhone}` : '');
const whenText = (priority?: string, alerted = 0) => (priority === 'urgent' ? (alerted > 0 ? 'The team has been alerted now and will call you as soon as possible.' : 'It is marked urgent, so the team will call you as soon as possible.') : 'The team will call you back, usually within working hours today.');

/** A person calls the customer. */
export async function requestCallback(input: { name?: string; phone?: string; reason: string; when?: string }, ctx: CareContext): Promise<CareAnswer> {
  const phone = (input.phone || ownPhone(ctx)).trim();
  if (!phone || !PHONE.test(phone.replace(/\s/g, '')) && !/^\+?\d{9,15}$/.test(phone.replace(/\s/g, ''))) return { ok: false, text: 'Which number should the team call you on?', links: [] };
  const t = await openTask(ctx, { kind: 'callback', title: `Call back: ${input.reason}`.slice(0, 200), detail: input.when ? `Best time: ${input.when}` : null, customerName: input.name ?? null, customerPhone: phone });
  if (!t.ok) return { ok: false, text: "I couldn't book the call just now. Please WhatsApp us and the team will call you.", links: [] };
  return { ok: true, text: `Done, I've booked a call to ${phone}${input.when ? ` (${input.when})` : ''}. ${whenText(t.priority, t.alerted)}`, links: [] };
}

/** Hand the matter to the team now (urgent pages the on-duty team by SMS, email and WhatsApp). */
export async function escalateToTeam(input: { summary: string; urgent?: boolean; name?: string; phone?: string; email?: string }, ctx: CareContext): Promise<CareAnswer> {
  const phone = (input.phone || ownPhone(ctx)).trim();
  if (!phone && !input.email) return { ok: false, text: 'So the team can reach you, what is your phone number?', links: [] };
  const t = await openTask(ctx, { kind: input.urgent ? 'urgent' : 'follow_up', title: input.summary.slice(0, 200), customerName: input.name ?? null, customerPhone: phone || null, customerEmail: input.email ?? null, urgent: input.urgent });
  if (!t.ok) return { ok: false, text: "I couldn't reach the team from here just now. Please WhatsApp us and someone will help you straight away.", links: [] };
  // Say "alerted" only when someone was actually paged (a repeat within 30 minutes or the hourly cap still marks it urgent).
  const text = t.priority !== 'urgent' ? 'I have passed this to the team with everything you told me. They will get back to you today.'
    : (t.alerted ?? 0) > 0 ? 'I have alerted the team now with everything you told me. Someone will contact you very shortly.'
    : 'I have marked this urgent for the team with everything you told me. Someone will contact you as soon as possible.';
  return { ok: true, text, links: [] };
}

/** Verified order first (same proof as Track my order), then a task for the team. */
async function verifiedOrder(reference: string, contact: string, ctx: CareContext): Promise<{ ok: true; summary: CareAnswer } | { ok: false; answer: CareAnswer }> {
  const ref = (reference.match(ORDER_REF)?.[0] ?? '').toUpperCase();
  const proof = contact || ownPhone(ctx);
  if (!ref || !proof) return { ok: false, answer: { ok: false, text: 'Send me the order reference (it starts with GP-) and the phone number or email used at checkout, and I will take it from there.', links: [] } };
  const a = await trackOrder(ref, proof, ctx);
  return a.ok ? { ok: true, summary: a } : { ok: false, answer: a };
}

export async function reportOrderProblem(input: { reference: string; contact?: string; problem: string }, ctx: CareContext): Promise<CareAnswer> {
  const v = await verifiedOrder(input.reference, input.contact ?? '', ctx);
  if (!v.ok) return v.answer;
  const ref = String(v.summary.facts?.orderNumber ?? input.reference).toUpperCase();
  const t = await openTask(ctx, { kind: 'order_problem', title: `${ref}: ${input.problem}`.slice(0, 200), detail: v.summary.text, orderNumber: ref, customerPhone: input.contact && PHONE.test(input.contact) ? input.contact : ownPhone(ctx) || null, customerEmail: input.contact && EMAIL.test(input.contact) ? input.contact : null });
  if (!t.ok) return { ok: false, text: "I couldn't log it just now. Please WhatsApp us with the order number and the team will sort it out.", links: [] };
  return { ok: true, text: `I've logged this on order ${ref} for the team${t.priority === 'urgent' ? ((t.alerted ?? 0) > 0 ? ' and alerted them now' : ' as urgent') : ''}. They will check it and get back to you; nothing is approved until they have looked at it.`, links: [] };
}

const CHANGE_LABEL: Record<string, string> = { cancel: 'cancel the order', delivery_address: 'change the delivery address', delivery_time: 'change the delivery time', items: 'change the items', other: 'change the order' };
export async function requestOrderChange(input: { reference: string; contact?: string; change: string; details?: string }, ctx: CareContext): Promise<CareAnswer> {
  const v = await verifiedOrder(input.reference, input.contact ?? '', ctx);
  if (!v.ok) return v.answer;
  const ref = String(v.summary.facts?.orderNumber ?? input.reference).toUpperCase();
  const status = String(v.summary.facts?.status ?? '');
  if (['delivered', 'completed', 'cancelled'].includes(status)) return { ok: true, text: `Order ${ref} is already ${status === 'cancelled' ? 'cancelled' : 'delivered'}, so it can't be changed. If something is wrong with what you received, tell me and I'll log it for the team.`, links: [] };
  const change = CHANGE_LABEL[input.change] ? input.change : 'other';
  const t = await openTask(ctx, {
    kind: 'order_change', title: `${ref}: ${CHANGE_LABEL[change]}`, detail: [input.details ?? '', v.summary.text].filter(Boolean).join('\n'), orderNumber: ref,
    customerPhone: input.contact && PHONE.test(input.contact) ? input.contact : ownPhone(ctx) || null, customerEmail: input.contact && EMAIL.test(input.contact) ? input.contact : null,
    proposedAction: { type: change, orderNumber: ref, details: (input.details ?? '').slice(0, 500), orderStatus: status },
    urgent: status === 'dispatched' || status === 'processing',
  });
  if (!t.ok) return { ok: false, text: "I couldn't send that to the team just now. Please WhatsApp us with the order number.", links: [] };
  return { ok: true, text: `I've asked the team to ${CHANGE_LABEL[change]} for ${ref}${status === 'dispatched' ? ', and alerted them because it is already with the rider' : ''}. You'll hear from them shortly to confirm; until then the order stays as it is.`, links: [] };
}

/** Wholesale and business buyers: the bulk quote the bulk page sends, filed from the chat, plus a hot lead on the desk. */
export async function bulkQuote(input: { name: string; phone?: string; email?: string; businessName?: string; buyerType?: string; lines: Array<{ productId: string; quantity: number }>; deliveryDistrict?: string; neededBy?: string; notes?: string }, ctx: CareContext): Promise<CareAnswer> {
  const phone = (input.phone || (ctx.verifiedPhone ? `0${ctx.verifiedPhone.slice(-9)}` : '')).trim();
  if (!input.name || input.name.trim().length < 2) return { ok: false, text: 'What name should the quote be under?', links: [] };
  if (!phone) return { ok: false, text: 'Which phone number should the sales team use for the quote?', links: [] };
  const lines = (input.lines ?? []).filter((l) => /^[0-9a-f-]{36}$/i.test(l.productId) && Number.isInteger(l.quantity) && l.quantity > 0).slice(0, 50);
  if (!lines.length) return { ok: false, text: 'Tell me which products and how many of each, and I will put the quote together.', links: [] };
  const buyerType = ['retail', 'wholesale', 'corporate', 'dealer'].includes(String(input.buyerType)) ? input.buyerType : 'wholesale';
  const idem = `goldie-${(ctx.conversationKey ?? 'x').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)}-${lines.map((l) => `${l.productId.slice(0, 8)}${l.quantity}`).join('').slice(0, 30)}`.slice(0, 80).padEnd(16, '0');
  const r = await api<{ quoteId: string; request: { reference: string; totals: { totalUnits: number; lineCount: number } } }>('POST', '/quotes/bulk', ctx, {
    idempotencyKey: idem, customerName: input.name.trim(), businessName: input.businessName ?? '', phone, email: input.email ?? '', buyerType,
    deliveryDistrict: input.deliveryDistrict ?? '', neededBy: input.neededBy ?? '', notes: `From Goldie chat. ${input.notes ?? ''}`.trim(), lines,
  });
  if (!r.ok || !r.data) return { ok: false, text: r.message || "I couldn't file the quote just now. The bulk page can send it, or the team on WhatsApp.", links: [{ label: 'Bulk buying', url: `${ctx.site}/bulk` }] };
  const units = r.data.request.totals.totalUnits;
  await openTask(ctx, { kind: 'bulk_lead', title: `Bulk quote ${r.data.request.reference}: ${units} units from ${input.businessName || input.name}`, customerName: input.name, customerPhone: phone, customerEmail: input.email ?? null, units, detail: input.notes ?? null });
  return { ok: true, text: `Your quote request ${r.data.request.reference} is in: ${units.toLocaleString('en-UG')} units across ${r.data.request.totals.lineCount} product${r.data.request.totals.lineCount === 1 ? '' : 's'}. Our sales team will send you the bulk price by SMS or a call, usually the same working day.`, links: [{ label: 'Check the quote', url: `${ctx.site}/bulk/status?reference=${encodeURIComponent(r.data.request.reference)}` }], facts: { reference: r.data.request.reference, units } };
}

/** The same tools for the paid model, in the Messages API shape. Always offered (a stable tool list keeps the prompt cache); a guest gets the sign-in answer. */
export const CARE_TOOLS = [
  { name: 'track_order', description: "Look up one order's status, payment and items. Needs the order reference (starts GP-) AND the phone number or email the customer used at checkout (on WhatsApp their own number counts); ask for whichever is missing. Never guess either.", input_schema: { type: 'object', properties: { reference: { type: 'string', description: 'Order reference, e.g. GP-202610-3F7A9C21' }, contact: { type: 'string', description: "Phone number or email used at checkout. On WhatsApp leave it out to use the customer's own verified number." } }, required: ['reference'], additionalProperties: false } },
  { name: 'my_orders', description: "The signed-in customer's latest orders and their status. If the customer is not signed in, the result says so; then ask for the order reference and contact instead.", input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'my_loyalty', description: "The signed-in customer's points balance, points pending, tier, points to the next tier and soonest expiry.", input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'quote_delivery', description: 'Delivery fee and time window for a named area or town, from the shop\'s quoting service.', input_schema: { type: 'object', properties: { area: { type: 'string', description: 'Area, suburb or town, e.g. Ntinda or Mukono' } }, required: ['area'], additionalProperties: false } },
  { name: 'request_callback', description: 'Book a call from a person at the shop. Use when the customer asks to be called, or when a call is clearly the best way to settle it and they agree. On WhatsApp their own number is used if they do not give another.', input_schema: { type: 'object', properties: { name: { type: 'string' }, phone: { type: 'string', description: 'Number to call' }, reason: { type: 'string', description: 'What the call is about, in a few words' }, when: { type: 'string', description: 'Best time, if they said' } }, required: ['reason'], additionalProperties: false } },
  { name: 'escalate_to_team', description: 'Pass the matter to a person now, with a one-line summary. Set urgent when the customer is upset or stuck about money, a missing or wrong order, a faulty product, or safety; urgent alerts the on-duty team by SMS, email and WhatsApp. Use when you cannot settle it with the tools, not for things you can answer.', input_schema: { type: 'object', properties: { summary: { type: 'string', description: 'What the customer needs and what you already know' }, urgent: { type: 'boolean' }, name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' } }, required: ['summary'], additionalProperties: false } },
  { name: 'report_order_problem', description: 'Log a problem with a specific order (late, wrong item, damaged, missing part, payment not reflecting) for the team, after checking the order with its reference and the checkout phone or email.', input_schema: { type: 'object', properties: { reference: { type: 'string' }, contact: { type: 'string', description: 'Phone or email used at checkout (omit on WhatsApp to use their number)' }, problem: { type: 'string' } }, required: ['reference', 'problem'], additionalProperties: false } },
  { name: 'request_order_change', description: 'Ask the team to cancel or change an order (delivery address, delivery time, items). Checks the order first; a person confirms the change with the customer. Never tell the customer it is changed: say the team will confirm.', input_schema: { type: 'object', properties: { reference: { type: 'string' }, contact: { type: 'string' }, change: { type: 'string', enum: ['cancel', 'delivery_address', 'delivery_time', 'items', 'other'] }, details: { type: 'string' } }, required: ['reference', 'change'], additionalProperties: false } },
  { name: 'bulk_quote', description: 'File a bulk or wholesale quote request for the sales team. Use productId values from search_products results and the quantities the customer gave; confirm the list with the customer before filing. Needs their name and phone (on WhatsApp their number is used).', input_schema: { type: 'object', properties: { name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, businessName: { type: 'string' }, buyerType: { type: 'string', enum: ['retail', 'wholesale', 'corporate', 'dealer'] }, lines: { type: 'array', items: { type: 'object', properties: { productId: { type: 'string' }, quantity: { type: 'integer', minimum: 1 } }, required: ['productId', 'quantity'], additionalProperties: false }, maxItems: 50 }, deliveryDistrict: { type: 'string' }, neededBy: { type: 'string', description: 'YYYY-MM-DD' }, notes: { type: 'string' } }, required: ['name', 'lines'], additionalProperties: false } },
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
    case 'request_callback': return requestCallback({ name: s('name'), phone: s('phone'), reason: s('reason') || 'Customer asked for a call', when: s('when') }, ctx);
    case 'escalate_to_team': return escalateToTeam({ summary: s('summary') || 'Customer needs a person', urgent: input.urgent === true, name: s('name'), phone: s('phone'), email: s('email') }, ctx);
    case 'report_order_problem': return reportOrderProblem({ reference: s('reference'), contact: s('contact'), problem: s('problem') || 'Problem with the order' }, ctx);
    case 'request_order_change': return requestOrderChange({ reference: s('reference'), contact: s('contact'), change: s('change'), details: s('details') }, ctx);
    case 'bulk_quote': return bulkQuote({ name: s('name'), phone: s('phone'), email: s('email'), businessName: s('businessName'), buyerType: s('buyerType'), lines: Array.isArray(input.lines) ? (input.lines as Array<{ productId: string; quantity: number }>) : [], deliveryDistrict: s('deliveryDistrict'), neededBy: s('neededBy'), notes: s('notes') }, ctx);
  }
}
