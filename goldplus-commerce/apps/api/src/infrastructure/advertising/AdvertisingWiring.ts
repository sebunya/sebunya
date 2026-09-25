import type { AdCapability, PlatformCredentials } from '../../application/ports/Advertising';
import type { CreateAuditLogUseCase } from '../../application/use-cases/audit/CreateAuditLogUseCase';
import type { AdDestinationUseCases } from '../../application/use-cases/advertising/AdDestinationUseCases';
import { AdCapabilityUseCases, capabilityDef } from '../../application/use-cases/advertising/AdCapabilities';
import { AudienceSyncUseCases } from '../../application/use-cases/advertising/AudienceSyncUseCases';
import { AdSpendUseCases } from '../../application/use-cases/advertising/AdSpendUseCases';
import { OfflineConversionUseCases } from '../../application/use-cases/advertising/OfflineConversionUseCases';
import { CatalogueFeedUseCases } from '../../application/use-cases/advertising/CatalogueFeeds';
import { buildChecklist } from '../../application/use-cases/advertising/ConnectionChecklist';
import { resolveStorefrontDiscount } from '../../application/pricing/StorefrontDiscountQuery';
import {
  DrizzleAdCapabilityRepository, DrizzleAudienceRepository, DrizzleJobClaims, DrizzleOfflineConversionRepository, DrizzleSpendFactRepository,
} from '../db/repositories/DrizzleAdvertisingOpsRepository';
import { DrizzleAdDestinationRepository } from '../db/repositories/DrizzleAdDestinationRepository';
import { IntegrationCredentialVault } from '../seo/IntegrationCredentialVault';
import { vaultCipher } from '../ai-visibility/AiVisibilityWiring';
import { HttpAudienceGateway, HttpOfflineConversionGateway, HttpSpendGateway } from './AdvertisingGateways';
import { AD_PLATFORMS } from './AdPlatforms';

/**
 * Composition of the advertising operations module (0154). Credentials are
 * decrypted here, just in time, for the one call that needs them; nothing
 * returned to a route carries a token.
 */
export function createAdvertisingOperations(deps: {
  audit: CreateAuditLogUseCase;
  destinations: AdDestinationUseCases;
  feedProducts: () => Promise<import('../../application/use-cases/seo-growth/MerchantFeedUseCase').FeedProduct[]>;
  pricingRepo: Parameters<typeof resolveStorefrontDiscount>[0];
  publicApiOrigin: string;
  /** The first-party module's segment → audience port (lazy: it is built later in the Registry). */
  customSegments?: () => import('../../application/use-cases/advertising/AudienceSyncUseCases').AudienceSyncExtras['customSegments'];
}) {
  const capRepo = new DrizzleAdCapabilityRepository();
  const destRepo = new DrizzleAdDestinationRepository();
  const capabilities = new AdCapabilityUseCases(capRepo, () => deps.destinations.list(), vaultCipher(), deps.audit);

  const decrypt = (enc: string | null): string => {
    if (!enc) return '';
    const vault = IntegrationCredentialVault.fromEnv();
    if (!vault) throw new Error('Not configured: the credential vault key is not set on the server.');
    try { return String(vault.decrypt<{ apiKey: string }>(enc).apiKey ?? ''); } catch { throw new Error('The stored token could not be decrypted (the server key changed). Re-enter it.'); }
  };

  /** Credentials for one platform capability. THROWS "Not configured: …" when something is missing. */
  const credentialsFor = (capability: AdCapability) => async (platform: string): Promise<PlatformCredentials> => {
    const def = capabilityDef(platform, capability);
    const dest = await destRepo.get(platform);
    const destEnc = await destRepo.secretEnc(platform);
    const cap = await capRepo.get(platform, capability);
    let capEnc = await capRepo.secretEnc(platform, capability);
    if (!capEnc && def?.secretFallback) capEnc = await capRepo.secretEnc(platform, def.secretFallback);
    return {
      config: cap?.config ?? {},
      secret: decrypt(capEnc),
      destinationConfig: dest?.config ?? {},
      destinationSecret: decrypt(destEnc),
      testMode: !!dest?.enabled && dest.mode === 'test',
    };
  };

  const liveCap = (capability: AdCapability) => (platform: string) => capabilities.live(platform, capability);

  const audienceRepo = new DrizzleAudienceRepository();
  const jobs = new DrizzleJobClaims();
  const customSegments = deps.customSegments ? {
    source: { advertisingAudience: (id: string, o?: { limit?: number }) => deps.customSegments!()!.source.advertisingAudience(id, o) },
    list: () => deps.customSegments!()!.list(),
  } : undefined;
  const audiences = new AudienceSyncUseCases(audienceRepo, audienceRepo, new HttpAudienceGateway(), liveCap('audiences'), credentialsFor('audiences'), undefined, {
    audit: deps.audit,
    recordCapabilityRun: (platform, status, error) => capabilities.recordRun(platform, 'audiences', status, error),
    lock: jobs,
    customSegments,
  });
  const spend = new AdSpendUseCases(new DrizzleSpendFactRepository(), new HttpSpendGateway(), liveCap('spend'), credentialsFor('spend'), deps.audit);
  const offline = new OfflineConversionUseCases(new DrizzleOfflineConversionRepository(), new HttpOfflineConversionGateway(), liveCap('offline'), credentialsFor('offline'), deps.audit);
  const feeds = new CatalogueFeedUseCases({
    products: deps.feedProducts,
    discount: async () => {
      const c = await resolveStorefrontDiscount(deps.pricingRepo);
      return c.active ? { percentBps: c.percentBps, priceFloorUgx: c.priceFloorUgx, saleStartIso: c.startsIso, saleEndIso: c.endsIso } : null;
    },
  });
  const origin = deps.publicApiOrigin.replace(/\/+$/, '');
  const feedUrls = { google: `${origin}/seo/merchant-feed.xml`, meta: `${origin}/advertising/feeds/meta-catalogue.csv`, tiktok: `${origin}/advertising/feeds/tiktok-catalogue.csv` };

  return {
    capabilities, audiences, spend, offline, feeds, feedUrls,
    jobs,
    async checklist() {
      const [destinations, caps, feedProducts] = await Promise.all([deps.destinations.list(), capabilities.list(), feeds.included().catch(() => null)]);
      return buildChecklist({ destinations, capabilities: caps, feedProducts, feedUrls });
    },
    /** Platforms receiving customer lists or offline sales (for the privacy page). */
    async recipients(): Promise<string[]> {
      const names = new Map(AD_PLATFORMS.map((p) => [p.key, p.name]));
      return [...new Set((await capabilities.list()).filter((c) => c.state === 'LIVE' && c.capability !== 'spend').map((c) => names.get(c.platform) ?? c.platform))];
    },
  };
}

export type AdvertisingOperations = ReturnType<typeof createAdvertisingOperations>;
