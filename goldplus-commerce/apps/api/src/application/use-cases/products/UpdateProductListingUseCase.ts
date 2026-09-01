import { IAttributeRepository } from '../../ports/IAttributeRepository';
import { DefineAttributeUseCase } from './DefineAttributeUseCase';

/**
 * The listing is what a shopper (and Google) reads: title, descriptions and
 * the specifications. One use case owns all of it so the admin page, the
 * supplier-spec import and any future importer write it the same way.
 *
 * Specifications are stored as category attributes with per-product values;
 * an attribute that does not exist in the product's category yet is defined
 * on the way through. `isVerified` records that the value was checked against
 * the maker's own specification (the panel on the supplier photo, the box) —
 * only verified values reach structured data and the feed.
 */
export interface ListingSpecInput { name: string; value: string; unit?: string | null; isVerified?: boolean }
export interface UpdateProductListingInput {
  productId: string;
  name?: string;
  shortDescription?: string;
  longDescription?: string;
  isFeedEligible?: boolean;
  specs?: ListingSpecInput[];
}
export interface ListingTextPatch { name?: string; shortDescription?: string; longDescription?: string }
export interface ProductListingWriter {
  findListingTarget(productId: string): Promise<{ id: string; categoryId: string } | null>;
  updateListingText(productId: string, patch: ListingTextPatch): Promise<void>;
  setFeedEligibility(productId: string, eligible: boolean): Promise<void>;
}
export type UpdateProductListingResult =
  | { ok: true; changed: { text: string[]; specs: number; feed: boolean } }
  | { ok: false; code: 'NOT_FOUND' | 'BAD_INPUT'; message: string };

export const LISTING_LIMITS = { name: 150, shortDescription: 500, longDescription: 5000, specName: 100, specValue: 255 } as const;

export class UpdateProductListingUseCase {
  constructor(private readonly products: ProductListingWriter, private readonly attributes: IAttributeRepository) {}

  async execute(input: UpdateProductListingInput): Promise<UpdateProductListingResult> {
    const productId = (input.productId ?? '').trim();
    if (!productId) return { ok: false, code: 'BAD_INPUT', message: 'productId is required.' };
    const target = await this.products.findListingTarget(productId);
    if (!target) return { ok: false, code: 'NOT_FOUND', message: 'Product not found.' };

    const patch: ListingTextPatch = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name.length < 3) return { ok: false, code: 'BAD_INPUT', message: 'The title needs at least 3 characters.' };
      if (name.length > LISTING_LIMITS.name) return { ok: false, code: 'BAD_INPUT', message: `The title is over ${LISTING_LIMITS.name} characters — Google truncates titles beyond that.` };
      patch.name = name;
    }
    if (input.shortDescription !== undefined) {
      const s = input.shortDescription.trim();
      if (s.length > LISTING_LIMITS.shortDescription) return { ok: false, code: 'BAD_INPUT', message: `The short description is over ${LISTING_LIMITS.shortDescription} characters.` };
      patch.shortDescription = s;
    }
    if (input.longDescription !== undefined) {
      const l = input.longDescription.trim();
      if (l.length > LISTING_LIMITS.longDescription) return { ok: false, code: 'BAD_INPUT', message: `The long description is over ${LISTING_LIMITS.longDescription} characters.` };
      patch.longDescription = l;
    }
    const specs = (input.specs ?? []).map((s) => ({ name: (s.name ?? '').trim(), value: (s.value ?? '').trim(), unit: (s.unit ?? '').trim() || null, isVerified: s.isVerified === true }))
      .filter((s) => s.name.length > 0 || s.value.length > 0);
    for (const s of specs) {
      if (!s.name || !s.value) return { ok: false, code: 'BAD_INPUT', message: 'Every specification needs both a name and a value.' };
      if (s.name.length > LISTING_LIMITS.specName) return { ok: false, code: 'BAD_INPUT', message: `Specification name "${s.name.slice(0, 20)}…" is too long (max ${LISTING_LIMITS.specName}).` };
      if (s.value.length > LISTING_LIMITS.specValue) return { ok: false, code: 'BAD_INPUT', message: `The value for "${s.name}" is too long (max ${LISTING_LIMITS.specValue}).` };
    }

    // Validation done — now write, text first.
    if (Object.keys(patch).length > 0) await this.products.updateListingText(productId, patch);

    const define = new DefineAttributeUseCase(this.attributes);
    let written = 0;
    for (const [order, s] of specs.entries()) {
      const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
      let attribute = await this.attributes.findBySlugInCategory(target.categoryId, slug);
      if (!attribute) {
        const defined = await define.execute({ categoryId: target.categoryId, name: s.name, slug, unit: s.unit, displayOrder: order });
        if (!defined.ok) return { ok: false, code: 'BAD_INPUT', message: defined.message };
        attribute = defined.attribute;
      }
      await this.attributes.setValue({ productId, attributeId: attribute.id, value: s.value, isVerified: s.isVerified });
      written += 1;
    }

    let feed = false;
    if (typeof input.isFeedEligible === 'boolean') { await this.products.setFeedEligibility(productId, input.isFeedEligible); feed = true; }

    return { ok: true, changed: { text: Object.keys(patch), specs: written, feed } };
  }
}
