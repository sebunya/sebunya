import { describe, expect, it } from 'vitest';
import {
  GIFT_CARD_MESSAGE_MAX, checkGiftCardPurchase, giftCardPurchaseReference, isGiftCardPurchaseReference, kampalaToday, maskPhone, scheduledSendDue, unsafeGiftText,
} from '../../apps/api/src/domain/credit/GiftCardPurchase';
import { GIFT_CARD_PHOTOS_PER_DAY, GIFT_CARD_PHOTOS_PER_VISITOR_PER_DAY, GiftCardPurchaseUseCases, ONLINE_GIFT_CARD_ISSUER_ID } from '../../apps/api/src/application/use-cases/credit/GiftCardPurchaseUseCases';
import type { GiftCardPurchaseRecord } from '../../apps/api/src/application/ports/IGiftCardPurchaseRepository';
import { smsText, emailCopy, CUSTOMER_TRANSACTIONAL_TEMPLATES } from '../../apps/api/src/application/notifications/CustomerMessages';
import { classifyPublicEndpoint } from '../../apps/api/src/domain/security/PublicEndpointPolicy';

// 2026-10-21 10:00 Kampala (07:00 UTC).
const NOW = new Date('2026-10-21T07:00:00Z');
const form = (over: Record<string, unknown> = {}) => ({
  amountUgx: 50_000, recipientName: 'Sarah Nakato', recipientPhone: '0772 111222', sendTo: 'recipient', message: 'Happy birthday!',
  fromName: 'Rob', buyerName: 'Robert S', buyerPhone: '0701 333444', buyerEmail: '', deliverOn: '', ...over,
});

describe('gift card purchase rules (0199)', () => {
  it('accepts a normal purchase and sends it now when no date is given', () => {
    const r = checkGiftCardPurchase(form(), NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ amountUgx: 50_000, sendTo: 'recipient', deliverOn: null, fromName: 'Rob', message: 'Happy birthday!' });
  });

  it('keeps amounts between 10,000 and 500,000, in thousands (no second approval online)', () => {
    for (const bad of [9_000, 500_001, 501_000, 12_500, 'abc', -10_000]) expect(checkGiftCardPurchase(form({ amountUgx: bad }), NOW).ok).toBe(false);
    for (const good of [10_000, 500_000, '150,000']) expect(checkGiftCardPurchase(form({ amountUgx: good }), NOW).ok).toBe(true);
  });

  it('needs their number only when the code goes to them, and refuses the buyer’s own number as theirs', () => {
    expect(checkGiftCardPurchase(form({ recipientPhone: '' }), NOW).ok).toBe(false);
    expect(checkGiftCardPurchase(form({ recipientPhone: '', sendTo: 'buyer' }), NOW).ok).toBe(true);
    const own = checkGiftCardPurchase(form({ recipientPhone: '+256 701 333444' }), NOW);
    expect(own.ok).toBe(false);
    if (!own.ok) expect(own.errors.recipientPhone).toMatch(/your own number/);
  });

  it('refuses words that could turn our SMS sender into a scam: links, web addresses, phone or account numbers', () => {
    for (const bad of ['Click http://x.co', 'see www.win.ug', 'send 50000 to 0772 123 456', 'pay 0772123456', 'visit prize.com', '<script>']) {
      expect(unsafeGiftText(bad)).toBe(true);
      expect(checkGiftCardPurchase(form({ message: bad }), NOW).ok).toBe(false);
    }
    for (const fine of ['Happy 30th birthday!', 'Congrats on the new job, 2026 is yours', 'Merry Christmas from all of us']) expect(unsafeGiftText(fine)).toBe(false);
    expect(checkGiftCardPurchase(form({ fromName: 'Call 0772123456' }), NOW).ok).toBe(false);
    // 160 characters: the same limit in the form, here and in the column; one more is refused, never cut.
    expect(checkGiftCardPurchase(form({ message: 'x'.repeat(160) }), NOW).ok).toBe(true);
    expect(checkGiftCardPurchase(form({ message: 'x'.repeat(161) }), NOW).ok).toBe(false);
    expect(GIFT_CARD_MESSAGE_MAX).toBe(160);
  });

  it('schedules within 90 days, never in the past, and not when the code comes to the buyer', () => {
    expect(checkGiftCardPurchase(form({ deliverOn: '2026-10-20' }), NOW).ok).toBe(false);
    expect(checkGiftCardPurchase(form({ deliverOn: '2027-03-01' }), NOW).ok).toBe(false);
    const later = checkGiftCardPurchase(form({ deliverOn: '2026-11-14' }), NOW);
    expect(later.ok && later.value.deliverOn).toBe('2026-11-14');
    // Today means "now".
    const today = checkGiftCardPurchase(form({ deliverOn: '2026-10-21' }), NOW);
    expect(today.ok && today.value.deliverOn).toBe(null);
    expect(checkGiftCardPurchase(form({ deliverOn: '2026-11-14', sendTo: 'buyer' }), NOW).ok).toBe(false);
  });

  it('sends a scheduled card on its day from 9am Kampala, never at midnight', () => {
    expect(kampalaToday(new Date('2026-11-13T21:30:00Z'))).toBe('2026-11-14'); // 00:30 EAT
    expect(scheduledSendDue('2026-11-14', new Date('2026-11-13T21:30:00Z'))).toBe(false);
    expect(scheduledSendDue('2026-11-14', new Date('2026-11-14T05:59:00Z'))).toBe(false); // 08:59 EAT
    expect(scheduledSendDue('2026-11-14', new Date('2026-11-14T06:00:00Z'))).toBe(true); // 09:00 EAT
    expect(scheduledSendDue('2026-11-14', new Date('2026-11-16T03:00:00Z'))).toBe(true); // a missed day still goes
    expect(scheduledSendDue(null, NOW)).toBe(true);
  });

  it('the card’s look is one of the drawn themes; anything else takes the GoldPlus look', () => {
    const r = checkGiftCardPurchase(form({ theme: 'birthday' }), NOW);
    expect(r.ok && r.value.theme).toBe('birthday');
    const odd = checkGiftCardPurchase(form({ theme: '<script>' }), NOW);
    expect(odd.ok && odd.value.theme).toBe('gold');
  });

  it('references are GC- and 10 unambiguous symbols; phones are masked', () => {
    const ref = giftCardPurchaseReference([0, 1, 2, 3, 4, 5, 6, 7, 8, 31]);
    expect(ref).toBe('GC-012345678Z');
    expect(isGiftCardPurchaseReference(ref)).toBe(true);
    for (const bad of ['GP-202610-1', 'GC-12345', 'GC-ILOU123456', 'gc-012345678z']) expect(isGiftCardPurchaseReference(bad)).toBe(false);
    expect(maskPhone('+256772111222')).toBe('07•• ••• 222');
  });

  it('the purchase form is a human form; its status is the tight lookup budget', () => {
    expect(classifyPublicEndpoint('POST', '/commerce/gift-cards/purchase')).toBe('quote-request');
    expect(classifyPublicEndpoint('GET', '/commerce/gift-cards/purchase/GC-012345678Z')).toBe('order-lookup');
    // Opening a card is a guess at a bearer code, like the balance check.
    expect(classifyPublicEndpoint('POST', '/commerce/gift-cards/open')).toBe('order-lookup');
  });
});

