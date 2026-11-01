/**
 * The photo on a gift card (0201): the sizes and the id shape the phone's cropper and the API both depend on, in one
 * place, so the cropper can never send what the API refuses. The rest of the photo rules (retention, ceilings, the
 * decode limit) are the API's alone: apps/api/src/domain/credit/GiftCardPhoto.ts.
 *
 * Pure and dependency-free: the storefront imports this file directly (not the package index), so nothing else from
 * the shared package reaches the browser bundle.
 */

/** What a phone may send (it crops to a square first; this is only the ceiling for the request body). */
export const GIFT_CARD_PHOTO_MAX_BYTES = 6 * 1024 * 1024;
/** The photo is a square of at most this many pixels a side: the cropper sends it, the API stores it. */
export const GIFT_CARD_PHOTO_MAX_SIDE = 1080;
/** …and never less than this (smaller would print blurred): the cropper scales up to it, the API refuses below it. */
export const GIFT_CARD_PHOTO_MIN_SIDE = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A photo id is the random UUID the database gave it; anything else is never looked up or made into an address. */
export function isGiftCardPhotoId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
