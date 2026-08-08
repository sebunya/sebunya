import { DEFAULT_BUSINESS_INFO, type BusinessInfo } from '@goldplus/shared';
import type { IBusinessInfoRepository } from '../ports/IBusinessInfoRepository';

/**
 * Business/contact info for the storefront and the editor. Public reads deep-merge
 * over DEFAULT so a partial document can never blank the footer; the editor gets the
 * raw document; updates sanitise the few structured fields and persist.
 */
function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function deepMerge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : (over as T));
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(over)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = isObj(b) && isObj(over[k]) ? deepMerge(b, over[k]) : over[k];
  }
  return out as T;
}

const s = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max);

export class BusinessInfoService {
  constructor(private readonly repo: IBusinessInfoRepository) {}

  async getPublicConfig(): Promise<BusinessInfo> {
    try {
      const stored = await this.repo.getConfig();
      // Arrays (socials) come whole from the stored doc; scalars fall back to DEFAULT.
      return stored?.config ? { ...deepMerge(DEFAULT_BUSINESS_INFO, stored.config), socials: stored.config.socials ?? DEFAULT_BUSINESS_INFO.socials } : DEFAULT_BUSINESS_INFO;
    } catch {
      return DEFAULT_BUSINESS_INFO;
    }
  }

  async getAdminConfig(): Promise<{ config: BusinessInfo; version: number }> {
    const stored = await this.repo.getConfig();
    return { config: stored?.config ?? DEFAULT_BUSINESS_INFO, version: stored?.version ?? 0 };
  }

  async updateConfig(input: Partial<BusinessInfo>, actorId: string): Promise<{ ok: true; version: number }> {
    // Merge over the current doc so an editor that submits a subset never drops fields.
    const current = (await this.repo.getConfig())?.config ?? DEFAULT_BUSINESS_INFO;
    const merged: BusinessInfo = { ...current, ...input } as BusinessInfo;
    const clean: BusinessInfo = {
      phoneDisplay: s(merged.phoneDisplay, 40),
      phoneDial: s(merged.phoneDial, 40),
      whatsappNumber: s(merged.whatsappNumber, 20),
      whatsappUrl: s(merged.whatsappUrl, 300),
      whatsappChannelUrl: s(merged.whatsappChannelUrl, 300),
      addressLine1: s(merged.addressLine1, 200),
      addressLine2: s(merged.addressLine2, 300),
      mapUrl: s(merged.mapUrl, 500),
      shopHours: s(merged.shopHours, 80),
      deliveryHours: s(merged.deliveryHours, 80),
      deliveryNote: s(merged.deliveryNote, 200),
      openDays: s(merged.openDays, 80),
      socials: (Array.isArray(merged.socials) ? merged.socials : DEFAULT_BUSINESS_INFO.socials)
        .slice(0, 20)
        .map((x) => ({ key: s(x.key, 30), label: s(x.label, 40), href: s(x.href, 300), enabled: !!x.enabled })),
    };
    const stored = await this.repo.updateConfig(clean, actorId);
    return { ok: true, version: stored.version };
  }
}
