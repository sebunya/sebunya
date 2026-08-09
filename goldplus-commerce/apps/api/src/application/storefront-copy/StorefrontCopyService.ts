import { DEFAULT_STOREFRONT_COPY, type StorefrontCopy } from '@goldplus/shared';
import type { IStorefrontCopyRepository } from '../ports/IStorefrontCopyRepository';

/**
 * Storefront copy for the support page and checkout, plus the editor. Public
 * reads deep-fill over DEFAULT so a partial document never blanks a label;
 * updates sanitise each field. Payment method keys are code-bound.
 */
const s = (v: unknown, max: number, fallback: string): string => {
  const out = String(v ?? '').trim().slice(0, max);
  return out || fallback;
};

function sanitize(input: any): StorefrontCopy {
  const d = DEFAULT_STOREFRONT_COPY;
  return {
    supportHeading: s(input?.supportHeading, 120, d.supportHeading),
    supportIntro: s(input?.supportIntro, 400, d.supportIntro),
    payment: {
      offline: {
        label: s(input?.payment?.offline?.label, 80, d.payment.offline.label),
        description: s(input?.payment?.offline?.description, 300, d.payment.offline.description),
      },
      pesapal: {
        label: s(input?.payment?.pesapal?.label, 80, d.payment.pesapal.label),
        description: s(input?.payment?.pesapal?.description, 300, d.payment.pesapal.description),
      },
    },
  };
}

export class StorefrontCopyService {
  constructor(private readonly repo: IStorefrontCopyRepository) {}

  async getPublicConfig(): Promise<StorefrontCopy> {
    try {
      const stored = await this.repo.getConfig();
      return stored?.config ? sanitize(stored.config) : DEFAULT_STOREFRONT_COPY;
    } catch {
      return DEFAULT_STOREFRONT_COPY;
    }
  }

  async getAdminConfig(): Promise<{ config: StorefrontCopy; version: number }> {
    const stored = await this.repo.getConfig();
    return { config: stored?.config ? sanitize(stored.config) : DEFAULT_STOREFRONT_COPY, version: stored?.version ?? 0 };
  }

  async updateConfig(input: unknown, actorId: string): Promise<{ ok: true; version: number }> {
    const clean = sanitize(input);
    const stored = await this.repo.updateConfig(clean, actorId);
    return { ok: true, version: stored.version };
  }
}
