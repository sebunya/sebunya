import type { IGiftCardPhotoProcessor, ProcessedGiftCardPhoto } from '../../ports/IGiftCardPhotoRepository';
import { GIFT_CARD_PHOTO_MAX_BYTES, type GiftCardPhotoRefusal } from '../../../domain/credit/GiftCardPhoto';

/**
 * Photos on customer reviews (0209, gap analysis #10). The picture pipeline is the gift card's (0201): the same
 * processor makes a square JPEG without metadata, the same ceilings stop a script filling the disk. What differs is
 * ownership: a photo is uploaded while the buyer writes the review and attached when the review is saved; only a
 * PUBLISHED review's photos are shown to shoppers, so moderation covers the pictures as it covers the words.
 */
/** A reviewer's words: the gift card's said a photo was "too small to print on a card" and that "the card works without one". */
export const REVIEW_PHOTO_REFUSAL_WORDS: Readonly<Record<GiftCardPhotoRefusal, string>> = Object.freeze({
  empty: 'Choose a photo.',
  too_large: 'That photo is too large to use. Choose a smaller one, or a screenshot of it.',
  not_an_image: 'That file is not a photo we can use. Choose a JPEG or PNG photo.',
  too_small: 'That photo is too small to show clearly. Choose a bigger one.',
  too_detailed: 'That photo has too much detail to store. Try another one.',
  visitor_daily_limit: 'You have added the most photos we take in a day. Your review is saved without it.',
  shop_daily_limit: 'Photos are not available right now. Your review is saved without it.',
  unavailable: 'Photos are not available right now. Your review is saved without it.',
});

export const REVIEW_PHOTOS_PER_REVIEW = 3;
export const REVIEW_PHOTOS_PER_VISITOR_PER_DAY = 12;
export const REVIEW_PHOTOS_PER_DAY = 300;
/** An upload can be attached this long after it was made; unattached uploads older than this are deleted. */
export const REVIEW_PHOTO_CLAIM_DAYS = 2;
const DAY_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IReviewPhotoRepository {
  save(photo: ProcessedGiftCardPhoto, uploaderKey: string | null): Promise<string>;
  countSince(since: Date, uploaderKey?: string): Promise<number>;
  /** Attach up to `max` of these ids that are unattached uploads made after `claimableAfter`; returns how many were attached. */
  attach(reviewId: string, photoIds: string[], claimableAfter: Date, now: Date, max: number): Promise<number>;
  /** The bytes, only when the review is published (or `includeUnpublished`, for staff). */
  image(id: string, includeUnpublished: boolean): Promise<Buffer | null>;
  deleteUnattachedBefore(before: Date): Promise<number>;
}

export type UploadReviewPhotoResult = { ok: true; photoId: string } | { ok: false; reason: GiftCardPhotoRefusal; message: string };

export class ReviewPhotoUseCases {
  constructor(
    private readonly repo: IReviewPhotoRepository,
    private readonly processor: IGiftCardPhotoProcessor | null,
    private readonly visitorKey: (raw: string) => string,
    private readonly log: (event: string, detail: Record<string, unknown>) => void = () => undefined,
  ) {}

  async upload(bytes: Buffer, visitor: string | null, now = new Date()): Promise<UploadReviewPhotoResult> {
    const refuse = (reason: GiftCardPhotoRefusal): UploadReviewPhotoResult => ({ ok: false, reason, message: REVIEW_PHOTO_REFUSAL_WORDS[reason] });
    if (!this.processor) return refuse('unavailable');
    if (bytes.length === 0) return refuse('empty');
    if (bytes.length > GIFT_CARD_PHOTO_MAX_BYTES) return refuse('too_large');
    const dayAgo = new Date(now.getTime() - DAY_MS);
    const uploaderKey = visitor ? this.visitorKey(visitor) : null;
    if (uploaderKey && (await this.repo.countSince(dayAgo, uploaderKey)) >= REVIEW_PHOTOS_PER_VISITOR_PER_DAY) return refuse('visitor_daily_limit');
    if ((await this.repo.countSince(dayAgo)) >= REVIEW_PHOTOS_PER_DAY) { this.log('review_photo_daily_cap_reached', { cap: REVIEW_PHOTOS_PER_DAY }); return refuse('shop_daily_limit'); }
    const processed = await this.processor.process(bytes);
    if (!processed.ok) { if (processed.reason !== 'too_small') this.log('review_photo_refused', { reason: processed.reason }); return refuse(processed.reason); }
    return { ok: true, photoId: await this.repo.save(processed, uploaderKey) };
  }

  /** Well-formed ids only; the store attaches at most three of those still unattached and recent. */
  async attach(reviewId: string, photoIds: unknown, now = new Date()): Promise<number> {
    const ids = [...new Set((Array.isArray(photoIds) ? photoIds : []).filter((v): v is string => typeof v === 'string' && UUID.test(v)).map((v) => v.toLowerCase()))].slice(0, 10);
    if (!ids.length) return 0;
    return this.repo.attach(reviewId, ids, new Date(now.getTime() - REVIEW_PHOTO_CLAIM_DAYS * DAY_MS), now, REVIEW_PHOTOS_PER_REVIEW);
  }

  image(photoId: string, includeUnpublished = false): Promise<Buffer | null> {
    if (!UUID.test(photoId)) return Promise.resolve(null);
    return this.repo.image(photoId.toLowerCase(), includeUnpublished);
  }

  async sweep(now = new Date()): Promise<number> {
    const removed = await this.repo.deleteUnattachedBefore(new Date(now.getTime() - REVIEW_PHOTO_CLAIM_DAYS * DAY_MS));
    if (removed > 0) this.log('review_photos_swept', { removed });
    return removed;
  }
}