describe('gift card messages (0199)', () => {
  it('the recipient reads who it is from and the code, and that a note waits on the card; the buyer’s receipt never carries the code', () => {
    const received = smsText('GIFT_CARD_RECEIVED', { fromName: 'Rob', giftMessage: 'Happy birthday!', valueUgx: 50_000, creditCode: 'GPGC-AAAA-BBBB-CCCC' } as never)!;
    expect(received).toContain('Rob sent you a gift card of UGX 50,000, with a note for you on the card.');
    expect(received).not.toContain('Happy birthday');
    expect(smsText('GIFT_CARD_RECEIVED', { fromName: 'Rob', giftMessage: null, valueUgx: 50_000, creditCode: 'GPGC-AAAA-BBBB-CCCC' } as never)).toContain('gift card of UGX 50,000. Open it');
    expect(received).toContain('GPGC-AAAA-BBBB-CCCC');
    // The card opens from a link whose #fragment carries the code (never sent to a server).
    expect(received).toContain('/gift-card/open#GPGC-AAAA-BBBB-CCCC');
    const self = smsText('GIFT_CARD_RECEIVED', { toBuyer: true, recipientName: 'Sarah', valueUgx: 50_000, creditCode: 'GPGC-AAAA-BBBB-CCCC' } as never)!;
    expect(self).toContain('for Sarah is ready');
    const paid = smsText('GIFT_CARD_PAID', { valueUgx: 50_000, recipientName: 'Sarah', recipientPhoneMasked: '07•• ••• 222', reference: 'GC-012345678Z', deliverOnWords: 'Friday 14 November' } as never)!;
    expect(paid).toContain('on Friday 14 November morning');
    expect(paid).not.toMatch(/GPGC/);
    expect(emailCopy('GIFT_CARD_PAID', { valueUgx: 50_000, recipientName: 'Sarah', reference: 'GC-1' } as never)?.subject).toContain('Sarah');
    expect(CUSTOMER_TRANSACTIONAL_TEMPLATES).toEqual(expect.arrayContaining(['GIFT_CARD_RECEIVED', 'GIFT_CARD_PAID']));
  });

  it('an emoji in the name or note never reaches the SMS (one emoji would triple its parts); the note is on the card', () => {
    const t = smsText('GIFT_CARD_RECEIVED', { fromName: 'Rob 😊', giftMessage: 'Happy birthday! 🎂', valueUgx: 50_000, creditCode: 'GPGC-AAAA-BBBB-CCCC' } as never)!;
    expect(t).toContain('Rob sent you a gift card of UGX 50,000, with a note for you');
    expect(/[\u{1F300}-\u{1FAFF}]/u.test(t)).toBe(false);
  });

  it('every gift card text stays in the GSM alphabet (one "•" made the receipt UCS-2: 3 SMS parts instead of 2)', async () => {
    const GSM = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€";
    const h = harness();
    const r = await h.uc.start(form({ deliverOn: '2026-11-14' }), NOW);
    if (!r.ok) throw new Error('start');
    h.setStatus(h.paidStatus(r.reference));
    await h.uc.settle({ trackingId: `T-${r.reference}`, reference: r.reference, source: 'ipn' }, NOW);
    await h.uc.sweep(new Date('2026-11-14T07:00:00Z'));
    const texts = h.outbox.map((m) => smsText(m.template, m.data as never)!);
    expect(texts).toHaveLength(2);
    for (const t of texts) expect([...t].filter((c) => !GSM.includes(c))).toEqual([]);
    expect(texts[0]).toContain('07xx xxx 222');
    // Two parts at most for the receipt; the code text is the same length whatever the note says (it is not in it).
    expect(texts[0].length).toBeLessThanOrEqual(306);
    const long = smsText('GIFT_CARD_RECEIVED', { fromName: 'x'.repeat(40), giftMessage: 'y'.repeat(160), valueUgx: 500_000, creditCode: 'GPGC-AAAA-BBBB-CCCC' } as never)!;
    const short = smsText('GIFT_CARD_RECEIVED', { fromName: 'x'.repeat(40), giftMessage: 'y', valueUgx: 500_000, creditCode: 'GPGC-AAAA-BBBB-CCCC' } as never)!;
    expect(long).toBe(short);
    expect(long.length).toBeLessThanOrEqual(459);
  });
});

