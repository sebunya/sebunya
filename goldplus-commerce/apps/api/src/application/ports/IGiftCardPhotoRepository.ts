import type { GiftCardPhotoCutoffs, GiftCardPhotoRefusal } from '../../domain/credit/GiftCardPhoto';

/** 0201: a photo ready to keep: a square JPEG with no metadata. */
export interface ProcessedGiftCardPhoto {
  image: Buffer;
  width: number;
  height: number;
}

/**
 * 0201: turns whatever a phone sent into a safe square JPEG, or says why not. A refusal is a value, not an exception:
 * only a fault (a bug, the machine) throws.
 */
export interface IGiftCardPhotoProcessor {
  /** `whole`: keep the photo's own frame (a review photo) instead of centring it to a square (a card photo). */
  process(input: Buffer, options?: { whole?: boolean }): Promise<
    | ({ ok: true } & ProcessedGiftCardPhoto)
    | { ok: false; reason: Extract<GiftCardPhotoRefusal, 'not_an_image' | 'too_small' | 'too_large' | 'too_detailed' | 'unavailable'> }
  >;
}

/** 0201: where gift card photos are kept, and how they leave. */
export interface IGiftCardPhotoRepository {
  /** Keep a processed photo until a purchase claims it. `uploaderKey`: the visitor's peppered key, or null. Returns its id. */
  save(photo: ProcessedGiftCardPhoto, uploaderKey: string | null): Promise<string>;
  /** The photo's JPEG bytes, or null: unknown, removed, or an unclaimed upload made before `claimableAfter`. */
  image(id: string, claimableAfter: Date): Promise<Buffer | null>;
  /** Uploads since `since`, claimed or not: across the shop, or by one uploader. */
  countSince(since: Date, uploaderKey?: string): Promise<number>;
  /**
   * Delete what is no longer kept (GiftCardPhoto.ts): unclaimed uploads made before `unclaimedBefore`; photos of
   * purchases that ended unpaid or refunded before `purchaseEndedBefore`; photos of cards used up, cancelled or
   * expired before `cardDoneBefore`. Returns how many photos went.
   */
  deleteStale(cutoffs: Pick<GiftCardPhotoCutoffs, 'unclaimedBefore' | 'purchaseEndedBefore' | 'cardDoneBefore'>): Promise<number>;
  /** Take the photo off this purchase and delete it, under the purchase's row lock. False: it had none. */
  removeFromPurchase(purchaseId: string): Promise<boolean>;
  /** The purchase with this reference (the buyer's and staff's way in). */
  purchaseIdByReference(reference: string): Promise<string | null>;
  /** The purchase whose issued card has this code hash (the holder of the code is the person it is for). */
  purchaseIdByCodeHash(codeHash: string): Promise<string | null>;
}
