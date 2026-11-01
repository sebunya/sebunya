import {
  DEFAULT_NAV_CONFIG,
  validateNavConfig,
  navConfigWarnings,
  sanitiseNavConfig,
  type NavConfig,
  type NavConfigError,
} from '@goldplus/shared';
import type { INavRepository } from '../ports/INavRepository';

/**
 * Header/nav content, composed for the two audiences that read it.
 *
 * The STOREFRONT gets `getPublicConfig`: the stored document DEEP-MERGED over
 * DEFAULT_NAV_CONFIG (so a structurally-partial row can never make the SSR header
 * throw) and its set:html fields SANITISED — applied once, on read, to the always-
 * raw stored value (HTML-entity escaping is not idempotent, so it must never be
 * done on write or repeated saves would compound it). On any failure it returns
 * DEFAULT — the header is never a database outage. The EDITOR gets `getAdminConfig`:
 * the RAW document (so edits round-trip) plus its hard errors and soft warnings.
 * `updateConfig` validates the WHOLE document and (optionally) enforces optimistic
 * concurrency, so a broken header is refused and a concurrent edit cannot clobber.
 */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Overlay `over` onto `base`: objects merge recursively; arrays/primitives from
 * `over` win outright. Missing sub-trees in `over` fall back to `base`. */
function deepMerge<T>(base: T, over: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(over)) return (over === undefined ? base : (over as T));
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(over)) {
    const b = (base as Record<string, unknown>)[key];
    out[key] = isPlainObject(b) && isPlainObject(over[key]) ? deepMerge(b, over[key]) : over[key];
  }
  return out as T;
}

export class NavContentService {
  constructor(private readonly repo: INavRepository) {}

  async getPublicConfig(): Promise<NavConfig> {
    try {
      const stored = await this.repo.getConfig();
      if (!stored?.config) return DEFAULT_NAV_CONFIG;
      // Merge over DEFAULT (a partial document cannot 500 the SSR header), then
      // sanitise the set:html fields ONCE, here on read — the "sanitised at the
      // render boundary" half of the XSS guarantee.
      return sanitiseNavConfig(deepMerge(DEFAULT_NAV_CONFIG, stored.config));
    } catch {
      return DEFAULT_NAV_CONFIG;
    }
  }

  async getAdminConfig(): Promise<{ config: NavConfig; version: number; errors: NavConfigError[]; warnings: NavConfigError[] }> {
    const stored = await this.repo.getConfig();
    const config = stored?.config ?? DEFAULT_NAV_CONFIG;
    return { config, version: stored?.version ?? 0, errors: validateNavConfig(config), warnings: navConfigWarnings(config) };
  }

  async updateConfig(
    config: NavConfig,
    actorId: string,
    expectedVersion?: number,
  ): Promise<{ ok: true; version: number } | { ok: false; errors: NavConfigError[] } | { ok: false; conflict: true }> {
    if (!config || typeof config !== 'object') {
      return { ok: false, errors: [{ path: 'config', message: 'The header configuration is missing.' }] };
    }
    const errors = validateNavConfig(config);
    if (errors.length) return { ok: false, errors };
    // Store the RAW validated config. Sanitisation happens once on read
    // (getPublicConfig); doing it here would compound on every re-save because
    // HTML-entity escaping is not idempotent.
    const stored = await this.repo.updateConfig(config, actorId, expectedVersion);
    if (!stored) return { ok: false, conflict: true };
    return { ok: true, version: stored.version };
  }
}
