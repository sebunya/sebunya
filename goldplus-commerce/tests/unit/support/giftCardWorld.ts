// An in-memory gift card world for the use case tests: purchases, cards, photos and a scripted Pesapal, behind the
// same ports the real repositories implement (purchases: IGiftCardPurchaseRepository; photos: IGiftCardPhotoRepository).
import { GiftCardPurchaseUseCases } from '../../../apps/api/src/application/use-cases/credit/GiftCardPurchaseUseCases';
import { GiftCardPhotoUseCases } from '../../../apps/api/src/application/use-cases/credit/GiftCardPhotoUseCases';
import { GiftCardPhotoUnavailableError, type GiftCardPurchaseRecord } from '../../../apps/api/src/application/ports/IGiftCardPurchaseRepository';
import type { IGiftCardPhotoProcessor } from '../../../apps/api/src/application/ports/IGiftCardPhotoRepository';

/** 2026-10-21 10:00 Kampala (07:00 UTC). */
export const NOW = new Date('2026-10-21T07:00:00Z');

export const giftForm = (over: Record<string, unknown> = {}) => ({
  amountUgx: 50_000, recipientName: 'Sarah Nakato', recipientPhone: '0772 111222', sendTo: 'recipient', message: 'Happy birthday!',
  fromName: 'Rob', buyerName: 'Robert S', buyerPhone: '0701 333444', buyerEmail: '', deliverOn: '', ...over,
});

type Card = { id: string; code?: string; purchaseId: string; issuedBy: string; reason: string; recipientPhone: string | null; status: string; balance: number; held: number; initial: number; ledger: any[]; lastMovedAt?: Date };
type Photo = { image: Buffer; attached: boolean; at: Date; uploaderKey: string | null };

const lastNine = (phone: string | null) => String(phone ?? '').replace(/\D/g, '').slice(-9);

/** The test processor: a few magic inputs stand for the refusals; anything else is "re-encoded". */
export const fakePhotoProcessor: IGiftCardPhotoProcessor = {
  process: async (b: Buffer) => {
    const s = b.toString();
    if (s === 'not a photo') return { ok: false, reason: 'not_an_image' };
    if (s === 'tiny') return { ok: false, reason: 'too_small' };
    if (s === 'huge') return { ok: false, reason: 'too_large' };
    if (s === 'no sharp') return { ok: false, reason: 'unavailable' };
    return { ok: true, image: Buffer.from(`jpeg:${s}`), width: 1080, height: 1080 };
  },
};

