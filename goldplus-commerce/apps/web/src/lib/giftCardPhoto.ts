/**
 * 0201: a gift card photo's id (a random UUID the API hands back) and the shop-relative address it is shown from.
 * One check for every page that renders a photo, so an id that is not exactly a UUID never becomes a URL.
 */
export const PHOTO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isPhotoId = (id: unknown): id is string => typeof id === 'string' && PHOTO_ID.test(id);

export const giftCardPhotoUrl = (id: unknown): string | null => (isPhotoId(id) ? `/gift-card/photo/${id.toLowerCase()}` : null);