// ── The use cases, against an in-memory repository and a scripted Pesapal ──────────────────────────────
function harness(opts: { ipnId?: string | null; buyerActivity?: { started: number; paidUgx: number } } = {}) {
  let paidToday = 0;
  const photos = new Map<string, { image: Buffer; attached: boolean; at: Date; uploaderKey: string | null }>();
  let photoSeq = 0;
  let photoClock = () => NOW;
  let extraPhotosToday = 0;
  const rows = new Map<string, GiftCardPurchaseRecord>();
  const outbox: Array<{ template: string; phone: string; data: Record<string, unknown>; key: string }> = [];
  const cards: Array<{ id: string; code?: string; purchaseId: string; issuedBy: string; reason: string; recipientPhone: string | null; status: string; balance: number; held: number; initial: number; ledger: any[] }> = [];
  let pesapalStatus: any = null;
  const pesapalCalls: string[] = [];
  let seq = 0;
  const byRef = (r: string) => [...rows.values()].find((p) => p.reference === r) ?? null;
  const copy = (p: GiftCardPurchaseRecord | null) => (p ? { ...p } : null);
  const repo = {
    create: async (i: any) => { if (i.photoId) { const ph = photos.get(i.photoId); if (!ph || ph.attached) throw new Error('PHOTO_UNAVAILABLE'); ph.attached = true; } const p: GiftCardPurchaseRecord = { ...i, id: `p${++seq}`, textStatus: null, status: 'awaiting_payment', orderTrackingId: null, redirectUrl: null, providerStatus: null, confirmationCode: null, paymentMethod: null, instrumentId: null, cardLast4: null, createdAt: new Date(NOW), paidAt: null, issuedAt: null }; rows.set(p.id, p); return { ...p }; },
    byReference: async (r: string) => copy(byRef(r)),
    byTrackingId: async (t: string) => copy([...rows.values()].find((p) => p.orderTrackingId === t) ?? null),
    recordStarted: async (id: string, t: string, u: string) => { const p = rows.get(id)!; if (!p.orderTrackingId) Object.assign(p, { orderTrackingId: t, redirectUrl: u }); },
    buyerActivity: async () => opts.buyerActivity ?? { started: 0, paidUgx: 0 },
    paidSince: async () => paidToday,
    markPaid: async (id: string, i: any, receipt: any) => { const p = rows.get(id)!; if (!['awaiting_payment', 'failed', 'abandoned'].includes(p.status)) return false; Object.assign(p, { status: 'paid', paidAt: i.now, confirmationCode: i.confirmationCode, paymentMethod: i.paymentMethod }); if (receipt) outbox.push({ template: receipt.template, phone: receipt.phone, data: receipt.data, key: receipt.idempotencyKey }); return true; },
    markUnpaid: async (id: string, status: any, ps: string) => { const p = rows.get(id)!; if (p.status !== 'awaiting_payment' && !(status === 'review' && ['failed', 'abandoned'].includes(p.status))) return false; Object.assign(p, { status, providerStatus: ps }); return true; },
    issueCard: async (i: any) => {
      const p = rows.get(i.purchaseId)!; if (p.status !== 'paid' || p.instrumentId) return null;
      const id = `c${cards.length + 1}`;
      cards.push({ id, code: i.messages[0]?.data?.creditCode, purchaseId: p.id, issuedBy: i.issuedBy, reason: i.reason, recipientPhone: i.recipientPhone, status: 'active', balance: p.amountUgx, held: 0, initial: p.amountUgx, ledger: [{ type: 'ISSUE', amountUgx: p.amountUgx, holdState: null }] });
      Object.assign(p, { status: 'issued', instrumentId: id, cardLast4: i.last4, issuedAt: i.now });
      for (const m of i.messages) outbox.push({ template: m.template, phone: m.phone, data: m.data, key: m.idempotencyKey });
      return { instrumentId: id };
    },
    paidNotIssued: async () => [...rows.values()].filter((p) => p.status === 'paid' && !p.instrumentId).map((p) => ({ ...p })),
    awaitingWithTransaction: async (older: Date, newer: Date) => [...rows.values()].filter((p) => p.status === 'awaiting_payment' && p.orderTrackingId && p.createdAt <= older && p.createdAt >= newer).map((p) => ({ ...p })),
    awaitingStale: async (older: Date) => [...rows.values()].filter((p) => p.status === 'awaiting_payment' && p.createdAt < older).map((p) => ({ ...p })),
    forBuyer: async () => [],
    redirect: async (i: any) => {
      const p = rows.get(i.purchaseId)!;
      if (p.sendTo !== 'recipient') return { result: 'not_redirectable' };
      if (p.status === 'paid' && !p.instrumentId) { p.recipientPhone = i.recipientPhone; return { result: 'updated', instrumentId: null }; }
      const old = cards.find((c) => c.id === p.instrumentId);
      if (p.status !== 'issued' || !old) return { result: 'not_redirectable' };
      if (old.status !== 'active' || old.balance !== old.initial || old.held > 0) return { result: 'touched' };
      old.status = 'void'; old.balance = 0;
      const id = `c${cards.length + 1}`;
      cards.push({ id, code: i.newCard.message.data.creditCode, purchaseId: p.id, issuedBy: i.newCard.issuedBy, reason: i.newCard.reason, recipientPhone: i.recipientPhone, status: 'active', balance: p.amountUgx, held: 0, initial: p.amountUgx, ledger: [] });
      Object.assign(p, { instrumentId: id, recipientPhone: i.recipientPhone });
      outbox.push({ template: i.newCard.message.template, phone: i.newCard.message.phone, data: i.newCard.message.data, key: i.newCard.message.idempotencyKey });
      return { result: 'reissued', instrumentId: id };
    },
    faceByCodeHash: async (hash: string) => { const c = cards.find((x) => `h:${x.code}` === hash); const p = c ? rows.get(c.purchaseId) : null; return p ? { theme: p.theme, fromName: p.fromName, toName: p.recipientName, message: p.message, originalUgx: p.amountUgx, photoId: p.photoId ?? null } : null; },
    recent: async () => [],
    savePhoto: async (image: Buffer, _w: number, _h: number, uploaderKey: string | null) => { const id = `${String(++photoSeq).padStart(8, '0')}-0000-4000-8000-000000000000`; photos.set(id, { image, attached: false, at: photoClock(), uploaderKey }); return id; },
    photoImage: async (id: string, unclaimedAfter: Date) => { const ph = photos.get(id); return ph && (ph.attached || ph.at > unclaimedAfter) ? ph.image : null; },
    photosSince: async (since: Date, uploaderKey?: string) => [...photos.values()].filter((ph) => ph.at > since && (!uploaderKey || ph.uploaderKey === uploaderKey)).length + (uploaderKey ? 0 : extraPhotosToday),
    deleteStalePhotos: async (unclaimedBefore: Date, endedBefore: Date, cardDoneBefore: Date) => {
      let n = 0;
      for (const [id, ph] of photos) if (!ph.attached && ph.at < unclaimedBefore) { photos.delete(id); n++; }
      for (const p of rows.values()) if (p.photoId && ['abandoned', 'failed', 'refunded'].includes(p.status) && (p as any).endedAt < endedBefore) { photos.delete(p.photoId); p.photoId = null; n++; }
      for (const p of rows.values()) {
        const card = cards.find((c) => c.id === p.instrumentId);
        if (p.photoId && card && (card.status === 'void' || card.balance <= 0) && (card as any).lastMovedAt < cardDoneBefore) { photos.delete(p.photoId); p.photoId = null; n++; }
      }
      return n;
    },
    purchaseIdByCodeHash: async (hash: string) => cards.find((c) => `h:${c.code}` === hash)?.purchaseId ?? null,
    removePhoto: async (purchaseId: string) => { const p = rows.get(purchaseId); if (!p?.photoId) return false; photos.delete(p.photoId); p.photoId = null; return true; },
    markRefunded: async (id: string, _n: string, o?: any) => { const p = rows.get(id)!; if (!['paid', 'issued', 'review'].includes(p.status) || (o?.unissuedOnly && p.instrumentId)) return false; p.status = 'refunded'; return true; },
  };
  const credit = {
    findById: async (id: string) => { const c = cards.find((x) => x.id === id); return c ? { id: c.id, status: c.status, balanceUgx: c.balance, heldUgx: c.held, initialValueUgx: c.initial } as any : null; },
    voidInstrument: async (id: string) => { const c = cards.find((x) => x.id === id)!; if (c.status === 'void') return null; const left = c.balance; c.status = 'void'; c.ledger.push({ type: 'VOID', amountUgx: -left, holdState: null }); c.balance = 0; return left; },
    ledger: async (id: string) => cards.find((x) => x.id === id)!.ledger,
  };
  const pesapal = {
    submitOrderRequest: async (i: any) => { pesapalCalls.push(`submit:${i.id}:${i.amount}:${i.callback_url}:${i.cancellation_url}`); return { order_tracking_id: `T-${i.id}`, merchant_reference: i.id, redirect_url: `https://pay.pesapal.com/${i.id}` }; },
    getTransactionStatus: async (t: string) => { pesapalCalls.push(`status:${t}`); return typeof pesapalStatus === 'function' ? pesapalStatus(t) : pesapalStatus; },
    requestRefund: async (i: any) => { pesapalCalls.push(`refund:${i.confirmationCode}:${i.amount}`); return { status: '200', message: 'ok' }; },
  };
  let idx = 0;
  const uc = new GiftCardPurchaseUseCases(repo as any, credit as any, pesapal as any, {
    hash: (c: string) => `h:${c}`, randomIndexes: () => Array.from({ length: 11 }, () => (idx++) % 32), referenceIndexes: () => Array.from({ length: 10 }, () => (idx++) % 32),
    normalizePhone: (p: string) => `+256${p.replace(/\D/g, '').slice(-9)}`,
  }, () => ({ ipnId: opts.ipnId === undefined ? 'ipn-1' : opts.ipnId, callbackUrl: 'https://api/cb', resultPageUrl: 'https://shop/gift-card/bought', dailyShopCapUgx: 1_000_000 }), undefined, {
    process: async (b: Buffer) => {
      const s = b.toString();
      if (s === 'not a photo') throw new Error('PHOTO_NOT_AN_IMAGE');
      if (s === 'tiny') throw new Error('PHOTO_TOO_SMALL');
      if (s === 'no sharp') throw new Error('PHOTO_PROCESSOR_UNAVAILABLE');
      return { image: Buffer.from(`jpeg:${b}`), width: 1080, height: 1080 };
    },
  });
  const paidStatus = (ref: string, amount = 50_000) => ({ order_tracking_id: `T-${ref}`, merchant_reference: ref, amount, currency: 'UGX', status_code: 1, payment_status_description: 'Completed', confirmation_code: 'MTN123', payment_method: 'MTN' });
  return { uc, rows, outbox, cards, photos, setPhotoClock: (f: () => Date) => { photoClock = f; }, setExtraPhotosToday: (n: number) => { extraPhotosToday = n; }, pesapalCalls, setStatus: (s: any) => { pesapalStatus = s; }, paidStatus, byRef, setPaidToday: (n: number) => { paidToday = n; } };
}

