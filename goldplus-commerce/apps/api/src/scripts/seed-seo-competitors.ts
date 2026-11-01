import '../config/env';
import { endDbConnection } from '../infrastructure/db/client';
import { DrizzleSeoGrowthRepository, type SeoCompetitorInput } from '../infrastructure/db/repositories/DrizzleSeoGrowthRepository';

/**
 * Seeds the competitor registry (management-supplied competitive research
 * brief, 2026-08) and one READY_FOR_CREDENTIALS row per SEO integration
 * provider. Idempotent: competitors upsert by canonical_name; integrations
 * upsert by provider.
 *
 * Evidence discipline: business_type/directness/relevance are best-judgment
 * classifications of a management-supplied list (evidence_state
 * MANAGEMENT_SUPPLIED). Domains are recorded ONLY where well known; everything
 * uncertain stays domains=[] and local_presence=null — nothing is invented.
 *
 * Usage: npx tsx src/scripts/seed-seo-competitors.ts
 */

const EVIDENCE_SOURCE = 'ShopGoldPlus competitive research brief 2026-08';

type Row = Omit<SeoCompetitorInput, 'evidenceSource' | 'evidenceState' | 'status'>;

const UG = { country: 'UG', ugandaRelevance: 'HIGH' as const };

const localEcom = (canonicalName: string, extra: Partial<Row> = {}): Row => ({
  canonicalName,
  businessType: 'LOCAL_ECOMMERCE',
  directness: 'DIRECT',
  ...UG,
  localPresence: true,
  isMarketplace: false,
  isBrand: false,
  ...extra,
});

// local_presence deliberately null (unverified) unless stated.
const unverifiedLocal = (canonicalName: string, extra: Partial<Row> = {}): Row => ({
  canonicalName,
  businessType: 'LOCAL_ECOMMERCE',
  directness: 'DIRECT',
  ...UG,
  localPresence: null,
  isMarketplace: false,
  isBrand: false,
  ...extra,
});

const COMPETITORS: Row[] = [
  { canonicalName: 'Jumia Uganda', domains: ['jumia.ug'], businessType: 'MARKETPLACE', directness: 'DIRECT', ...UG, localPresence: true, isMarketplace: true, isBrand: false, categoryOverlap: ['phones', 'accessories', 'electronics', 'computing'] },
  { canonicalName: 'Jiji Uganda', domains: ['jiji.ug'], businessType: 'CLASSIFIED_MARKETPLACE', directness: 'DIRECT', ...UG, localPresence: true, isMarketplace: true, isBrand: false, categoryOverlap: ['phones', 'accessories', 'electronics'] },
  { canonicalName: 'Kilimall Uganda', domains: ['kilimall.co.ug'], businessType: 'REGIONAL_MARKETPLACE', directness: 'DIRECT', ...UG, localPresence: true, isMarketplace: true, isBrand: false, categoryOverlap: ['phones', 'accessories', 'electronics'] },
  { canonicalName: 'MoMo Market', aliases: ['MoMo Market', 'Market by MoMo', 'MTN MoMo Market'], businessType: 'REGIONAL_MARKETPLACE', directness: 'DIRECT', ...UG, localPresence: true, isMarketplace: true, isBrand: false },
  { canonicalName: 'Oraimo Uganda', domains: ['oraimo.com'], businessType: 'DIRECT_BRAND', directness: 'DIRECT', ...UG, localPresence: true, isMarketplace: false, isBrand: true, categoryOverlap: ['accessories', 'audio', 'power'] },
  unverifiedLocal('BLACK'),
  unverifiedLocal('TechXpress Uganda'),
  localEcom('Gadget Craze Uganda'),
  // DISTINCT business from Gadget Craze.
  unverifiedLocal('Gadget Shop Uganda'),
  unverifiedLocal('Dondolo'),
  unverifiedLocal('Discount Store Uganda'),
  unverifiedLocal('Abanista'),
  unverifiedLocal('Nabellas Stores'),
  unverifiedLocal('Mtunda'),
  unverifiedLocal('Dombelo'),
  unverifiedLocal('KYG World'),
  unverifiedLocal('Odukar'),
  unverifiedLocal('Kibuga'),
  unverifiedLocal('Mr Gadget Uganda'),
  unverifiedLocal('MobileShop Uganda', { businessType: 'PHONE_RETAILER' }),
  unverifiedLocal('TheHub Uganda'),
  unverifiedLocal('Kwesi Stores'),
  unverifiedLocal('Noble Gadgets'),
  unverifiedLocal('Sefbuy'),
  unverifiedLocal('BHT Store Uganda'),
  unverifiedLocal('Orbit Uganda'),
  { canonicalName: 'Computers.co.ug', aliases: ['Computers.co.ug', 'Pavan'], domains: ['computers.co.ug'], businessType: 'COMPUTER_RETAILER', directness: 'DIRECT', ...UG, localPresence: true, isMarketplace: false, isBrand: false, categoryOverlap: ['computing', 'accessories'] },
  unverifiedLocal('Computer Store Uganda', { businessType: 'COMPUTER_RETAILER' }),
  unverifiedLocal('Vision Shop Uganda'),
  { canonicalName: 'Ubuy Uganda', businessType: 'CROSS_BORDER_MARKETPLACE', directness: 'ADJACENT', ...UG, ugandaRelevance: 'MEDIUM', localPresence: null, isMarketplace: true, isBrand: false },
  { canonicalName: 'Simba Telecom', businessType: 'TELECOM_RETAILER', directness: 'DIRECT', ...UG, localPresence: true, isMarketplace: false, isBrand: false, categoryOverlap: ['phones', 'accessories'] },
  unverifiedLocal('AppsTech Uganda'),
  unverifiedLocal('GadgetsWorld Uganda'),
  unverifiedLocal('Authentic Gadgets Uganda'),
  unverifiedLocal('Mercury Computers Uganda', { businessType: 'COMPUTER_RETAILER' }),
  { canonicalName: 'Anker', domains: ['anker.com'], businessType: 'MANUFACTURER_BENCHMARK', directness: 'ADJACENT', country: null, ugandaRelevance: 'MEDIUM', localPresence: null, isMarketplace: false, isBrand: true, categoryOverlap: ['power', 'audio', 'accessories'] },
  { canonicalName: 'Green Lion', businessType: 'DIRECT_BRAND', directness: 'ADJACENT', country: null, ugandaRelevance: 'MEDIUM', localPresence: null, isMarketplace: false, isBrand: true, categoryOverlap: ['accessories'] },
  { canonicalName: 'Porodo', businessType: 'DIRECT_BRAND', directness: 'ADJACENT', country: null, ugandaRelevance: 'MEDIUM', localPresence: null, isMarketplace: false, isBrand: true, categoryOverlap: ['accessories'] },
  { canonicalName: 'HOCO', businessType: 'DIRECT_BRAND', directness: 'ADJACENT', country: null, ugandaRelevance: 'MEDIUM', localPresence: null, isMarketplace: false, isBrand: true, categoryOverlap: ['accessories'] },
  unverifiedLocal('KWT Tech Mart', { businessType: 'SPECIALIST_ACCESSORY_RETAILER' }),
  unverifiedLocal('Dantty'),
  unverifiedLocal('BuBu eMarket', { businessType: 'MARKETPLACE', isMarketplace: true }),
  unverifiedLocal('Risi Shop'),
  unverifiedLocal('Tamemah Gadgets'),
  unverifiedLocal('VAZ Uganda'),
  unverifiedLocal('Crystal Gadgets'),
  unverifiedLocal('Fix It Uganda'),
  unverifiedLocal('Legends Accessories', { businessType: 'SPECIALIST_ACCESSORY_RETAILER' }),
  unverifiedLocal('Stepify Uganda'),
  unverifiedLocal('Tupewo'),
  unverifiedLocal('Twix Consult Uganda', { businessType: 'B2B_CORPORATE_SUPPLIER', directness: 'ADJACENT', b2bRelevant: true }),
  unverifiedLocal('Sarada Technologies', { businessType: 'B2B_CORPORATE_SUPPLIER', directness: 'ADJACENT', b2bRelevant: true }),
  unverifiedLocal('UpTech Electronics Shop UG'),
  unverifiedLocal('O&O Gadgets Uganda'),
  unverifiedLocal('Nexus Computers Uganda', { businessType: 'COMPUTER_RETAILER' }),
  unverifiedLocal('StarTech Uganda'),
  unverifiedLocal('Ayne Uganda'),
  // 2026-08-10 reconciliation against the 58-entry source workbook: these two
  // were in the workbook but absent from the first seed. Classification is
  // deliberately UNRESOLVED — the workbook names them without enough evidence
  // to classify, and we do not invent business facts.
  unverifiedLocal('RedSMS Uganda', { businessType: 'UNRESOLVED', directness: 'UNRESOLVED' }),
  unverifiedLocal('Kampala Arcade', { businessType: 'UNRESOLVED', directness: 'UNRESOLVED' }),
];

