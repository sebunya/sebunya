import { DEFAULT_TAXONOMY, type Taxonomy, type TaxonomyCategory, type TaxonomySubcategory } from '@goldplus/shared';
import type { ITaxonomyRepository } from '../ports/ITaxonomyRepository';

/**
 * Product discovery taxonomy for the storefront and the editor. Public reads
 * return the stored document (sanitised) or DEFAULT if none/empty; updates
 * validate and sanitise the whole tree. A category needs a slug and a name; a
 * document with no valid category is rejected so discovery can never be blanked.
 */
const s = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max);
const slugify = (v: unknown): string =>
  String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

function sanitizeSub(raw: any): TaxonomySubcategory | null {
  const slug = slugify(raw?.slug ?? raw?.name);
  const name = s(raw?.name, 60);
  if (!slug || !name) return null;
  const keywords = Array.isArray(raw?.keywords)
    ? Array.from(new Set<string>(raw.keywords.map((k: unknown) => s(k, 60).toLowerCase()).filter(Boolean))).slice(0, 30)
    : [];
  return { slug, name, keywords };
}

function sanitizeCategory(raw: any): TaxonomyCategory | null {
  const slug = slugify(raw?.slug ?? raw?.name);
  const name = s(raw?.name, 80);
  if (!slug || !name) return null;
  const subcategories = (Array.isArray(raw?.subcategories) ? raw.subcategories : [])
    .map(sanitizeSub)
    .filter((x: TaxonomySubcategory | null): x is TaxonomySubcategory => x !== null)
    .slice(0, 40);
  const aliases = Array.isArray(raw?.aliases)
    ? Array.from(new Set<string>(raw.aliases.map(slugify).filter(Boolean))).slice(0, 20)
    : [];
  const cat: TaxonomyCategory = {
    slug,
    name,
    showOnHomepage: !!raw?.showOnHomepage,
    subcategories,
    aliases,
  };
  const description = s(raw?.description, 300);
  if (description) cat.description = description;
  const homepageBlurb = s(raw?.homepageBlurb, 120);
  if (homepageBlurb) cat.homepageBlurb = homepageBlurb;
  return cat;
}

/** Coerce any stored/submitted value to a clean Taxonomy; dedupe category slugs. */
export function sanitizeTaxonomy(input: unknown): Taxonomy {
  const list = Array.isArray(input) ? input : [];
  const out: Taxonomy = [];
  const seen = new Set<string>();
  for (const raw of list.slice(0, 60)) {
    const cat = sanitizeCategory(raw);
    if (cat && !seen.has(cat.slug)) {
      seen.add(cat.slug);
      out.push(cat);
    }
  }
  return out;
}

export class TaxonomyService {
  constructor(private readonly repo: ITaxonomyRepository) {}

  async getPublicConfig(): Promise<Taxonomy> {
    try {
      const stored = await this.repo.getConfig();
      const clean = sanitizeTaxonomy(stored?.config);
      return clean.length > 0 ? clean : DEFAULT_TAXONOMY;
    } catch {
      return DEFAULT_TAXONOMY;
    }
  }

  async getAdminConfig(): Promise<{ config: Taxonomy; version: number }> {
    const stored = await this.repo.getConfig();
    const clean = sanitizeTaxonomy(stored?.config);
    return { config: clean.length > 0 ? clean : DEFAULT_TAXONOMY, version: stored?.version ?? 0 };
  }

  async updateConfig(input: unknown, actorId: string): Promise<{ ok: true; version: number }> {
    const clean = sanitizeTaxonomy(input);
    if (clean.length === 0) {
      throw new Error('The taxonomy needs at least one category with a slug and a name.');
    }
    const stored = await this.repo.updateConfig(clean, actorId);
    return { ok: true, version: stored.version };
  }
}