describe('buying a gift card online (0199)', () => {
  it('opens a Pesapal payment under its own GC- reference, returning to the shared callback', async () => {
    const h = harness();
    const r = await h.uc.start(form(), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reference).toMatch(/^GC-/);
    expect(h.pesapalCalls[0]).toBe(`submit:${r.reference}:50000:https://api/cb:https://shop/gift-card/bought?ref=${r.reference}&cancelled=1`);
    expect(h.byRef(r.reference)).toMatchObject({ status: 'awaiting_payment', orderTrackingId: `T-${r.reference}`, recipientPhone: '+256772111222', buyerPhone: '+256701333444' });
  });

  it('refuses an invalid form with field messages, and says "not configured" without an IPN id', async () => {
    const bad = await harness().uc.start(form({ amountUgx: 5 }), NOW);
    expect(bad.ok === false && bad.code === 'INVALID' && bad.errors.amountUgx).toBeTruthy();
    const off = await harness({ ipnId: null }).uc.start(form(), NOW);
    expect(off.ok === false && off.code).toBe('NOT_CONFIGURED');
  });

  it('paid: the buyer gets a receipt, the card is issued and its code texted to them, once', async () => {
    const h = harness();
    const r = await h.uc.start(form(), NOW);
    if (!r.ok) throw new Error('start');
    h.setStatus(h.paidStatus(r.reference));
    const after = await h.uc.settle({ trackingId: `T-${r.reference}`, reference: r.reference, source: 'ipn' }, NOW);
    expect(after?.status).toBe('issued');
    expect(h.cards).toHaveLength(1);
    expect(h.cards[0]).toMatchObject({ issuedBy: ONLINE_GIFT_CARD_ISSUER_ID, recipientPhone: '+256772111222', initial: 50_000 });
    expect(h.outbox.map((m) => `${m.template}:${m.phone}`)).toEqual(['GIFT_CARD_PAID:+256701333444', 'GIFT_CARD_RECEIVED:+256772111222']);
    expect(String(h.outbox[1].data.creditCode)).toMatch(/^GPGC-/);
    expect(h.outbox[0].data).not.toHaveProperty('creditCode');
    // Replays (callback after IPN, the poller) change nothing.
    await h.uc.settle({ trackingId: `T-${r.reference}`, reference: r.reference, source: 'callback' }, NOW);
    await h.uc.sweep(new Date(NOW.getTime() + 3_600_000));
    expect(h.cards).toHaveLength(1);
    expect(h.outbox).toHaveLength(2);
  });

  it('scheduled: paid now, issued and texted on its morning by the sweep', async () => {
    const h = harness();
    const r = await h.uc.start(form({ deliverOn: '2026-11-14' }), NOW);
    if (!r.ok) throw new Error('start');
    h.setStatus(h.paidStatus(r.reference));
    expect((await h.uc.settle({ trackingId: `T-${r.reference}`, reference: r.reference, source: 'callback' }, NOW))?.status).toBe('paid');
    expect(h.outbox.map((m) => m.template)).toEqual(['GIFT_CARD_PAID']);
    expect(h.outbox[0].data.deliverOnWords).toBe('Saturday 14 November');
    expect((await h.uc.sweep(new Date('2026-11-14T05:30:00Z'))).issued).toBe(0); // 08:30 EAT
    expect((await h.uc.sweep(new Date('2026-11-14T06:05:00Z'))).issued).toBe(1); // 09:05 EAT
    expect(h.byRef(r.reference)?.status).toBe('issued');
  });

  it('the code to the buyer: one message, the code, to the buyer’s phone; the card still names who it is for', async () => {
    const h = harness();
    const r = await h.uc.start(form({ sendTo: 'buyer', recipientPhone: '' }), NOW);
    if (!r.ok) throw new Error('start');
    h.setStatus(h.paidStatus(r.reference));
    await h.uc.settle({ trackingId: `T-${r.reference}`, reference: r.reference, source: 'ipn' }, NOW);
    expect(h.outbox.map((m) => `${m.template}:${m.phone}:${m.data.toBuyer}`)).toEqual(['GIFT_CARD_RECEIVED:+256701333444:true']);
    expect(h.cards[0].recipientPhone).toBe('+256701333444');
  });

  it('believes only Pesapal: a wrong reference changes nothing; a different amount goes to review with no card', async () => {
    const h = harness();
    const r = await h.uc.start(form(), NOW);
    if (!r.ok) throw new Error('start');
    expect(await h.uc.settle({ trackingId: `T-${r.reference}`, reference: 'GC-0000000000', source: 'callback' }, NOW)).toBeNull();
    h.setStatus(h.paidStatus(r.reference, 5_000));
    expect((await h.uc.settle({ trackingId: `T-${r.reference}`, reference: r.reference, source: 'ipn' }, NOW))?.status).toBe('review');
    expect(h.cards).toHaveLength(0);
  });

  it('not paid yet stays open; a decline, or silence past a day, closes it with no card', async () => {
    const h = harness();
    const r = await h.uc.start(form(), NOW);
    if (!r.ok) throw new Error('start');
    h.setStatus({ merchant_reference: r.reference, amount: 50_000, currency: 'UGX', status_code: 0, payment_status_description: 'INVALID' });
    expect((await h.uc.settle({ trackingId: `T-${r.reference}`, reference: r.reference, source: 'poll' }, NOW))?.status).toBe('awaiting_payment');
    expect((await h.uc.settle({ trackingId: `T-${r.reference}`, reference: r.reference, source: 'poll' }, new Date(NOW.getTime() + 25 * 3_600_000)))?.status).toBe('failed');
    const h2 = harness();
    const r2 = await h2.uc.start(form(), NOW);
    if (!r2.ok) throw new Error('start');
    h2.setStatus({ merchant_reference: r2.reference, amount: 50_000, currency: 'UGX', status_code: 2, payment_status_description: 'Failed' });
    expect((await h2.uc.settle({ trackingId: `T-${r2.reference}`, reference: r2.reference, source: 'ipn' }, NOW))?.status).toBe('failed');
    expect(h2.cards).toHaveLength(0);
  });

  it('the public status shows first names and masked numbers only, and asks Pesapal when it has not heard', async () => {
    const h = harness();
    const r = await h.uc.start(form(), NOW);
    if (!r.ok) throw new Error('start');
    h.setStatus(h.paidStatus(r.reference));
    const s = await h.uc.publicStatus(r.reference, NOW);
    expect(s).toEqual({ reference: r.reference, status: 'issued', amountUgx: 50_000, recipientFirstName: 'Sarah', theme: 'gold', fromName: 'Rob', message: 'Happy birthday!', recipientPhoneMasked: '07•• ••• 222', buyerPhoneMasked: '07•• ••• 444', sendTo: 'recipient', deliverOn: null, textStatus: null, photoId: null });
    expect(await h.uc.publicStatus('GP-202610-ABC', NOW)).toBeNull();
  });

  it('the card opens to its face (theme, from, for, message) for whoever holds the code; nothing for another code', async () => {
    const h = harness();
    const r = await h.uc.start(form({ theme: 'love' }), NOW);
    if (!r.ok) throw new Error('start');
    h.setStatus(h.paidStatus(r.reference));
    await h.uc.settle({ trackingId: `T-${r.reference}`, reference: r.reference, source: 'ipn' }, NOW);
    const code = String(h.outbox.find((m) => m.template === 'GIFT_CARD_RECEIVED')!.data.creditCode);
    expect(await h.uc.faceForCode(code)).toEqual({ theme: 'love', fromName: 'Rob', toName: 'Sarah Nakato', message: 'Happy birthday!', originalUgx: 50_000, photoId: null });
    expect(await h.uc.faceForCode('GPGC-0000-0000-0000')).toBeNull();
  });

  it('a wrong number: an untouched card gets a NEW code at the corrected number and the old one dies', async () => {
    const h = harness();
    const r = await h.uc.start(form(), NOW);
    if (!r.ok) throw new Error('start');
    h.setStatus(h.paidStatus(r.reference));
    await h.uc.settle({ trackingId: `T-${r.reference}`, reference: r.reference, source: 'ipn' }, NOW);
    const firstCode = String(h.outbox.find((m) => m.template === 'GIFT_CARD_RECEIVED')!.data.creditCode);
    expect((await h.uc.redirect(r.reference, '0772 999888', 'staff', 'x')).ok).toBe(false); // needs a reason
    expect((await h.uc.redirect(r.reference, '12345', 'staff', 'Buyer typo')).ok).toBe(false); // needs a real number
    const moved = await h.uc.redirect(r.reference, '0772 999888', 'staff', 'Buyer typed the number wrong');
    expect(moved.ok).toBe(true);
    expect(h.cards.map((c) => c.status)).toEqual(['void', 'active']);
    const last = h.outbox.at(-1)!;
    expect([last.template, last.phone]).toEqual(['GIFT_CARD_RECEIVED', '+256772999888']);
    expect(last.data.creditCode).not.toBe(firstCode);
    expect(last.key).not.toBe(`gift-card-received:${h.byRef(r.reference)!.id}`); // its own message, never swallowed as a duplicate
    // Spent from: refused, nothing changes.
    h.cards[1].balance = 10_000;
    expect((await h.uc.redirect(r.reference, '0772 777666', 'staff', 'Buyer typo again')).ok).toBe(false);
    expect(h.cards).toHaveLength(2);
  });

  it('a wrong number before a scheduled card goes out: only the number changes', async () => {
    const h = harness();
    const r = await h.uc.start(form({ deliverOn: '2026-11-14' }), NOW);
    if (!r.ok) throw new Error('start');
    h.setStatus(h.paidStatus(r.reference));
    await h.uc.settle({ trackingId: `T-${r.reference}`, reference: r.reference, source: 'ipn' }, NOW);
    expect((await h.uc.redirect(r.reference, '0772 999888', 'staff', 'Buyer typo')).ok).toBe(true);
    await h.uc.sweep(new Date('2026-11-14T07:00:00Z'));
    expect(h.outbox.at(-1)!.phone).toBe('+256772999888');
    expect(h.cards).toHaveLength(1);
  });

  it('the buyer’s receipt links to where they follow the card, and stays two SMS parts', () => {
    const paid = smsText('GIFT_CARD_PAID', { valueUgx: 500_000, recipientName: 'Christabel', recipientPhoneMasked: '07xx xxx 222', reference: 'GC-012345678Z', deliverOnWords: 'Wednesday 30 September' } as never)!;
    expect(paid).toContain('/gift-card/bought?ref=GC-012345678Z');
    expect(paid.length).toBeLessThanOrEqual(306);
  });

  it('refund: an untouched card is cancelled first, then Pesapal refunds; a spent card is refused', async () => {
    const h = harness();
    const r = await h.uc.start(form(), NOW);
    if (!r.ok) throw new Error('start');
    h.setStatus(h.paidStatus(r.reference));
    await h.uc.settle({ trackingId: `T-${r.reference}`, reference: r.reference, source: 'ipn' }, NOW);
    h.cards[0].balance = 20_000; // part spent
    expect((await h.uc.refund(r.reference, { id: 'staff', username: 's@x' }, 'Changed mind')).ok).toBe(false);
    expect(h.cards[0].status).toBe('active');
    h.cards[0].balance = 50_000;
    const ok = await h.uc.refund(r.reference, { id: 'staff', username: 's@x' }, 'Changed mind');
    expect(ok.ok).toBe(true);
    expect(h.cards[0].status).toBe('void');
    expect(h.pesapalCalls.at(-1)).toBe('refund:MTN123:50000');
    expect(h.byRef(r.reference)?.status).toBe('refunded');
  });

  it('refund of a scheduled card closes the purchase before Pesapal is asked, so the morning sweep never issues it', async () => {
    const h = harness();
    const r = await h.uc.start(form({ deliverOn: '2026-11-14' }), NOW);
    if (!r.ok) throw new Error('start');
    h.setStatus(h.paidStatus(r.reference));
    await h.uc.settle({ trackingId: `T-${r.reference}`, reference: r.reference, source: 'ipn' }, NOW);
    expect((await h.uc.refund(r.reference, { id: 'staff', username: 's@x' }, 'Wrong person')).ok).toBe(true);
    expect((await h.uc.sweep(new Date('2026-11-14T07:00:00Z'))).issued).toBe(0);
    expect(h.cards).toHaveLength(0);
  });

  it('limits a buyer’s number per day, and pauses online sales shop-wide past the daily ceiling', async () => {
    const busy = await harness({ buyerActivity: { started: 6, paidUgx: 0 } }).uc.start(form(), NOW);
    expect(busy.ok === false && busy.code).toBe('LIMIT');
    const big = await harness({ buyerActivity: { started: 1, paidUgx: 980_000 } }).uc.start(form(), NOW);
    expect(big.ok === false && big.code).toBe('LIMIT');
    const h = harness();
    h.setPaidToday(980_000);
    const shop = await h.uc.start(form(), NOW);
    expect(shop.ok === false && shop.code === 'LIMIT' && shop.message).toMatch(/paused for today/);
    expect(h.pesapalCalls).toHaveLength(0);
  });

  it('money Pesapal confirms after we gave up is still honoured: the card is issued (the poller never re-asks)', async () => {
    const h = harness();
    const r = await h.uc.start(form(), NOW);
    if (!r.ok) throw new Error('start');
    h.setStatus({ merchant_reference: r.reference, amount: 50_000, currency: 'UGX', status_code: 2, payment_status_description: 'Failed' });
    await h.uc.settle({ trackingId: `T-${r.reference}`, reference: r.reference, source: 'ipn' }, NOW);
    expect(h.byRef(r.reference)?.status).toBe('failed');
    h.setStatus(h.paidStatus(r.reference));
    const asked = h.pesapalCalls.length;
    await h.uc.sweep(new Date(NOW.getTime() + 3_600_000));
    expect(h.pesapalCalls.length).toBe(asked); // the poller leaves closed purchases alone
    expect((await h.uc.settle({ trackingId: `T-${r.reference}`, reference: r.reference, source: 'ipn' }, NOW))?.status).toBe('issued');
    expect(h.cards).toHaveLength(1);
  });

  it('the sweep closes a page never opened after a day, and an opened, unanswered one after a week', async () => {
    const h = harness();
    const r = await h.uc.start(form(), NOW);
    if (!r.ok) throw new Error('start');
    h.setStatus({ merchant_reference: r.reference, amount: 50_000, currency: 'UGX', status_code: 0, payment_status_description: '' });
    // Opened (has a transaction), a day later: asked, and 0 past the grace closes it as failed.
    const day = await h.uc.sweep(new Date(NOW.getTime() + 25 * 3_600_000));
    expect(day.polled).toBe(1);
    expect(h.byRef(r.reference)?.status).toBe('failed');
  });
});

