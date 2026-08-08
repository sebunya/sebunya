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
  return {
    trustItems: trustItems.length > 0 ? trustItems : DEFAULT_HOMEPAGE_CONTENT.trustItems,
    pathwayCards: pathwayCards.length > 0 ? pathwayCards : DEFAULT_HOMEPAGE_CONTENT.pathwayCards,
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