export function giftCardWorld(opts: { ipnId?: string | null; buyerActivity?: { started: number; paidUgx: number }; processor?: IGiftCardPhotoProcessor | null } = {}) {
  let paidToday = 0;
  let extraPhotosToday = 0;
  let photoClock = () => NOW;
  let photoSeq = 0;
  let seq = 0;
  let pesapalStatus: any = null;
  const rows = new Map<string, GiftCardPurchaseRecord>();
  const photos = new Map<string, Photo>();
  const outbox: Array<{ template: string; phone: string; data: Record<string, unknown>; key: string }> = [];
  const cards: Card[] = [];
  const pesapalCalls: string[] = [];
  const logs: Array<{ event: string; detail: Record<string, unknown> }> = [];
  const byRef = (r: string) => [...rows.values()].find((p) => p.reference === r) ?? null;
  const copy = (p: GiftCardPurchaseRecord | null) => (p ? { ...p } : null);
  const newPhotoId = () => `${String(++photoSeq).padStart(8, '0')}-0000-4000-8000-000000000000`;

  const purchaseRepo = {
    // The claim, as DrizzleGiftCardPurchaseRepository.create does it: a fresh unclaimed upload, or a copy of a photo
    // already on one of this buyer's purchases, or nothing written at all.
    create: async (i: any, o: { photoClaimableAfter: Date }) => {
      let photoId: string | null = null;
      if (i.photoId) {
        const ph = photos.get(i.photoId);
        if (ph && !ph.attached && ph.at > o.photoClaimableAfter) { ph.attached = true; photoId = i.photoId; }
        else if (ph && [...rows.values()].some((p) => p.photoId === i.photoId && lastNine(p.buyerPhone) === lastNine(i.buyerPhone))) {
          photoId = newPhotoId();
          photos.set(photoId, { ...ph, attached: true, at: photoClock() });
        } else throw new GiftCardPhotoUnavailableError();
      }
      const p: GiftCardPurchaseRecord = { ...i, photoId, id: `p${++seq}`, textStatus: null, status: 'awaiting_payment', orderTrackingId: null, redirectUrl: null, providerStatus: null, confirmationCode: null, paymentMethod: null, instrumentId: null, cardLast4: null, createdAt: new Date(NOW), paidAt: null, issuedAt: null };
      rows.set(p.id, p);
      return { ...p };
    },
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
    markRefunded: async (id: string, _n: string, o?: any) => { const p = rows.get(id)!; if (!['paid', 'issued', 'review'].includes(p.status) || (o?.unissuedOnly && p.instrumentId)) return false; p.status = 'refunded'; return true; },
  };

  const photoRepo = {
    save: async (photo: { image: Buffer }, uploaderKey: string | null) => { const id = newPhotoId(); photos.set(id, { image: photo.image, attached: false, at: photoClock(), uploaderKey }); return id; },
    image: async (id: string, claimableAfter: Date) => { const ph = photos.get(id); return ph && (ph.attached || ph.at > claimableAfter) ? ph.image : null; },
    countSince: async (since: Date, uploaderKey?: string) => [...photos.values()].filter((ph) => ph.at > since && (!uploaderKey || ph.uploaderKey === uploaderKey)).length + (uploaderKey ? 0 : extraPhotosToday),
    deleteStale: async (c: { unclaimedBefore: Date; purchaseEndedBefore: Date; cardDoneBefore: Date }) => {
      let n = 0;
      for (const [id, ph] of photos) if (!ph.attached && ph.at < c.unclaimedBefore) { photos.delete(id); n++; }
      for (const p of rows.values()) if (p.photoId && ['abandoned', 'failed', 'refunded'].includes(p.status) && (p as any).endedAt < c.purchaseEndedBefore) { photos.delete(p.photoId); p.photoId = null; n++; }
      for (const p of rows.values()) {
        const card = cards.find((x) => x.id === p.instrumentId);
        if (p.photoId && card && (card.status === 'void' || card.balance <= 0) && card.lastMovedAt && card.lastMovedAt < c.cardDoneBefore) { photos.delete(p.photoId); p.photoId = null; n++; }
      }
      return n;
    },
    removeFromPurchase: async (purchaseId: string) => { const p = rows.get(purchaseId); if (!p?.photoId) return false; photos.delete(p.photoId); p.photoId = null; return true; },
    purchaseIdByReference: async (reference: string) => byRef(reference)?.id ?? null,
    purchaseIdByCodeHash: async (hash: string) => cards.find((c) => `h:${c.code}` === hash)?.purchaseId ?? null,
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
  const uc = new GiftCardPurchaseUseCases(purchaseRepo as any, credit as any, pesapal as any, {
    hash: (c: string) => `h:${c}`, randomIndexes: () => Array.from({ length: 11 }, () => (idx++) % 32), referenceIndexes: () => Array.from({ length: 10 }, () => (idx++) % 32),
    normalizePhone: (p: string) => `+256${p.replace(/\D/g, '').slice(-9)}`,
  }, () => ({ ipnId: opts.ipnId === undefined ? 'ipn-1' : opts.ipnId, callbackUrl: 'https://api/cb', resultPageUrl: 'https://shop/gift-card/bought', dailyShopCapUgx: 1_000_000 }));
  const photoUc = new GiftCardPhotoUseCases(photoRepo as any, opts.processor === undefined ? fakePhotoProcessor : opts.processor, {
    hashCode: (c: string) => `h:${c}`, visitorKey: (raw: string) => `k:${raw}`,
  }, (event, detail) => { logs.push({ event, detail }); });
  const paidStatus = (ref: string, amount = 50_000) => ({ order_tracking_id: `T-${ref}`, merchant_reference: ref, amount, currency: 'UGX', status_code: 1, payment_status_description: 'Completed', confirmation_code: 'MTN123', payment_method: 'MTN' });
  const failedStatus = (ref: string) => ({ order_tracking_id: `T-${ref}`, merchant_reference: ref, amount: 50_000, currency: 'UGX', status_code: 2, payment_status_description: 'Failed' });
  return {
    uc, photoUc, rows, outbox, cards, photos, logs, pesapalCalls, byRef, paidStatus, failedStatus,
    setStatus: (s: any) => { pesapalStatus = s; },
    setPaidToday: (n: number) => { paidToday = n; },
    setPhotoClock: (f: () => Date) => { photoClock = f; },
    setExtraPhotosToday: (n: number) => { extraPhotosToday = n; },
  };
}
