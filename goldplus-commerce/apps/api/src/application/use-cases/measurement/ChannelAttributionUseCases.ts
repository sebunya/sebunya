import { normaliseWhatsAppRef, parseHeardAbout, type HeardAboutAnswer } from '@goldplus/shared';
import {
  buildWeeklyChannelReport,
  countsAsSale,
  creditOrder,
  goodsValueUGX,
  LOOKBACK_DAYS,
  MODEL_VERSION,
  reportWeeks,
  weeksRange,
  type ReportModel,
  type WeeklyChannelReport,
} from '../../../domain/measurement/ChannelReport';
import type { ChannelAttributionStore, ChannelSpendSource, OrderAttributionFacts } from '../../ports/measurement/ChannelAttribution';

/** The answer that counts: the newest staff answer, else the newest customer answer. */
export function effectiveDeclared(reports: OrderAttributionFacts['reports']): HeardAboutAnswer | null {
  const withAnswer = reports.filter((r) => r.answer);
  return (withAnswer.find((r) => r.reportedBy === 'admin') ?? withAnswer.find((r) => r.reportedBy === 'customer'))?.answer ?? null;
}

/**
 * Links an order to its visitor's recorded touches and (re)computes its
 * channel credit under every model. Idempotent: links are insert-if-absent and
 * the credits are replaced as a whole. Never throws into the caller's order path
 * (the checkout calls it best-effort, after the order exists).
 */
export class AttributeOrderUseCase {
  constructor(private readonly store: ChannelAttributionStore) {}

  async execute(orderId: string, opts: { extraVisitorIds?: string[] } = {}): Promise<{ status: 'ATTRIBUTED' | 'NOT_FOUND'; linked: number; credits: number }> {
    let facts = await this.store.loadOrder(orderId);
    if (!facts) return { status: 'NOT_FOUND', linked: 0, credits: 0 };
    let linked = 0;
    const visitors = new Map<string, 'visitor' | 'whatsapp_ref'>();
    if (facts.visitorId) visitors.set(facts.visitorId, 'visitor');
    for (const v of opts.extraVisitorIds ?? []) if (v && !visitors.has(v)) visitors.set(v, 'whatsapp_ref');
    // Every WhatsApp reference ever recorded on the order keeps its visitor linked.
    for (const r of facts.reports) {
      if (!r.whatsappRef) continue;
      const ref = await this.store.findWhatsAppRef(r.whatsappRef);
      if (ref && !visitors.has(ref.visitorId)) visitors.set(ref.visitorId, 'whatsapp_ref');
    }
    for (const [visitorId, method] of visitors) {
      linked += await this.store.linkVisitorTouches({ orderId, visitorId, orderAt: facts.orderAt, lookbackDays: LOOKBACK_DAYS, method });
    }
    if (linked > 0) facts = (await this.store.loadOrder(orderId)) ?? facts;
    const credits = creditOrder(
      { orderAt: facts.orderAt, observed: facts.observed, code: facts.code, declared: effectiveDeclared(facts.reports) },
      goodsValueUGX(facts.totalUGX, facts.deliveryFeeUGX),
    );
    await this.store.replaceCredits(orderId, credits, MODEL_VERSION);
    return { status: 'ATTRIBUTED', linked, credits: credits.length };
  }
}

/**
 * The checkout's hand-off: the customer's optional answer, then attribution.
 * Best-effort by contract — any failure is swallowed by the caller, never the order.
 */
export class RecordCheckoutAttributionUseCase {
  constructor(private readonly store: ChannelAttributionStore, private readonly attribute: AttributeOrderUseCase) {}

  async execute(input: { orderId: string; heardAbout: unknown }): Promise<void> {
    const answer = parseHeardAbout(input.heardAbout);
    if (answer) {
      // A replayed checkout (double submit, retry) answers once, not twice.
      const facts = await this.store.loadOrder(input.orderId);
      if (facts && !facts.reports.some((r) => r.reportedBy === 'customer')) {
        await this.store.recordSourceReport({ orderId: input.orderId, reportedBy: 'customer', answer, whatsappRef: null, note: null, actorId: null });
      }
    }
    await this.attribute.execute(input.orderId);
  }
}

export type RecordSourceResult =
  | { ok: true; linkedTouches: number; whatsappRef: string | null }
  | { ok: false; code: 'NOTHING_TO_RECORD' | 'INVALID_ANSWER' | 'INVALID_REF' | 'REF_NOT_FOUND' | 'ORDER_NOT_FOUND'; message: string };

/**
 * Staff record how an order's customer heard about us and/or the WhatsApp
 * reference from the chat. Evidence is insert-only; the newest staff answer wins.
 */
export class RecordOrderSourceUseCase {
  constructor(private readonly store: ChannelAttributionStore, private readonly attribute: AttributeOrderUseCase) {}

