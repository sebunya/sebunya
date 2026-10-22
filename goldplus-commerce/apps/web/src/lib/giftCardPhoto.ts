import { isGiftCardPhotoId } from '@goldplus/shared/src/gift-cards/giftPhoto';

/**
 * 0201: a gift card photo's id (a random UUID the API hands back) and the shop-relative address it is shown from.
 * One check for every page that renders a photo (the API's own check), so an id that is not exactly a UUID never
 * becomes a URL.
 */
export const isPhotoId = isGiftCardPhotoId;

export const giftCardPhotoUrl = (id: unknown): string | null => (isPhotoId(id) ? `/gift-card/photo/${id.toLowerCase()}` : null);
