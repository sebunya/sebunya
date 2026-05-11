import { IProductImageRepository, PersistedProductImage } from '../../ports/IProductImageRepository';

export interface AddProductImageByUrlInput {
  productId: string;
  url: string;
  altText: string | null;
  makePrimary: boolean;
}

export type AddProductImageByUrlResult =
  | { ok: true; image: PersistedProductImage }
  | { ok: false; code: 'BAD_INPUT'; message: string };

function isSafeImageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (!parsed.hostname) return false;
  return true;
}

export class AddProductImageByUrlUseCase {
  constructor(private readonly images: IProductImageRepository) {}

  async execute(input: AddProductImageByUrlInput): Promise<AddProductImageByUrlResult> {
    const productId = (input.productId ?? '').trim();
    const url = (input.url ?? '').trim();
    const altText = (input.altText ?? '').trim() || null;

    if (!productId) return { ok: false, code: 'BAD_INPUT', message: 'productId is required.' };
    if (!url) return { ok: false, code: 'BAD_INPUT', message: 'url is required.' };
    if (!isSafeImageUrl(url)) {
      return { ok: false, code: 'BAD_INPUT', message: 'url must be an https:// URL.' };
    }
    if (url.length > 2000) return { ok: false, code: 'BAD_INPUT', message: 'url is too long (max 2000).' };
    if (altText && altText.length > 255) {
      return { ok: false, code: 'BAD_INPUT', message: 'altText is too long (max 255).' };
    }

    const image = await this.images.add({
      productId,
      url,
      altText,
      makePrimary: Boolean(input.makePrimary),
    });
    return { ok: true, image };
  }
}
