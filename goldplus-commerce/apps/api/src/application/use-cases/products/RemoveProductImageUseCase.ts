import { IProductImageRepository } from '../../ports/IProductImageRepository';

export type RemoveProductImageResult =
  | { ok: true; productId: string }
  | { ok: false; code: 'NOT_FOUND' };

export class RemoveProductImageUseCase {
  constructor(private readonly images: IProductImageRepository) {}

  async execute(imageId: string): Promise<RemoveProductImageResult> {
    const trimmed = (imageId ?? '').trim();
    if (!trimmed) return { ok: false, code: 'NOT_FOUND' };
    const removed = await this.images.remove(trimmed);
    return removed ? { ok: true, productId: removed.removedProductId } : { ok: false, code: 'NOT_FOUND' };
  }
}
