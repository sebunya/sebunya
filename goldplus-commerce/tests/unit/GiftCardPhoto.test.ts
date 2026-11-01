import { describe, expect, it } from 'vitest';
import {
  GIFT_CARD_PHOTOS_PER_DAY, GIFT_CARD_PHOTOS_PER_VISITOR_PER_DAY, GIFT_CARD_PHOTO_RETENTION_DAYS, giftCardPhotoCutoffs, isGiftCardPhotoId,
} from '../../apps/api/src/domain/credit/GiftCardPhoto';
import { checkGiftCardPurchase } from '../../apps/api/src/domain/credit/GiftCardPurchase';
import { GIFT_CARD_PHOTO_REFUSAL_WORDS } from '../../apps/api/src/application/use-cases/credit/GiftCardPhotoUseCases';
import { classifyPublicEndpoint } from '../../apps/api/src/domain/security/PublicEndpointPolicy';
import { NOW, giftCardWorld, giftForm } from './support/giftCardWorld';

const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

describe('gift card photo rules (domain, 0201)', () => {
  it('every cut-off comes from one clock, and a photo that can still be claimed is never swept', () => {
    const c = giftCardPhotoCutoffs(NOW);
    const d = GIFT_CARD_PHOTO_RETENTION_DAYS;
    expect(NOW.getTime() - c.dayAgo.getTime()).toBe(DAY);
    expect(NOW.getTime() - c.claimableAfter.getTime()).toBe(d.claim * DAY);
    expect(NOW.getTime() - c.unclaimedBefore.getTime()).toBe(d.unclaimed * DAY);
    expect(NOW.getTime() - c.purchaseEndedBefore.getTime()).toBe(d.endedPurchase * DAY);
    expect(NOW.getTime() - c.cardDoneBefore.getTime()).toBe(d.doneCard * DAY);
    expect(d.unclaimed).toBeGreaterThan(d.claim);
    expect(c.unclaimedBefore.getTime()).toBeLessThan(c.claimableAfter.getTime());
  });

  it('a photo id is exactly a UUID: nothing else is ever looked up or turned into a link', () => {
    expect(isGiftCardPhotoId('0f8fad5b-d9cb-469f-a165-70867728950e')).toBe(true);
    for (const bad of ['------------------------------------', '../etc/passwd', '0f8fad5b-d9cb-469f-a165-70867728950', '', null, 42]) expect(isGiftCardPhotoId(bad)).toBe(false);
    expect(checkGiftCardPurchase(giftForm({ photoId: '../etc/passwd' }), NOW)).toMatchObject({ ok: false, errors: { photo: expect.any(String) } });
  });

  it('uploads and removals are counted on the right abuse budgets', () => {
    expect(classifyPublicEndpoint('POST', '/commerce/gift-cards/photos')).toBe('issue-report');
    expect(classifyPublicEndpoint('POST', '/commerce/gift-cards/photo/remove-by-code')).toBe('order-lookup');
    expect(classifyPublicEndpoint('POST', '/commerce/gift-cards/purchase/GC-0123456789/remove-photo')).toBe('order-lookup');
  });
});

