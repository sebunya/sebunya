/**
 * 0201: the optional photo on a gift card bought online. Every rule about it lives here, so the use cases, the
 * repository, the privacy policy (/privacy, "Gift cards: notes and photos") and the docs read one source. The sizes
 * and the id shape are shared with the phone's cropper (@goldplus/shared, gift-cards/giftPhoto) and re-exported here.
 *
 * Pure: no database, no clock of its own (every cut-off is computed from the `now` the caller passes).
 */
import { GIFT_CARD_PHOTO_MAX_BYTES, GIFT_CARD_PHOTO_MAX_SIDE, GIFT_CARD_PHOTO_MIN_SIDE, isGiftCardPhotoId } from '@goldplus/shared';

export { GIFT_CARD_PHOTO_MAX_BYTES, GIFT_CARD_PHOTO_MAX_SIDE, GIFT_CARD_PHOTO_MIN_SIDE, isGiftCardPhotoId };

/**
 * How long a photo is kept, in days. The privacy policy states these numbers in words and a unit test holds the two
 * together: change both or neither.
 *  - claim: an upload can be put on a purchase this long after it was uploaded;
 *  - unclaimed: an upload nothing claimed is deleted after this long (always longer than `claim`, so a photo that can
 *    still be claimed is never swept from under a buyer);
 *  - endedPurchase: the photo of a purchase that ended unpaid or refunded, after it ended (late payments land inside it);
 *  - doneCard: the photo of a card used up, cancelled or expired, after its last movement.
 */
export const GIFT_CARD_PHOTO_RETENTION_DAYS = Object.freeze({ claim: 2, unclaimed: 3, endedPurchase: 30, doneCard: 90 });

/**
 * Photos accepted across the whole shop in 24 hours. The upload needs no account, so without a ceiling one script could
 * fill the server's disk; real gift cards with photos are a handful a day, and above this the card still sells without one.
 */
export const GIFT_CARD_PHOTOS_PER_DAY = 400;
/** …and from one visitor in 24 hours, so one person cannot use up the shop's allowance and shut real buyers out. */
export const GIFT_CARD_PHOTOS_PER_VISITOR_PER_DAY = 20;

/**
 * The largest picture the API will decode. Decoding costs memory outside the JavaScript heap (about 3 bytes a pixel,
 * before any working copies) in an API container limited to 512 MB, so a 40-megapixel image sent on purpose could
 * take a replica down. The shop's own cropper sends at most 1080 x 1080; 2048 x 2048 leaves room for any honest client.
 */
export const GIFT_CARD_PHOTO_MAX_INPUT_PIXELS = 2048 * 2048;
/** The column holds 1,500,000 bytes; a very detailed photo steps down in quality until it fits under this. */
export const GIFT_CARD_PHOTO_STORED_MAX_BYTES = 1_400_000;

/** Why a photo was not taken. Each has its own words for the buyer and its own HTTP status. */
export type GiftCardPhotoRefusal =
  | 'empty' | 'too_large' | 'not_an_image' | 'too_small' | 'too_detailed'
  | 'visitor_daily_limit' | 'shop_daily_limit' | 'unavailable';

const DAY_MS = 86_400_000;

/** Every moment the photo rules turn on, from one clock. */
export interface GiftCardPhotoCutoffs {
  /** Uploads since then count towards today's ceilings. */
  dayAgo: Date;
  /** An unclaimed upload made after this can still be put on a purchase (and is still shown). */
  claimableAfter: Date;
  /** An unclaimed upload made before this is deleted. */
  unclaimedBefore: Date;
  /** The photo of a purchase that ended unpaid or refunded before this is deleted. */
  purchaseEndedBefore: Date;
  /** The photo of a card used up, cancelled or expired before this is deleted. */
  cardDoneBefore: Date;
}

export function giftCardPhotoCutoffs(now: Date): GiftCardPhotoCutoffs {
  const before = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const d = GIFT_CARD_PHOTO_RETENTION_DAYS;
  return {
    dayAgo: before(1),
    claimableAfter: before(d.claim),
    unclaimedBefore: before(d.unclaimed),
    purchaseEndedBefore: before(d.endedPurchase),
    cardDoneBefore: before(d.doneCard),
  };
}
