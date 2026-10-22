import type { IGiftCardPhotoProcessor, IGiftCardPhotoRepository } from '../../ports/IGiftCardPhotoRepository';
import {
  GIFT_CARD_PHOTOS_PER_DAY, GIFT_CARD_PHOTOS_PER_VISITOR_PER_DAY, GIFT_CARD_PHOTO_MAX_BYTES, giftCardPhotoCutoffs, isGiftCardPhotoId,
  type GiftCardPhotoRefusal,
} from '../../../domain/credit/GiftCardPhoto';
import { isGiftCardPurchaseReference } from '../../../domain/credit/GiftCardPurchase';

/**
 * 0201: the optional photo on a gift card bought online, from upload to deletion (the rules: domain/credit/GiftCardPhoto.ts).
 *
 *  upload: checked against the daily ceilings, re-encoded (a square JPEG without metadata, so no location leaves the
 *          phone) and kept until a purchase claims it (the claim happens inside GiftCardPurchaseUseCases.start).
 *  image:  the bytes for the card that holds it; an unclaimed upload stops showing once it can no longer be claimed.
 *  remove: the person the card is for (by its code), the buyer and staff (by the purchase reference) can take it off.
 *  sweep:  deletes what the retention rules no longer keep; safe on both replicas (deletes are idempotent).
 */

/** The words the buyer sees for each refusal (the photo is optional: every message says the card still works). */
export const GIFT_CARD_PHOTO_REFUSAL_WORDS: Readonly<Record<GiftCardPhotoRefusal, string>> = Object.freeze({
  empty: 'Choose a photo.',
  // Too many bytes or too many pixels: either way a smaller photo works (the page's own cropper never sends either).
  too_large: 'That photo is too large to use. Choose a smaller one.',
  not_an_image: 'That file is not a photo we can use. Choose a JPEG or PNG photo.',
  too_small: 'That photo is too small to print on a card. Choose a bigger one.',
  too_detailed: 'That photo has too much detail to store. Try another one.',
  visitor_daily_limit: 'You have added the most photos we take from one phone in a day. The card works without one, or try again tomorrow.',
  shop_daily_limit: 'Photos are not available right now. The card works without one.',
  unavailable: 'Photos are not available right now. The card works without one.',
});

export type UploadGiftCardPhotoResult =
  | { ok: true; photoId: string }
  | { ok: false; reason: GiftCardPhotoRefusal; message: string };

export type RemoveGiftCardPhotoResult =
  | { ok: true; purchaseId: string; message: string }
  | { ok: false; reason: 'not_found'; message: string }
  | { ok: false; reason: 'no_photo'; purchaseId: string; message: string };

export interface GiftCardPhotoTools {
  /** The credit-code hash (the same one cards are looked up by). */
  hashCode(code: string): string;
  /** A peppered, one-way key for a visitor's rate-limit identity: never stored as an address. */
  visitorKey(raw: string): string;
}

export class GiftCardPhotoUseCases {
  constructor(
    private readonly repo: IGiftCardPhotoRepository,
    private readonly processor: IGiftCardPhotoProcessor | null,
    private readonly tools: GiftCardPhotoTools,
    private readonly log: (event: string, detail: Record<string, unknown>) => void = () => undefined,
  ) {}

  /**
   * `visitor`: the uploader's rate-limit identity (the HTTP layer's client key), or null for the shop's own server
   * calls, which count only against the shop-wide ceiling.
   */
  async upload(bytes: Buffer, visitor: string | null, now = new Date()): Promise<UploadGiftCardPhotoResult> {
    const refuse = (reason: GiftCardPhotoRefusal): UploadGiftCardPhotoResult => ({ ok: false, reason, message: GIFT_CARD_PHOTO_REFUSAL_WORDS[reason] });
    if (!this.processor) return refuse('unavailable');
    if (bytes.length === 0) return refuse('empty');
    if (bytes.length > GIFT_CARD_PHOTO_MAX_BYTES) return refuse('too_large');
    const { dayAgo } = giftCardPhotoCutoffs(now);
    // The cheap checks before the expensive work: counting is a query, processing is a decode.
    const uploaderKey = visitor ? this.tools.visitorKey(visitor) : null;
    if (uploaderKey && (await this.repo.countSince(dayAgo, uploaderKey)) >= GIFT_CARD_PHOTOS_PER_VISITOR_PER_DAY) return refuse('visitor_daily_limit');
    if ((await this.repo.countSince(dayAgo)) >= GIFT_CARD_PHOTOS_PER_DAY) {
      this.log('gift_card_photo_daily_cap_reached', { cap: GIFT_CARD_PHOTOS_PER_DAY });
      return refuse('shop_daily_limit');
    }
    const processed = await this.processor.process(bytes);
    if (!processed.ok) {
      if (processed.reason !== 'too_small') this.log('gift_card_photo_refused', { reason: processed.reason });
      return refuse(processed.reason);
    }
    return { ok: true, photoId: await this.repo.save(processed, uploaderKey) };
  }

  /** A photo's bytes, or null (not a photo id, unknown, removed, or an unclaimed upload past its claim window). */
  image(photoId: string, now = new Date()): Promise<Buffer | null> {
    if (!isGiftCardPhotoId(photoId)) return Promise.resolve(null);
    return this.repo.image(photoId.toLowerCase(), giftCardPhotoCutoffs(now).claimableAfter);
  }

  /** The buyer (their purchase page) and staff (Admin > Gift cards) find the purchase by its reference. */
  async removeByReference(reference: string): Promise<RemoveGiftCardPhotoResult> {
    const purchaseId = isGiftCardPurchaseReference(reference) ? await this.repo.purchaseIdByReference(reference) : null;
    if (!purchaseId) return { ok: false, reason: 'not_found', message: 'No gift card purchase has that reference.' };
    return this.removeFrom(purchaseId);
  }

  /** The person the card is for: holding the code is the proof (the same proof that spends it). */
  async removeByCode(code: string): Promise<RemoveGiftCardPhotoResult> {
    const purchaseId = await this.repo.purchaseIdByCodeHash(this.tools.hashCode(code));
    if (!purchaseId) return { ok: false, reason: 'not_found', message: 'That code is not right. Check each character, or call us.' };
    return this.removeFrom(purchaseId);
  }

  /** Delete what is no longer kept. Returns how many photos went. */
  async sweep(now = new Date()): Promise<number> {
    const removed = await this.repo.deleteStale(giftCardPhotoCutoffs(now));
    if (removed > 0) this.log('gift_card_photos_swept', { removed });
    return removed;
  }

  private async removeFrom(purchaseId: string): Promise<RemoveGiftCardPhotoResult> {
    if (!(await this.repo.removeFromPurchase(purchaseId))) return { ok: false, reason: 'no_photo', purchaseId, message: 'This card has no photo.' };
    this.log('gift_card_photo_removed', { purchaseId });
    return { ok: true, purchaseId, message: 'The photo is deleted. The card shows its occasion picture instead.' };
  }
}