describe('adding a photo (0201)', () => {
  it('is re-encoded, put on exactly one buyer’s purchase, and shown back on the buyer’s status', async () => {
    const w = giftCardWorld();
    const up = await w.photoUc.upload(Buffer.from('camera bytes'), 'visitor-a', NOW);
    if (!up.ok) throw new Error('upload');
    expect(String(await w.photoUc.image(up.photoId, NOW))).toBe('jpeg:camera bytes'); // the stored copy is the re-encoded one
    const r = await w.uc.start(giftForm({ photoId: up.photoId }), NOW);
    if (!r.ok) throw new Error('start');
    expect(w.byRef(r.reference)!.photoId).toBe(up.photoId);
    w.setStatus(w.paidStatus(r.reference));
    expect((await w.uc.publicStatus(r.reference, NOW))!.photoId).toBe(up.photoId);
    // Another buyer cannot put it on their card.
    const other = await w.uc.start(giftForm({ photoId: up.photoId, buyerPhone: '0701 999888' }), NOW);
    expect(other).toMatchObject({ ok: false, code: 'INVALID', errors: { photo: expect.stringContaining('Add it again') } });
  });

  it('trying again after a failed payment keeps the photo: the new purchase gets its own copy, the old keeps its own', async () => {
    const w = giftCardWorld();
    const up = await w.photoUc.upload(Buffer.from('mum'), 'visitor-a', NOW);
    if (!up.ok) throw new Error('upload');
    const first = await w.uc.start(giftForm({ photoId: up.photoId }), NOW);
    if (!first.ok) throw new Error('start');
    w.setStatus(w.failedStatus(first.reference));
    await w.uc.settle({ trackingId: `T-${first.reference}`, reference: first.reference, source: 'ipn' }, NOW);
    expect(w.byRef(first.reference)!.status).toBe('failed');
    // The same phone, typed differently, comes back with the draft's photo.
    const retry = await w.uc.start(giftForm({ photoId: up.photoId, buyerPhone: '+256 701 333 444' }), NOW);
    if (!retry.ok) throw new Error(`retry refused: ${JSON.stringify(retry)}`);
    const copied = w.byRef(retry.reference)!.photoId!;
    expect(copied).not.toBe(up.photoId);
    expect(String(await w.photoUc.image(copied, NOW))).toBe('jpeg:mum');
    expect(w.byRef(first.reference)!.photoId).toBe(up.photoId); // should the first be paid late, its card keeps the photo
  });

  it('each refusal has its reason and words, and every one says the card still works where it is the shop’s doing', async () => {
    const w = giftCardWorld();
    const refused = async (bytes: Buffer) => { const r = await w.photoUc.upload(bytes, null, NOW); if (r.ok) throw new Error('accepted'); return r; };
    expect(await refused(Buffer.alloc(0))).toMatchObject({ reason: 'empty' });
    expect(await refused(Buffer.alloc(6 * 1024 * 1024 + 1))).toMatchObject({ reason: 'too_large' });
    expect(await refused(Buffer.from('huge'))).toMatchObject({ reason: 'too_large' });
    expect(await refused(Buffer.from('not a photo'))).toMatchObject({ reason: 'not_an_image', message: expect.stringContaining('JPEG or PNG') });
    expect(await refused(Buffer.from('tiny'))).toMatchObject({ reason: 'too_small', message: expect.stringContaining('too small') });
    expect(await refused(Buffer.from('no sharp'))).toMatchObject({ reason: 'unavailable', message: expect.stringContaining('The card works without one') });
    for (const reason of ['shop_daily_limit', 'unavailable', 'visitor_daily_limit'] as const) expect(GIFT_CARD_PHOTO_REFUSAL_WORDS[reason]).toContain('The card works without one');
    // No image library at all (a broken build): photos are off, nothing else.
    const off = giftCardWorld({ processor: null });
    expect(await off.photoUc.upload(Buffer.from('a'), null, NOW)).toMatchObject({ ok: false, reason: 'unavailable' });
    expect((await off.uc.start(giftForm(), NOW)).ok).toBe(true);
  });

  it('20 photos a day per visitor (counted by a hashed key), 400 a day for the shop; the next day it starts again', async () => {
    const w = giftCardWorld();
    for (let i = 0; i < GIFT_CARD_PHOTOS_PER_VISITOR_PER_DAY; i++) expect((await w.photoUc.upload(Buffer.from(`p${i}`), 'visitor-a', NOW)).ok).toBe(true);
    expect(await w.photoUc.upload(Buffer.from('one more'), 'visitor-a', NOW)).toMatchObject({ ok: false, reason: 'visitor_daily_limit', message: expect.stringContaining('one phone in a day') });
    expect((await w.photoUc.upload(Buffer.from('other'), 'visitor-b', NOW)).ok).toBe(true);
    expect([...w.photos.values()].every((ph) => ph.uploaderKey === null || ph.uploaderKey.startsWith('k:'))).toBe(true); // never the raw identity
    w.setPhotoClock(() => at(1.01));
    expect((await w.photoUc.upload(Buffer.from('tomorrow'), 'visitor-a', at(1.01))).ok).toBe(true);
    const shop = giftCardWorld();
    shop.setExtraPhotosToday(GIFT_CARD_PHOTOS_PER_DAY - 1);
    expect((await shop.photoUc.upload(Buffer.from('a'), null, NOW)).ok).toBe(true);
    expect(await shop.photoUc.upload(Buffer.from('b'), null, NOW)).toMatchObject({ ok: false, reason: 'shop_daily_limit' });
    expect(shop.logs.some((l) => l.event === 'gift_card_photo_daily_cap_reached')).toBe(true);
  });
});