const INTEGRATIONS: Record<string, string[]> = {
  GSC: ['GSC_SERVICE_ACCOUNT_JSON', 'GSC_SITE_URL'],
  GA4: ['GA4_PROPERTY_ID', 'GA4_SERVICE_ACCOUNT_JSON'],
  MERCHANT_CENTER: ['MERCHANT_CENTER_ID', 'MERCHANT_SERVICE_ACCOUNT_JSON'],
  GBP: ['GBP_ACCOUNT_ID', 'GBP_SERVICE_ACCOUNT_JSON'],
  KEYWORD_PROVIDER: ['KEYWORD_PROVIDER', 'KEYWORD_PROVIDER_API_KEY'],
  RANK_TRACKER: ['RANK_TRACKER_PROVIDER', 'RANK_TRACKER_API_KEY'],
  BACKLINK_PROVIDER: ['BACKLINK_PROVIDER', 'BACKLINK_PROVIDER_API_KEY'],
  BING_WEBMASTER: ['BING_WEBMASTER_API_KEY'],
  INDEXNOW: ['INDEXNOW_KEY'],
  PAGESPEED: ['PAGESPEED_API_KEY'],
  CRUX: ['CRUX_API_KEY'],
};

async function main(): Promise<void> {
  const repo = new DrizzleSeoGrowthRepository();

  let seeded = 0;
  for (const row of COMPETITORS) {
    await repo.upsertCompetitor({
      ...row,
      status: 'ACTIVE',
      evidenceSource: EVIDENCE_SOURCE,
      evidenceState: 'MANAGEMENT_SUPPLIED',
    });
    seeded += 1;
  }
  console.log(`Competitors upserted: ${seeded}`);

  for (const [provider, envVarNames] of Object.entries(INTEGRATIONS)) {
    // Non-secret config only: we store the NAMES of the env vars each
    // integration expects. Secrets themselves live in the environment.
    await repo.upsertIntegrationStatus(provider, {
      status: 'READY_FOR_CREDENTIALS',
      config: { expectedEnvVars: envVarNames },
    });
  }
  console.log(`Integrations upserted: ${Object.keys(INTEGRATIONS).length} (all READY_FOR_CREDENTIALS)`);
}

main()
  .then(async () => { await endDbConnection(); })
  .catch(async (err) => {
    console.error('seed-seo-competitors failed:', err);
    await endDbConnection();
    process.exit(1);
  });
