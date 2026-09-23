import { DEFAULT_HOMEPAGE_CONTENT, type HomeAmbassador, type HomepageContent } from '@goldplus/shared';
import type { IHomepageContentRepository } from '../ports/IHomepageContentRepository';
import type { IAmbassadorMedia } from '../ports/IAmbassadorMedia';
import {
  portraitRenditions,
  publicAmbassadors,
  readStoredAmbassadors,
  validateAmbassadorsEdit,
  type AmbassadorFieldError,
} from '../../domain/homepage/Ambassadors';

/**
 * Homepage marketing content for the storefront and the editor. Public reads
 * return the stored document (sanitised) or DEFAULT; updates sanitise every
 * field. Empty lists fall back to DEFAULT so the homepage can never be blanked.
 */
const s = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max);

function sanitize(input: any): HomepageContent {
  const trustItems = (Array.isArray(input?.trustItems) ? input.trustItems : [])
    .map((t: any) => ({ iconKey: s(t?.iconKey, 30) || 'shield', title: s(t?.title, 120), body: s(t?.body, 400) }))
    .filter((t: any) => t.title && t.body)
    .slice(0, 6);
  const pathwayCards = (Array.isArray(input?.pathwayCards) ? input.pathwayCards : [])
    .map((c: any) => ({ title: s(c?.title, 120), body: s(c?.body, 400), ctaLabel: s(c?.ctaLabel, 40), href: s(c?.href, 300) }))
    .filter((c: any) => c.title && c.body && c.ctaLabel && c.href)
    .slice(0, 6);
  const whatsappChannel = {
    heading: s(input?.whatsappChannel?.heading, 80) || DEFAULT_HOMEPAGE_CONTENT.whatsappChannel.heading,
    body: s(input?.whatsappChannel?.body, 200) || DEFAULT_HOMEPAGE_CONTENT.whatsappChannel.body,
  };
  const link = (l: any): { label: string; href: string } => ({ label: s(l?.label, 60), href: s(l?.href, 300) });
  const validLink = (l: { label: string; href: string }) => Boolean(l.label && l.href);
  const df = DEFAULT_HOMEPAGE_CONTENT.footer;
  const columns = (Array.isArray(input?.footer?.columns) ? input.footer.columns : [])
    .map((c: any) => ({ heading: s(c?.heading, 40), links: (Array.isArray(c?.links) ? c.links : []).map(link).filter(validLink).slice(0, 12) }))
    .filter((c: any) => c.heading && c.links.length > 0)
    .slice(0, 6);
  const legalLinks = (Array.isArray(input?.footer?.legalLinks) ? input.footer.legalLinks : []).map(link).filter(validLink).slice(0, 12);
  const attribution = validLink(link(input?.footer?.attribution)) ? link(input?.footer?.attribution) : df.attribution;
  const footer = {
    columns: columns.length > 0 ? columns : df.columns,
    legalLinks: legalLinks.length > 0 ? legalLinks : df.legalLinks,
    attribution,
    paymentHeading: s(input?.footer?.paymentHeading, 60) || df.paymentHeading,
    copyrightNotice: s(input?.footer?.copyrightNotice, 120) || df.copyrightNotice,
    visitHeading: s(input?.footer?.visitHeading, 40) || df.visitHeading,
    openHeading: s(input?.footer?.openHeading, 40) || df.openHeading,
  };
  return {
    trustItems: trustItems.length > 0 ? trustItems : DEFAULT_HOMEPAGE_CONTENT.trustItems,
    pathwayCards: pathwayCards.length > 0 ? pathwayCards : DEFAULT_HOMEPAGE_CONTENT.pathwayCards,
    whatsappChannel,
    footer,
    ambassadors: readStoredAmbassadors(input?.ambassadors),
  };
}

export class HomepageContentService {
  constructor(
    private readonly repo: IHomepageContentRepository,
    /** Needed only to edit the ambassadors section; reads never touch the media library. */
    private readonly ambassadorMedia?: IAmbassadorMedia,
  ) {}

  async getPublicConfig(): Promise<HomepageContent> {
    try {
      const stored = await this.repo.getConfig();
      const config = stored?.config ? sanitize(stored.config) : DEFAULT_HOMEPAGE_CONTENT;
      // Drafts, unpublished people and anyone without a release on file never leave the API.
      return { ...config, ambassadors: publicAmbassadors(config.ambassadors) };
    } catch {
      return DEFAULT_HOMEPAGE_CONTENT;
    }
  }

  async getAdminConfig(): Promise<{ config: HomepageContent; version: number }> {
    const stored = await this.repo.getConfig();
    return { config: stored?.config ? sanitize(stored.config) : DEFAULT_HOMEPAGE_CONTENT, version: stored?.version ?? 0 };
  }

  /**
   * The whole-document editor (/admin/homepage) knows nothing of the ambassadors
   * section, and sends the whole document. Its save must never wipe the people
   * the ambassadors editor manages, so the STORED section is always kept here.
   */
  async updateConfig(input: unknown, actorId: string): Promise<{ ok: true; version: number }> {
    const current = await this.repo.getConfig();
    const kept = readStoredAmbassadors((current?.config as any)?.ambassadors);
    const clean = { ...sanitize(input), ambassadors: kept };
    const stored = await this.repo.updateConfig(clean, actorId);
    return { ok: true, version: stored.version };
  }

  /**
   * Replaces the ambassadors section. Every photo must be a media-library image;
   * it is stored as its renditions, and the library records the usage so the
   * image cannot be deleted while it is on the page. Nothing is saved if any
   * entry has a problem — the editor shows each one next to its field.
   */
  async updateAmbassadors(input: unknown, actorId: string): Promise<{ ok: true; version: number } | { ok: false; errors: AmbassadorFieldError[] }> {
    if (!this.ambassadorMedia) throw new Error('Ambassador media port is not configured.');
    const { section, people, errors } = validateAmbassadorsEdit(input);
    const current = await this.repo.getConfig();
    const resolved: HomeAmbassador[] = [];
    for (const [index, p] of people.entries()) {
      let image: HomeAmbassador['image'] = null;
      if (p.imageUrl) {
        const found = await this.ambassadorMedia.resolveByUrl(p.imageUrl);
        if (!found) {
          errors.push({ index, field: 'imageUrl', message: 'That photo is not in the media library. Upload it here or pick it from the library.' });
        } else if (found.status !== 'ACTIVE') {
          errors.push({ index, field: 'imageUrl', message: 'That photo is archived in the media library. Restore it or choose another.' });
        } else {
          image = { assetId: found.assetId, ...portraitRenditions(found.original, found.variants) };
        }
      }
      resolved.push({ id: p.id, name: p.name, role: p.role, tagline: p.tagline, image, imageAlt: p.imageAlt, productSlug: p.productSlug, releaseOnFile: p.releaseOnFile, published: p.published });
    }
    if (errors.length > 0) return { ok: false, errors };
    const base = current?.config ? sanitize(current.config) : DEFAULT_HOMEPAGE_CONTENT;
    const stored = await this.repo.updateConfig({ ...base, ambassadors: { ...section, people: resolved } }, actorId);
    await this.ambassadorMedia.syncUsages(resolved.filter((p) => p.image).map((p) => ({ personId: p.id, assetId: p.image!.assetId })));
    return { ok: true, version: stored.version };
  }
}