describe('showing, removing and deleting photos (0201)', () => {
  it('an unclaimed upload stops showing when it can no longer be put on a card, so a kept draft notices', async () => {
    const w = giftCardWorld();
    w.setPhotoClock(() => new Date(NOW.getTime() - GIFT_CARD_PHOTO_RETENTION_DAYS.claim * DAY - 60_000));
    const old = await w.photoUc.upload(Buffer.from('old'), null, NOW);
    w.setPhotoClock(() => NOW);
    const fresh = await w.photoUc.upload(Buffer.from('fresh'), null, NOW);
    if (!old.ok || !fresh.ok) throw new Error('upload');
    expect(await w.photoUc.image(old.photoId, NOW)).toBeNull();
    expect(await w.photoUc.image(fresh.photoId, NOW)).not.toBeNull();
    expect(await w.photoUc.image('../etc/passwd', NOW)).toBeNull();
    // …and the claim refuses it with the same rule (the purchase cannot carry what the page no longer shows).
    expect(await w.uc.start(giftForm({ photoId: old.photoId }), NOW)).toMatchObject({ ok: false, errors: { photo: expect.any(String) } });
  });

  it('the person it is for removes it with the card’s code; the buyer and staff with the reference; a second time says so', async () => {
    const w = giftCardWorld();
    const up = await w.photoUc.upload(Buffer.from('a'), null, NOW);
    if (!up.ok) throw new Error('upload');
    const r = await w.uc.start(giftForm({ photoId: up.photoId }), NOW);
    if (!r.ok) throw new Error('start');
    w.setStatus(w.paidStatus(r.reference));
    await w.uc.settle({ trackingId: `T-${r.reference}`, reference: r.reference, source: 'ipn' }, NOW);
    const code = w.cards[0].code!;
    expect(await w.photoUc.removeByCode('GPGC-AAAA-BBBB-CCCC')).toMatchObject({ ok: false, reason: 'not_found' });
    expect(w.byRef(r.reference)!.photoId).toBe(up.photoId);
    expect(await w.photoUc.removeByCode(code)).toMatchObject({ ok: true, purchaseId: w.byRef(r.reference)!.id });
    expect(w.byRef(r.reference)!.photoId).toBeNull();
    expect(w.photos.has(up.photoId)).toBe(false);
    expect(await w.photoUc.removeByCode(code)).toMatchObject({ ok: false, reason: 'no_photo', message: 'This card has no photo.' });
    expect(await w.photoUc.removeByReference(r.reference)).toMatchObject({ ok: false, reason: 'no_photo' });
    expect(await w.photoUc.removeByReference('GC-NOTAREAL00')).toMatchObject({ ok: false, reason: 'not_found' });
    expect(w.logs.filter((l) => l.event === 'gift_card_photo_removed')).toHaveLength(1);
  });

  it('the sweep deletes: an unclaimed upload after 3 days, an unpaid purchase’s photo 30 days after it ended, a used-up card’s after 90', async () => {
    const w = giftCardWorld();
    const stray = await w.photoUc.upload(Buffer.from('stray'), null, NOW);
    const unpaid = await w.photoUc.upload(Buffer.from('unpaid'), null, NOW);
    const spent = await w.photoUc.upload(Buffer.from('spent'), null, NOW);
    if (!stray.ok || !unpaid.ok || !spent.ok) throw new Error('upload');
    const r1 = await w.uc.start(giftForm({ photoId: unpaid.photoId }), NOW);
    const r2 = await w.uc.start(giftForm({ photoId: spent.photoId, buyerPhone: '0701 999888' }), NOW);
    if (!r1.ok || !r2.ok) throw new Error('start');
    Object.assign(w.byRef(r1.reference)!, { status: 'abandoned', endedAt: NOW });
    w.setStatus(w.paidStatus(r2.reference));
    await w.uc.settle({ trackingId: `T-${r2.reference}`, reference: r2.reference, source: 'ipn' }, NOW);
    Object.assign(w.cards[0], { balance: 0, lastMovedAt: NOW });

    await w.photoUc.sweep(at(2.9));
    expect([w.photos.has(stray.photoId), w.byRef(r1.reference)!.photoId, w.byRef(r2.reference)!.photoId]).toEqual([true, unpaid.photoId, spent.photoId]);
    await w.photoUc.sweep(at(3.1));
    expect(w.photos.has(stray.photoId)).toBe(false);
    await w.photoUc.sweep(at(29));
    expect(w.byRef(r1.reference)!.photoId).toBe(unpaid.photoId);
    await w.photoUc.sweep(at(31));
    expect(w.byRef(r1.reference)!.photoId).toBeNull();
    await w.photoUc.sweep(at(89));
    expect(w.byRef(r2.reference)!.photoId).toBe(spent.photoId);
    await w.photoUc.sweep(at(91));
    expect(w.byRef(r2.reference)!.photoId).toBeNull();
    expect(w.logs.some((l) => l.event === 'gift_card_photos_swept')).toBe(true);
  });
});