  async execute(input: { orderId: string; answer?: unknown; whatsappRef?: unknown; note?: unknown; actorId: string }): Promise<RecordSourceResult> {
    const rawAnswer = typeof input.answer === 'string' ? input.answer.trim() : '';
    const rawRef = typeof input.whatsappRef === 'string' ? input.whatsappRef.trim() : '';
    const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 300) : null;
    if (!rawAnswer && !rawRef) return { ok: false, code: 'NOTHING_TO_RECORD', message: 'Choose an answer or enter the WhatsApp reference.' };
    const answer = rawAnswer ? parseHeardAbout(rawAnswer) : null;
    if (rawAnswer && !answer) return { ok: false, code: 'INVALID_ANSWER', message: 'That answer is not one of the options.' };
    const ref = rawRef ? normaliseWhatsAppRef(rawRef) : null;
    if (rawRef && !ref) return { ok: false, code: 'INVALID_REF', message: 'A WhatsApp reference looks like GP-7K3Q9X.' };
    const facts = await this.store.loadOrder(input.orderId);
    if (!facts) return { ok: false, code: 'ORDER_NOT_FOUND', message: 'Order not found.' };
    let visitor: string | null = null;
    if (ref) {
      const found = await this.store.findWhatsAppRef(ref);
      // A code nobody was issued is refused: recording it would link nothing and look as if it had.
      if (!found) return { ok: false, code: 'REF_NOT_FOUND', message: `No WhatsApp chat was started with ${ref}. Check the code in the chat.` };
      visitor = found.visitorId;
    }
    await this.store.recordSourceReport({ orderId: input.orderId, reportedBy: 'admin', answer, whatsappRef: ref, note, actorId: input.actorId });
    const r = await this.attribute.execute(input.orderId, { extraVisitorIds: visitor ? [visitor] : [] });
    return { ok: true, linkedTouches: r.linked, whatsappRef: ref };
  }
}

/** Recompute every order placed in the last `days` (bounded). Used nightly and by the admin button. */
export class BackfillOrderAttributionUseCase {
  static readonly MAX_ORDERS = 2000;
  constructor(private readonly store: ChannelAttributionStore, private readonly attribute: AttributeOrderUseCase, private readonly now: () => Date = () => new Date()) {}

  async execute(input: { days: number }): Promise<{ orders: number; failed: number; capped: boolean }> {
    const days = Math.min(400, Math.max(1, Math.floor(input.days)));
    const to = this.now();
    const from = new Date(to.getTime() - days * 86_400_000);
    const ids = await this.store.orderIdsPlacedBetween(from, to, BackfillOrderAttributionUseCase.MAX_ORDERS + 1);
    const capped = ids.length > BackfillOrderAttributionUseCase.MAX_ORDERS;
    let failed = 0;
    for (const id of ids.slice(0, BackfillOrderAttributionUseCase.MAX_ORDERS)) {
      try { await this.attribute.execute(id); } catch { failed++; }
    }
    return { orders: Math.min(ids.length, BackfillOrderAttributionUseCase.MAX_ORDERS), failed, capped };
  }
}

export class GetWeeklyChannelReportUseCase {
  constructor(private readonly store: ChannelAttributionStore, private readonly spend: ChannelSpendSource, private readonly now: () => Date = () => new Date()) {}

  async execute(input: { model: ReportModel; weeks: number }): Promise<WeeklyChannelReport> {
    const weeks = reportWeeks(this.now(), input.weeks);
    const { from, to } = weeksRange(weeks);
    const [sales, credits, spend] = await Promise.all([
      this.store.salesBetween(from, to),
      this.store.creditsBetween(input.model, from, to),
      this.spend.weeklySpend(from, to),
    ]);
    const counted = sales.filter(countsAsSale).map((s) => ({ orderId: s.orderId, orderAt: s.orderAt, revenueUGX: goodsValueUGX(s.totalUGX, s.deliveryFeeUGX) }));
    return buildWeeklyChannelReport({ model: input.model, weeks, sales: counted, credits, spend });
  }
}

export interface OrderAttributionView {
  orderId: string;
  orderNumber: string;
  visitorRecorded: boolean;
  touches: Array<{ channel: string; detail: string; at: string }>;
  code: { kind: string; detail: string } | null;
  reports: Array<{ reportedBy: string; answer: string | null; whatsappRef: string | null; note: string | null; at: string }>;
  effectiveAnswer: string | null;
  credits: Array<{ model: string; channel: string; detail: string; weight: number; creditedUGX: string; basis: string }>;
  computedAt: string | null;
}

export class GetOrderAttributionUseCase {
  constructor(private readonly store: ChannelAttributionStore) {}

  async execute(orderId: string): Promise<OrderAttributionView | null> {
    const facts = await this.store.loadOrder(orderId);
    if (!facts) return null;
    const credits = await this.store.creditsForOrder(orderId);
    return {
      orderId: facts.orderId,
      orderNumber: facts.orderNumber,
      visitorRecorded: !!facts.visitorId,
      touches: facts.observed.map((t) => ({ channel: t.channel, detail: t.detail, at: t.at.toISOString() })),
      code: facts.code,
      reports: facts.reports.map((r) => ({ reportedBy: r.reportedBy, answer: r.answer, whatsappRef: r.whatsappRef, note: r.note, at: r.createdAt.toISOString() })),
      effectiveAnswer: effectiveDeclared(facts.reports),
      credits: credits.map((c) => ({ model: c.model, channel: c.channel, detail: c.detail, weight: c.weight, creditedUGX: c.creditedUGX.toString(), basis: c.basis })),
      computedAt: credits.length ? new Date(Math.max(...credits.map((c) => c.computedAt.getTime()))).toISOString() : null,
    };
  }
}