describe('a photo on the card (0201)', () => {
  it('is re-encoded, claimed by exactly one purchase, and shown back on the buyer’s status', async () => {
    const h = harness();
    const up = await h.uc.uploadPhoto(Buffer.from('camera bytes'), 'visitor-a');
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    expect(String(await h.uc.photoImage(up.photoId))).toBe('jpeg:camera bytes'); // what is stored is the re-encoded copy
    const r = await h.uc.start(form({ photoId: up.photoId }), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(h.byRef(r.reference)!.photoId).toBe(up.photoId);
    h.setStatus(h.paidStatus(r.reference));
    expect((await h.uc.publicStatus(r.reference, NOW))!.photoId).toBe(up.photoId);
    // The same photo cannot ride a second purchase.
    const again = await h.uc.start(form({ photoId: up.photoId, buyerPhone: '0701 999888' }), NOW);
    expect(again).toMatchObject({ ok: false, code: 'INVALID', errors: { photo: expect.stringContaining('Add it again') } });
  });

  it('refuses what is not a photo or too small to print, and a made-up id; the card works without one', async () => {
    const h = harness();
    expect(await h.uc.uploadPhoto(Buffer.from('not a photo'), null)).toMatchObject({ ok: false, message: expect.stringContaining('JPEG or PNG') });
    // The image library failing to load only turns photos off; the card still sells.
    expect(await h.uc.uploadPhoto(Buffer.from('no sharp'), null)).toMatchObject({ ok: false, message: expect.stringContaining('The card works without one') });
    expect(await h.uc.uploadPhoto(Buffer.from('tiny'), null)).toMatchObject({ ok: false, message: expect.stringContaining('too small') });
    expect(await h.uc.uploadPhoto(Buffer.alloc(0), null)).toMatchObject({ ok: false });
    expect(checkGiftCardPurchase(form({ photoId: '../etc/passwd' }), NOW)).toMatchObject({ ok: false, errors: { photo: expect.any(String) } });
    expect(await h.uc.photoImage('../etc/passwd')).toBeNull();
    const r = await h.uc.start(form({ photoId: '' }), NOW);
    expect(r.ok).toBe(true);
  });

  it('an unclaimed photo is deleted by the sweep; staff can take one off a card', async () => {
    const h = harness();
    const kept = await h.uc.uploadPhoto(Buffer.from('a'), null);
    const stray = await h.uc.uploadPhoto(Buffer.from('b'), null);
    if (!kept.ok || !stray.ok) throw new Error('upload');
    const r = await h.uc.start(form({ photoId: kept.photoId }), NOW);
    if (!r.ok) throw new Error('start');
    await h.uc.sweep(new Date(NOW.getTime() + 2 * 86_400_000));
    expect(h.photos.has(stray.photoId)).toBe(true); // still within its three days
    await h.uc.sweep(new Date(NOW.getTime() + 4 * 86_400_000));
    expect(h.photos.has(stray.photoId)).toBe(false);
    expect(h.photos.has(kept.photoId)).toBe(true);
    expect(await h.uc.removePhoto(r.reference)).toMatchObject({ ok: true });
    expect(await h.uc.removePhoto(r.reference)).toMatchObject({ ok: false, message: 'This card has no photo.' });
    expect(h.byRef(r.reference)!.photoId).toBeNull();
    expect(await h.uc.photoImage(kept.photoId)).toBeNull();
  });

  it('an upload is a human form on the abuse budget, not the global one', () => {
    expect(classifyPublicEndpoint('POST', '/commerce/gift-cards/photos')).toBe('issue-report');
  });

  it('the shop takes at most 400 photos a day (the upload needs no account); above that the card sells without one', async () => {
    const h = harness();
    h.setExtraPhotosToday(GIFT_CARD_PHOTOS_PER_DAY - 1);
    expect((await h.uc.uploadPhoto(Buffer.from('a'), null, NOW)).ok).toBe(true);
    expect(await h.uc.uploadPhoto(Buffer.from('b'), null, NOW)).toMatchObject({ ok: false, message: expect.stringContaining('The card works without one') });
  });

  it('an unclaimed upload stops showing when it can no longer be put on a card (two days), so a kept draft notices', async () => {
    const h = harness();
    h.setPhotoClock(() => new Date(NOW.getTime() - 2 * 86_400_000 - 60_000));
    const old = await h.uc.uploadPhoto(Buffer.from('old'), null);
    h.setPhotoClock(() => NOW);
    const fresh = await h.uc.uploadPhoto(Buffer.from('fresh'), null);
    if (!old.ok || !fresh.ok) throw new Error('upload');
    expect(await h.uc.photoImage(old.photoId, NOW)).toBeNull();
    expect(await h.uc.photoImage(fresh.photoId, NOW)).not.toBeNull();
    expect(await h.uc.photoImage('------------------------------------', NOW)).toBeNull(); // 36 characters, not a uuid
  });

  it('the photo of a purchase that ended unpaid goes 30 days after it ended; a paid card keeps its photo', async () => {
    const h = harness();
    const a = await h.uc.uploadPhoto(Buffer.from('a'), null);
    const b = await h.uc.uploadPhoto(Buffer.from('b'), null);
    if (!a.ok || !b.ok) throw new Error('upload');
    const r1 = await h.uc.start(form({ photoId: a.photoId }), NOW);
    const r2 = await h.uc.start(form({ photoId: b.photoId, buyerPhone: '0701 999888' }), NOW);
    if (!r1.ok || !r2.ok) throw new Error('start');
    Object.assign(h.byRef(r1.reference)!, { status: 'abandoned', endedAt: new Date(NOW.getTime() - 31 * 86_400_000) });
    await h.uc.sweep(NOW);
    expect(h.byRef(r1.reference)!.photoId).toBeNull();
    expect(h.photos.has(a.photoId)).toBe(false);
    expect(h.byRef(r2.reference)!.photoId).toBe(b.photoId);
  });

  it('one visitor may add 20 photos a day; another visitor is not affected', async () => {
    const h = harness();
    for (let i = 0; i < GIFT_CARD_PHOTOS_PER_VISITOR_PER_DAY; i++) expect((await h.uc.uploadPhoto(Buffer.from(`p${i}`), 'visitor-a', NOW)).ok).toBe(true);
    expect(await h.uc.uploadPhoto(Buffer.from('one more'), 'visitor-a', NOW)).toMatchObject({ ok: false, message: expect.stringContaining('one phone in a day') });
    expect((await h.uc.uploadPhoto(Buffer.from('other'), 'visitor-b', NOW)).ok).toBe(true);
    // The next day the first visitor can add photos again.
    expect((await h.uc.uploadPhoto(Buffer.from('tomorrow'), 'visitor-a', new Date(NOW.getTime() + 86_400_000 + 60_000))).ok).toBe(true);
  });

  it('the person the card is for removes its photo with the card’s code; a wrong code removes nothing', async () => {
    const h = harness();
    const up = await h.uc.uploadPhoto(Buffer.from('a'), null);
    if (!up.ok) throw new Error('upload');
    const r = await h.uc.start(form({ photoId: up.photoId }), NOW);
    if (!r.ok) throw new Error('start');
    h.setStatus(h.paidStatus(r.reference));
    await h.uc.settle({ trackingId: `T-${r.reference}`, reference: r.reference, source: 'ipn' }, NOW);
    const code = h.cards[0].code!;
    expect(await h.uc.removePhotoByCode('GPGC-AAAA-BBBB-CCCC')).toMatchObject({ ok: false, message: expect.stringContaining('not right') });
    expect(h.byRef(r.reference)!.photoId).toBe(up.photoId);
    expect(await h.uc.removePhotoByCode(code)).toMatchObject({ ok: true });
    expect(h.byRef(r.reference)!.photoId).toBeNull();
    expect(h.photos.has(up.photoId)).toBe(false);
    expect(await h.uc.removePhotoByCode(code)).toMatchObject({ ok: false, message: 'This card has no photo.' });
  });

  it('a card used up, cancelled or expired keeps its photo for 90 days after its last movement, then loses it', async () => {
    const h = harness();
    const up = await h.uc.uploadPhoto(Buffer.from('a'), null);
    if (!up.ok) throw new Error('upload');
    const r = await h.uc.start(form({ photoId: up.photoId }), NOW);
    if (!r.ok) throw new Error('start');
    h.setStatus(h.paidStatus(r.reference));
    await h.uc.settle({ trackingId: `T-${r.reference}`, reference: r.reference, source: 'ipn' }, NOW);
    Object.assign(h.cards[0], { balance: 0, lastMovedAt: NOW });
    await h.uc.sweep(new Date(NOW.getTime() + 89 * 86_400_000));
    expect(h.byRef(r.reference)!.photoId).toBe(up.photoId); // still within 90 days
    await h.uc.sweep(new Date(NOW.getTime() + 91 * 86_400_000));
    expect(h.byRef(r.reference)!.photoId).toBeNull();
  });

  it('removing a photo is a lookup by a secret (code or reference): the tight budget, never the global one', () => {
    expect(classifyPublicEndpoint('POST', '/commerce/gift-cards/photo/remove-by-code')).toBe('order-lookup');
    expect(classifyPublicEndpoint('POST', '/commerce/gift-cards/purchase/GC-0123456789/remove-photo')).toBe('order-lookup');
  });
});
