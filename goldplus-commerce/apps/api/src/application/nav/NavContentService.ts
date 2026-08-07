import { DEFAULT_NAV_CONFIG, validateNavConfig, type NavConfig, type NavConfigError } from '@goldplus/shared';
import type { INavRepository } from '../ports/INavRepository';

/**
 * Header/nav content, composed for the two audiences that read it.
 *
 * The STOREFRONT gets `getPublicConfig`: the stored document, or DEFAULT_NAV_CONFIG
 * on any failure — the header is never a database outage. The EDITOR gets
 * `getAdminConfig`: the document plus its validation errors. `updateConfig`
 * validates the WHOLE document before persisting, so a save that would break the
 * header is refused with the reasons (the doc-level equivalent of the hero's
 * validate-the-merged-slide).
 */
export class NavContentService {
  constructor(private readonly repo: INavRepository) {}

  async getPublicConfig(): Promise<NavConfig> {
    try {
      const stored = await this.repo.getConfig();
      return stored?.config ?? DEFAULT_NAV_CONFIG;
    } catch {
      return DEFAULT_NAV_CONFIG;
    }
  }

  async getAdminConfig(): Promise<{ config: NavConfig; version: number; errors: NavConfigError[] }> {
    const stored = await this.repo.getConfig();
    const config = stored?.config ?? DEFAULT_NAV_CONFIG;
    return { config, version: stored?.version ?? 0, errors: validateNavConfig(config) };
  }

  async updateConfig(
    config: NavConfig,
    actorId: string,
  ): Promise<{ ok: true; version: number } | { ok: false; errors: NavConfigError[] }> {
    if (!config || typeof config !== 'object') {
      return { ok: false, errors: [{ path: 'config', message: 'The header configuration is missing.' }] };
    }
    const errors = validateNavConfig(config);
    if (errors.length) return { ok: false, errors };
    const stored = await this.repo.updateConfig(config, actorId);
    return { ok: true, version: stored.version };
  }
}
