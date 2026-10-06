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
import { AD_PLATFORMS, META_GRAPH_VERSION, X_EVENT_FIELD } from './AdPlatforms';
import { AdActivityUseCases } from '../../application/use-cases/advertising/AdActivityUseCases';
import { DrizzleAdActivityRepository } from '../db/repositories/DrizzleAdActivityRepository';
import { MetaDiagnosticsUseCases } from '../../application/use-cases/advertising/MetaDiagnosticsUseCases';
import { HttpMetaDiagnosticsGateway } from './HttpMetaDiagnosticsGateway';
import { TikTokDiagnosticsUseCases } from '../../application/use-cases/advertising/TikTokDiagnosticsUseCases';
import { HttpTikTokDiagnosticsGateway } from './HttpTikTokDiagnosticsGateway';
import { TikTokConnectUseCases } from '../../application/use-cases/advertising/TikTokConnectUseCases';
import { SpotifyConnectUseCases } from '../../application/use-cases/advertising/SpotifyConnectUseCases';
import { HttpSpotifyAdsGateway } from './HttpSpotifyAdsGateway';
import { HttpTikTokOAuthGateway } from './HttpTikTokOAuthGateway';
import { storefrontOrigin } from '../config/storefrontOrigin';
import { WhatsAppAdsUseCases } from '../../application/use-cases/advertising/WhatsAppAdsUseCases';
import { DrizzleWhatsAppAdReferralRepository } from '../db/repositories/DrizzleWhatsAppAdReferralRepository';
import { ctwaWindowDays, parseCtwaSecrets } from '../../domain/advertising/WhatsAppAdReferrals';
import { setWhatsAppAdResolver } from '../measurement/DeliveryService';

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
  // Click-to-WhatsApp adverts: the webhook's secrets are decrypted here, just in
  // time, and reach nothing but the use case that checks a signature with them.
  const whatsappAds = new WhatsAppAdsUseCases(new DrizzleWhatsAppAdReferralRepository(), async () => {
    const row = await capRepo.get('meta', 'whatsapp_ads');
    const enc = await capRepo.secretEnc('meta', 'whatsapp_ads');
    const wabaId = String(row?.config?.wabaId ?? '');
    if (!row || !enc || !/^\d{10,20}$/.test(wabaId)) return null;
    const secrets = parseCtwaSecrets(decrypt(enc));
    if (!secrets) return null;
    return { live: !!(await capabilities.live('meta', 'whatsapp_ads')), wabaId, windowDays: ctwaWindowDays(row.config?.windowDays), datasetId: row.config?.datasetId || null, secrets };
  });
  // The order path (DeliveryService) cannot import this module back; it is handed the resolver.
  setWhatsAppAdResolver(whatsappAds);

  const offline = new OfflineConversionUseCases(new DrizzleOfflineConversionRepository(), new HttpOfflineConversionGateway(), liveCap('offline'), credentialsFor('offline'), deps.audit, () => new Date(), whatsappAds);
  const feeds = new CatalogueFeedUseCases({
    products: deps.feedProducts,
    discount: async () => {
      const c = await resolveStorefrontDiscount(deps.pricingRepo);
      return c.active ? { percentBps: c.percentBps, priceFloorUgx: c.priceFloorUgx, saleStartIso: c.startsIso, saleEndIso: c.endsIso } : null;
    },
    // The same rate the TikTok events use, so a product's price and its sale value agree.
    tiktokUgxPerUsd: async () => { const r = Number((await destRepo.get('tiktok'))?.config?.ugxPerUsd); return Number.isFinite(r) && r >= 100 ? r : null; },
  });
  const origin = deps.publicApiOrigin.replace(/\/+$/, '');
  const feedUrls = { google: `${origin}/seo/merchant-feed.xml`, meta: `${origin}/advertising/feeds/meta-catalogue.csv`, tiktok: `${origin}/advertising/feeds/tiktok-catalogue.csv` };

  // What reached each platform and what did not (read-only). X is the one
  // platform with an Events Manager ID per event; the rest map by name.
  const activity = new AdActivityUseCases(new DrizzleAdActivityRepository(), () => deps.destinations.list(),
    (platform, config, event) => (platform === 'x' ? (config[X_EVENT_FIELD[event] ?? ''] || null) : undefined));

  // What Meta itself says about the dataset: that the ID and token work, and
  // how well it can match what it receives. The token is read just in time.
  const metaDiagnostics = new MetaDiagnosticsUseCases(new HttpMetaDiagnosticsGateway(), async () => {
    const dest = await destRepo.get('meta');
    const datasetId = String(dest?.config?.datasetId ?? '');
    if (!/^\d{10,20}$/.test(datasetId)) throw new Error('Not configured: enter the Meta dataset ID on the Advertising page.');
    const enc = await destRepo.secretEnc('meta');
    if (!enc) throw new Error('Not configured: enter the Conversions API access token on the Advertising page.');
    return { datasetId, token: decrypt(enc), enabled: !!dest?.enabled, mode: dest?.mode === 'test' ? 'test' : 'live' };
  }, deps.audit, storefrontOrigin, () => Date.now(), META_GRAPH_VERSION);

  // The owner's test send to TikTok, built by the same builder as a real event.
  const tiktokDiagnostics = new TikTokDiagnosticsUseCases(new HttpTikTokDiagnosticsGateway(), async () => {
    const dest = await destRepo.get('tiktok');
    const config = Object.fromEntries(Object.entries(dest?.config ?? {}).map(([k, v]) => [k, String(v ?? '')]));
    if (!/^[A-Z0-9]{10,30}$/.test(config.pixelCode ?? '')) throw new Error('Not configured: enter the TikTok pixel code on the Advertising page.');
    const enc = await destRepo.secretEnc('tiktok');
    if (!enc) throw new Error('Not configured: enter the TikTok Events API access token on the Advertising page.');
    return { config, token: decrypt(enc) };
  }, deps.audit, storefrontOrigin);

  // TikTok's advertiser authorisation: the code from the redirect becomes the
  // audiences token, saved through the same validated, encrypted, audited path as a pasted one.
  const tiktokConnect = new TikTokConnectUseCases(new HttpTikTokOAuthGateway(), async (actorId, advertiserId, token) => {
    const r = await capabilities.configure(actorId, 'tiktok', 'audiences', { config: { advertiserId }, secret: token });
    return r.ok ? { ok: true } : { ok: false, message: r.message };
  }, deps.audit);

  const spotifyConnect = new SpotifyConnectUseCases(new HttpSpotifyAdsGateway(), async () => {
    const row = (await capabilities.list()).find((v: any) => v.platform === 'spotify' && v.capability === 'ads_api') as any;
    const cfg = row?.row?.config ?? {};
    return { clientId: String(cfg.clientId ?? ''), adAccountId: String(cfg.adAccountId ?? '') };
  }, async (actorId, refreshToken) => {
    const r = await capabilities.configure(actorId, 'spotify', 'ads_api', { secret: refreshToken });
    return r.ok ? { ok: true } : { ok: false, message: r.message };
  }, deps.audit);

  return {
    capabilities, audiences, spend, offline, feeds, feedUrls, activity, metaDiagnostics, tiktokDiagnostics, tiktokConnect, spotifyConnect, whatsappAds,
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
