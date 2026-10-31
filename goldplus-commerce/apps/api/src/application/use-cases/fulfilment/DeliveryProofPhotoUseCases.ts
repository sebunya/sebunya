import type { IGiftCardPhotoProcessor, ProcessedGiftCardPhoto } from '../../ports/IGiftCardPhotoRepository';
import { GIFT_CARD_PHOTO_MAX_BYTES, type GiftCardPhotoRefusal } from '../../../domain/credit/GiftCardPhoto';

/**
 * Photos as proof of delivery (0212, 2026-10-31). A delivery attempt's proof was a free-text reference and, from a
 * rider's WhatsApp, where they stood; a customer who said "it never came" left the shop with nothing to show. Staff
 * add up to three photos to the latest attempt of a task. The pipeline is the review photo's (0209): re-encoded JPEG,
 * whole frame kept, metadata (and so the phone's GPS tag) stripped. Staff-only, never shown to shoppers.
 */
export const DELIVERY_PROOF_PHOTOS_PER_ATTEMPT = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DELIVERY_PROOF_REFUSAL_WORDS: Readonly<Record<GiftCardPhotoRefusal | 'no_delivery' | 'attempt_full', string>> = Object.freeze({
  empty: 'Choose a photo.',
  too_large: 'That photo is too large. Choose a smaller one, or a screenshot of it.',
  not_an_image: 'That file is not a photo we can use. Choose a JPEG or PNG photo.',
  too_small: 'That photo is too small to show clearly. Choose a bigger one.',
  too_detailed: 'That photo has too much detail to store. Try another one.',
  visitor_daily_limit: 'Too many photos today.',
  shop_daily_limit: 'Too many photos today.',
  unavailable: 'Photos are not available right now. The delivery is recorded without one.',
  no_delivery: 'Record the delivery attempt first, then add its photo.',
  attempt_full: `This attempt already has ${DELIVERY_PROOF_PHOTOS_PER_ATTEMPT} photos.`,
});

export interface DeliveryProofPhotoRow { id: string; deliveryId: string; attempt: number; createdAt: Date }

export interface IDeliveryProofPhotoRepository {
  /** The task's most recent delivery attempt. */
  latestDelivery(taskId: string): Promise<{ id: string; orderId: string } | null>;
  countForDelivery(deliveryId: string): Promise<number>;
  save(input: { deliveryId: string; orderId: string; uploadedBy: string } & ProcessedGiftCardPhoto): Promise<string>;
  listForTask(taskId: string): Promise<DeliveryProofPhotoRow[]>;
  image(id: string): Promise<Buffer | null>;
}

export type UploadDeliveryProofResult =
  | { ok: true; photoId: string; deliveryId: string }
  | { ok: false; reason: keyof typeof DELIVERY_PROOF_REFUSAL_WORDS; message: string };

export class DeliveryProofPhotoUseCases {
  constructor(
    private readonly repo: IDeliveryProofPhotoRepository,
    private readonly processor: IGiftCardPhotoProcessor | null,
  ) {}

  async upload(input: { taskId: string; bytes: Buffer; actorId: string }): Promise<UploadDeliveryProofResult> {
    const refuse = (reason: keyof typeof DELIVERY_PROOF_REFUSAL_WORDS): UploadDeliveryProofResult => ({ ok: false, reason, message: DELIVERY_PROOF_REFUSAL_WORDS[reason] });
    if (!UUID.test(input.taskId)) return refuse('no_delivery');
    if (!this.processor) return refuse('unavailable');
    if (input.bytes.length === 0) return refuse('empty');
    if (input.bytes.length > GIFT_CARD_PHOTO_MAX_BYTES) return refuse('too_large');
    const delivery = await this.repo.latestDelivery(input.taskId.toLowerCase());
    if (!delivery) return refuse('no_delivery');
    if ((await this.repo.countForDelivery(delivery.id)) >= DELIVERY_PROOF_PHOTOS_PER_ATTEMPT) return refuse('attempt_full');
    const processed = await this.processor.process(input.bytes, { whole: true });
    if (!processed.ok) return refuse(processed.reason);
    const photoId = await this.repo.save({ deliveryId: delivery.id, orderId: delivery.orderId, uploadedBy: input.actorId, image: processed.image, width: processed.width, height: processed.height });
    return { ok: true, photoId, deliveryId: delivery.id };
  }

  list(taskId: string): Promise<DeliveryProofPhotoRow[]> {
    return UUID.test(taskId) ? this.repo.listForTask(taskId.toLowerCase()) : Promise.resolve([]);
  }

  image(photoId: string): Promise<Buffer | null> {
    return UUID.test(photoId) ? this.repo.image(photoId.toLowerCase()) : Promise.resolve(null);
  }
}
