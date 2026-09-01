import { IAttributeRepository, PersistedAttribute } from '../../ports/IAttributeRepository';

export interface DefineAttributeInput {
  categoryId: string;
  name: string;
  slug?: string;
  unit?: string | null;
  isRequired?: boolean;
  displayOrder?: number;
}

export type DefineAttributeResult =
  | { ok: true; attribute: PersistedAttribute }
  | { ok: false; code: 'BAD_INPUT' | 'SLUG_TAKEN'; message: string };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export class DefineAttributeUseCase {
  constructor(private readonly attributes: IAttributeRepository) {}

  async execute(input: DefineAttributeInput): Promise<DefineAttributeResult> {
    const categoryId = (input.categoryId ?? '').trim();
    const name = (input.name ?? '').trim();
    const unit = (input.unit ?? '').trim() || null;
    const slug = (input.slug ?? '').trim() || slugify(name);

    if (!categoryId) return { ok: false, code: 'BAD_INPUT', message: 'categoryId is required.' };
    if (!name) return { ok: false, code: 'BAD_INPUT', message: 'name is required.' };
    if (!slug) return { ok: false, code: 'BAD_INPUT', message: 'A valid slug could not be derived.' };
    if (name.length > 100) return { ok: false, code: 'BAD_INPUT', message: 'name is too long (max 100).' };
    if (unit && unit.length > 20) return { ok: false, code: 'BAD_INPUT', message: 'unit is too long (max 20).' };

    const existing = await this.attributes.findBySlugInCategory(categoryId, slug);
    if (existing) {
      return { ok: false, code: 'SLUG_TAKEN', message: `An attribute with slug "${slug}" already exists in this category.` };
    }

    const attribute = await this.attributes.define({
      categoryId,
      slug,
      name,
      unit,
      isRequired: Boolean(input.isRequired),
      displayOrder: Number.isFinite(input.displayOrder) ? (input.displayOrder as number) : 0,
    });
    return { ok: true, attribute };
  }
}
