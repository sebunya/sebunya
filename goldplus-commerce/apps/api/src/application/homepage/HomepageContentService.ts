import { DEFAULT_HOMEPAGE_CONTENT, type HomepageContent } from '@goldplus/shared';
import type { IHomepageContentRepository } from '../ports/IHomepageContentRepository';

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
  };
}

export class HomepageContentService {
  constructor(private readonly repo: IHomepageContentRepository) {}

  async getPublicConfig(): Promise<HomepageContent> {
    try {
      const stored = await this.repo.getConfig();
      return stored?.config ? sanitize(stored.config) : DEFAULT_HOMEPAGE_CONTENT;
    } catch {
      return DEFAULT_HOMEPAGE_CONTENT;
    }
  }

  async getAdminConfig(): Promise<{ config: HomepageContent; version: number }> {
    const stored = await this.repo.getConfig();
    return { config: stored?.config ? sanitize(stored.config) : DEFAULT_HOMEPAGE_CONTENT, version: stored?.version ?? 0 };
  }

  async updateConfig(input: unknown, actorId: string): Promise<{ ok: true; version: number }> {
    const clean = sanitize(input);
    const stored = await this.repo.updateConfig(clean, actorId);
    return { ok: true, version: stored.version };
  }
}
