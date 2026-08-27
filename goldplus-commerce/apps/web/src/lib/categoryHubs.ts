import type { ProductPublicDto, Taxonomy } from '@goldplus/shared';
import { DEFAULT_TAXONOMY } from '@goldplus/shared';
import { categoryNameForSlug, getProductSubcategory } from './product-discovery';

/**
 * CATEGORY AUTHORITY ENGINE — hub registry + release-gate logic.
 *
 * A "hub" is a curated public landing page (/power, /power/power-banks, …)
 * built on top of the operator-editable discovery taxonomy. Configuration
 * lives here in code — no DB tables. Everything shown on a hub page comes
 * from REAL data at render time (the /products API, business-info); this
 * module only carries honest editorial copy and the mapping onto taxonomy
 * slugs. NO invented product facts, no fake claims, no superlatives.
 *
 * Release gates: a hub is indexable (and sitemap-listed) ONLY when enough
 * real, in-stock, photographed products exist in its mapped categories.
 * A gated-out hub still renders (200) with noindex,follow and honest copy.
 */

export interface ReleaseGateConfig {
  /** Minimum number of eligible products for the page to be indexable. */
  minProducts: number;
  /** When true, only products with a real image count toward the gate. */
  requireImages: boolean;
}

export const DEFAULT_RELEASE_GATE: ReleaseGateConfig = { minProducts: 2, requireImages: true };

export interface HubFaq {
  question: string;
  /** Static, always-true answer. Omit when the answer must come from live data. */
  answer?: string;
  /**
   * Live-data answers, resolved at render time:
   * - 'delivery'  → composed from business-info deliveryHours/deliveryNote.
   * - 'warranty'  → rendered ONLY if a shown product actually carries a
   *                 verified warranty spec/attribute; the answer points at the
   *                 warranty page rather than inventing a blanket period.
   */
  source?: 'delivery' | 'warranty';
}

export interface BuyingCriterion {
  heading: string;
  body: string;
}

export interface HubChildConfig {
  /** URL segment under the hub, e.g. 'power-banks' → /power/power-banks. */
  slug: string;
  title: string;
  h1: string;
  metaDescription: string;
  intro: string;
  /**
   * Mapped taxonomy subcategory slug (see DEFAULT_TAXONOMY / admin taxonomy),
   * or null when the live taxonomy has no matching subcategory. Unmapped
   * children can still gather products via keywordFilter but are flagged.
   */
  subcategorySlug: string | null;
  /** Lowercase words matched against product names when no subcategory maps. */
  keywordFilter?: string[];
  /** False when the live taxonomy has no subcategory for this child. */
  taxonomyMapped: boolean;
}

export interface CategoryHubConfig {
  /** Top-level URL segment, e.g. 'power' → /power. */
  slug: string;
  title: string;
  h1: string;
  metaDescription: string;
  /** Honest retail intro copy, one paragraph per entry. */
  intro: string[];
  /**
   * Mapped taxonomy category slug, or null when the live taxonomy has no
   * matching category (the hub is then gated by keywordFilter matches only).
   */
  categorySlug: string | null;
  /** Lowercase words matched against product names to narrow the category. */
  keywordFilter?: string[];
  /** False when the live taxonomy has no category for this hub. */
  taxonomyMapped: boolean;
  buyingCriteria: BuyingCriterion[];
  faqs: HubFaq[];
  releaseGate: ReleaseGateConfig;
  children: HubChildConfig[];
}

/** Superlatives and claims we never publish — enforced by unit test. */
export const BANNED_PHRASES: readonly string[] = ['best in Uganda', '#1', 'guaranteed cheapest', 'five star'];

const GATE = DEFAULT_RELEASE_GATE;

const DELIVERY_FAQ: HubFaq = { question: 'Do you deliver in Kampala and Wakiso?', source: 'delivery' };
const WARRANTY_FAQ: HubFaq = { question: 'Is there a warranty on these products?', source: 'warranty' };
const SHOP_FAQ: HubFaq = {
  question: 'Where is the GoldPlus shop?',
  answer:
    'The GoldPlus shop is on Wilson Road in central Kampala. You can buy online on this site or visit the shop in person. Contact details and directions are in the footer of every page.',
};

export const CATEGORY_HUBS: CategoryHubConfig[] = [
  {
    slug: 'power',
    title: 'Power banks, chargers & charging | GoldPlus Uganda',
    h1: 'Power & charging accessories',
    metaDescription:
      'GoldPlus power banks, chargers and charging accessories, sold from our Wilson Road shop in Kampala with delivery in Kampala & Wakiso.',
    intro: [
      'GoldPlus stocks its own house-brand power accessories. Power banks, wall chargers and charging cables. Sold from our shop on Wilson Road, Kampala.',
      'Every item ships from real stock: what you see in stock here is what is on the shelf. Orders can be delivered in Kampala & Wakiso or picked up at the shop, and warranty support is handled directly by us.',
    ],
    categorySlug: 'power-devices',
    taxonomyMapped: true,
    buyingCriteria: [
      {
        heading: 'Capacity (mAh). What it means',
        body: 'A power bank’s mAh rating is the size of its internal battery. As a rule of thumb, a full phone charge uses roughly 3,000 to 5,000 mAh depending on the phone, and some capacity is always lost in conversion, so a 10,000 mAh bank typically delivers one to two full phone charges, not three.',
      },
      {
        heading: 'Ports and connectors',
        body: 'Check which cable your phone uses (USB-C, Micro-USB or Lightning) and whether the charger or power bank has matching output ports. USB-C is now the most common connector on newer phones.',
      },
      {
        heading: 'What is in the box',
        body: 'Accessories differ in whether a cable is included. Check the individual product page. We list what each product actually comes with, and if a detail is missing from a listing we say so rather than guess.',
      },
    ],
    faqs: [DELIVERY_FAQ, WARRANTY_FAQ, SHOP_FAQ],
    releaseGate: GATE,
    children: [
      {
        slug: 'power-banks',
        title: 'Power banks | GoldPlus Uganda',
        h1: 'Power banks',
        metaDescription:
          'GoldPlus power banks in stock at our Wilson Road shop in Kampala, with delivery in Kampala & Wakiso and direct warranty support.',
        intro:
          'Portable power banks from the GoldPlus house range. Capacities and prices are listed per product from live stock. Nothing shown here is estimated.',
        subcategorySlug: 'power-banks',
        taxonomyMapped: true,
      },
      {
        slug: 'chargers',
        title: 'Phone chargers | GoldPlus Uganda',
        h1: 'Chargers',
        metaDescription:
          'GoldPlus wall chargers and adapters, sold from our Kampala shop on Wilson Road with delivery in Kampala & Wakiso.',
        intro:
          'Wall chargers and adapters from the GoldPlus range. Check each product page for connector type and output details taken from the verified product record.',
        subcategorySlug: 'chargers',
        taxonomyMapped: true,
      },
      {
        slug: 'charging-cables',
        title: 'Charging cables | GoldPlus Uganda',
        h1: 'Charging cables',
        metaDescription:
          'Charging cables from the GoldPlus range in Kampala. USB-C, Micro-USB and Lightning options as stocked, with local delivery.',
        intro:
          'Charging and data cables from the GoldPlus range. Availability varies. This page lists whatever cable stock is live right now.',
        // The live taxonomy has no cables subcategory — flagged, keyword-gathered.
        subcategorySlug: null,
        keywordFilter: ['cable'],
        taxonomyMapped: false,
      },
    ],
  },
  {
    slug: 'audio',
    title: 'Earbuds & headphones | GoldPlus Uganda',
    h1: 'Audio accessories',
    metaDescription:
      'GoldPlus wireless earbuds and headphones from our Wilson Road shop in Kampala, with delivery in Kampala & Wakiso and warranty support.',
    intro: [
      'Earbuds, headphones and other sound devices from the GoldPlus house range, sold from our shop on Wilson Road, Kampala.',
      'Stock levels and prices on this page are live. Delivery is available in Kampala & Wakiso, or collect from the shop.',
    ],
    categorySlug: 'sound-devices',
    taxonomyMapped: true,
    buyingCriteria: [
      {
        heading: 'Earbuds vs headphones',
        body: 'True-wireless earbuds are small and pocketable but have smaller batteries; over-ear headphones are bulkier and usually last longer per charge. Which suits you depends on how and where you listen.',
      },
      {
        heading: 'Battery life claims',
        body: 'Quoted playtimes are measured at moderate volume; real-world use at high volume is shorter. We list only the figures from each product’s verified record.',
      },
      {
        heading: 'Fit and controls',
        body: 'Check whether a product uses touch or button controls and what ear-tip sizes are included. Details are on each product page where recorded.',
      },
    ],
    faqs: [DELIVERY_FAQ, WARRANTY_FAQ, SHOP_FAQ],
    releaseGate: GATE,
    children: [
      {
        slug: 'wireless-earbuds',
        title: 'Wireless earbuds | GoldPlus Uganda',
        h1: 'Wireless earbuds',
        metaDescription:
          'GoldPlus wireless earbuds in stock in Kampala. Live prices and stock from our Wilson Road shop, delivery in Kampala & Wakiso.',
        intro: 'Wireless earbuds from the GoldPlus range, listed from live stock.',
        subcategorySlug: 'earbuds',
        taxonomyMapped: true,
      },
      {
        slug: 'headphones',
        title: 'Headphones | GoldPlus Uganda',
        h1: 'Headphones',
        metaDescription:
          'Headphones from the GoldPlus range in Kampala. Current stock listed live, with delivery in Kampala & Wakiso or shop pickup.',
        intro: 'Headphones from the GoldPlus range. This page lists whatever headphone stock is live right now.',
        // The live taxonomy folds headphones into the earbuds subcategory —
        // no dedicated subcategory exists, so this child is keyword-gathered.
        subcategorySlug: null,
        keywordFilter: ['headphone'],
        taxonomyMapped: false,
      },
    ],
  },
  {
    slug: 'storage',
    title: 'Flash drives & memory cards | GoldPlus Uganda',
    h1: 'Storage devices',
    metaDescription:
      'GoldPlus USB flash drives and memory cards from our Kampala shop on Wilson Road, with delivery in Kampala & Wakiso.',
    intro: [
      'USB flash drives and memory cards from the GoldPlus range, sold from our shop on Wilson Road, Kampala with delivery in Kampala & Wakiso.',
    ],
    categorySlug: 'storage-devices',
    taxonomyMapped: true,
    buyingCriteria: [
      {
        heading: 'How much storage do you need?',
        body: 'Documents and photos need far less space than video. As a rough guide, 1 GB holds hundreds of photos or documents, while an hour of HD video can take several gigabytes.',
      },
      {
        heading: 'Flash drive vs memory card',
        body: 'A USB flash drive plugs straight into a computer’s USB port; a memory card (microSD/SD) fits phones, cameras and other devices with a card slot, and needs a reader for computers without one.',
      },
      {
        heading: 'Formatted capacity',
        body: 'All storage devices show slightly less usable space than the advertised size once formatted. This is normal across the industry, not a fault.',
      },
    ],
    faqs: [DELIVERY_FAQ, WARRANTY_FAQ, SHOP_FAQ],
    releaseGate: GATE,
    children: [
      {
        slug: 'usb-flash-drives',
        title: 'USB flash drives | GoldPlus Uganda',
        h1: 'USB flash drives',
        metaDescription:
          'GoldPlus USB flash drives in stock in Kampala. Live capacities and prices from our Wilson Road shop, with local delivery.',
        intro: 'USB flash drives from the GoldPlus range, listed from live stock.',
        subcategorySlug: 'flash-drives',
        taxonomyMapped: true,
      },
      {
        slug: 'memory-cards',
        title: 'Memory cards | GoldPlus Uganda',
        h1: 'Memory cards',
        metaDescription:
          'GoldPlus memory cards in Kampala. Live stock and prices from our Wilson Road shop, with delivery in Kampala & Wakiso.',
        intro: 'Memory cards from the GoldPlus range, listed from live stock.',
        subcategorySlug: 'memory-cards',
        taxonomyMapped: true,
      },
    ],
  },
  {
    slug: 'phone-batteries',
    title: 'Phone batteries | GoldPlus Uganda',
    h1: 'Phone batteries',
    metaDescription:
      'Replacement phone batteries from GoldPlus in Kampala. Live stock from our Wilson Road shop, with delivery in Kampala & Wakiso.',
    intro: [
      'Replacement phone batteries from the GoldPlus range, sold from our shop on Wilson Road, Kampala. Everything listed below is live stock.',
    ],
    // The live taxonomy has no dedicated batteries category/subcategory; phone
    // batteries sit under Power Devices — keyword-gathered and flagged.
    categorySlug: 'power-devices',
    keywordFilter: ['battery'],
    taxonomyMapped: false,
    buyingCriteria: [
      {
        heading: 'Match the exact model',
        body: 'Phone batteries are model-specific. Check the battery model printed on your current battery or your phone’s model number and match it against the product listing before ordering.',
      },
      {
        heading: 'Capacity (mAh)',
        body: 'The mAh rating tells you how much charge the battery holds. A replacement should normally match your original battery’s rating; the figure for each product is on its page.',
      },
    ],
    faqs: [DELIVERY_FAQ, WARRANTY_FAQ, SHOP_FAQ],
    releaseGate: GATE,
    children: [],
  },
  {
    slug: 'computer-accessories',
    title: 'Computer accessories | GoldPlus Uganda',
    h1: 'Computer accessories',
    metaDescription:
      'GoldPlus computer accessories. Mice, sound cards and more from our Wilson Road shop in Kampala, with delivery in Kampala & Wakiso.',
    intro: [
      'Computer and PC accessories from the GoldPlus range, sold from our shop on Wilson Road, Kampala with delivery in Kampala & Wakiso.',
    ],
    categorySlug: 'pc-accessories',
    taxonomyMapped: true,
    buyingCriteria: [
      {
        heading: 'Check the connection type',
        body: 'PC accessories connect over USB-A, USB-C or wirelessly. Check which ports your computer has before choosing. Many laptops now carry only USB-C ports.',
      },
    ],
    faqs: [DELIVERY_FAQ, WARRANTY_FAQ, SHOP_FAQ],
    releaseGate: GATE,
    children: [],
  },
  {
    slug: 'car-accessories',
    title: 'Car accessories | GoldPlus Uganda',
    h1: 'Car accessories',
    metaDescription:
      'GoldPlus car accessories. Car chargers, mounts and Bluetooth kits from our Kampala shop, with delivery in Kampala & Wakiso.',
    intro: [
      'Car chargers, phone mounts and in-car accessories from the GoldPlus range, sold from our shop on Wilson Road, Kampala.',
    ],
    categorySlug: 'car-accessories',
    taxonomyMapped: true,
    buyingCriteria: [
      {
        heading: 'Car chargers and sockets',
        body: 'Car chargers plug into the 12V accessory socket. Check the output ports (USB-A / USB-C) against the cable your phone uses.',
      },
      {
        heading: 'Mount types',
        body: 'Phone mounts attach to the dashboard, windscreen or air vent. Which works best depends on your car’s layout. Details for each mount are on its product page.',
      },
    ],
    faqs: [DELIVERY_FAQ, WARRANTY_FAQ, SHOP_FAQ],
    releaseGate: GATE,
    children: [],
  },
];

/** All hub slugs, for route guarding. */
export function isHubSlug(slug: string): boolean {
  return CATEGORY_HUBS.some((h) => h.slug === slug);
}

export function getHub(slug: string): CategoryHubConfig | undefined {
  return CATEGORY_HUBS.find((h) => h.slug === slug);
}

export function getHubChild(hub: CategoryHubConfig, childSlug: string): HubChildConfig | undefined {
  return hub.children.find((c) => c.slug === childSlug);
}

// ---------------------------------------------------------------------------
// Product mapping (pure — unit tested)
// ---------------------------------------------------------------------------

function matchesKeywords(product: ProductPublicDto, keywords: string[] | undefined): boolean {
  if (!keywords || keywords.length === 0) return true;
  const haystack = product.name.toLowerCase();
  return keywords.some((k) => haystack.includes(k.toLowerCase()));
}

/** Products belonging to a hub, from an already-cleaned catalogue. */
export function productsForHub(
  hub: CategoryHubConfig,
  products: ProductPublicDto[],
  taxonomy: Taxonomy = DEFAULT_TAXONOMY,
): ProductPublicDto[] {
  const categoryName = hub.categorySlug ? categoryNameForSlug(hub.categorySlug, taxonomy) : '';
  return products.filter((p) => {
    if (categoryName && p.categoryName !== categoryName) return false;
    if (!categoryName && hub.categorySlug) return false; // slug not in live taxonomy
    return matchesKeywords(p, hub.keywordFilter);
  });
}

/** Products belonging to a child hub (narrows the parent's product set). */
export function productsForHubChild(
  hub: CategoryHubConfig,
  child: HubChildConfig,
  products: ProductPublicDto[],
  taxonomy: Taxonomy = DEFAULT_TAXONOMY,
): ProductPublicDto[] {
  const parentProducts = productsForHub(hub, products, taxonomy);
  return parentProducts.filter((p) => {
    if (child.subcategorySlug) return getProductSubcategory(p, taxonomy) === child.subcategorySlug;
    return matchesKeywords(p, child.keywordFilter);
  });
}

// ---------------------------------------------------------------------------
// Release gates (pure — unit tested)
// ---------------------------------------------------------------------------

export interface GateResult {
  pass: boolean;
  /** In-stock products (with images, when required) counted toward the gate. */
  eligibleCount: number;
}

export function evaluateReleaseGate(products: ProductPublicDto[], gate: ReleaseGateConfig): GateResult {
  const eligible = products.filter((p) => {
    if (p.availability.kind !== 'in_stock') return false;
    if (gate.requireImages && !p.primaryImageUrl) return false;
    return true;
  });
  return { pass: eligible.length >= gate.minProducts, eligibleCount: eligible.length };
}

/**
 * Local-page gate: the Wilson Road / delivery pages are indexable only when
 * business-info actually returns an address and a phone number.
 */
export function evaluateLocalPageGate(info: { addressLine1?: string | null; phoneDisplay?: string | null }): boolean {
  return Boolean(info.addressLine1?.trim()) && Boolean(info.phoneDisplay?.trim());
}

// ---------------------------------------------------------------------------
// Sitemap inclusion (pure — unit tested)
// ---------------------------------------------------------------------------

export function hubPath(hubSlug: string, childSlug?: string): string {
  return childSlug ? `/${hubSlug}/${childSlug}` : `/${hubSlug}`;
}

/**
 * Sitemap paths for gate-passing hubs and children only. A child is listed
 * only when both its own gate AND its parent's gate pass (a noindex parent
 * should not funnel crawl budget into orphaned children).
 */
export function gatePassingHubPaths(
  products: ProductPublicDto[],
  taxonomy: Taxonomy = DEFAULT_TAXONOMY,
  hubs: CategoryHubConfig[] = CATEGORY_HUBS,
): string[] {
  const paths: string[] = [];
  for (const hub of hubs) {
    const hubProducts = productsForHub(hub, products, taxonomy);
    const hubGate = evaluateReleaseGate(hubProducts, hub.releaseGate);
    if (!hubGate.pass) continue;
    paths.push(hubPath(hub.slug));
    for (const child of hub.children) {
      const childProducts = productsForHubChild(hub, child, products, taxonomy);
      if (evaluateReleaseGate(childProducts, hub.releaseGate).pass) paths.push(hubPath(hub.slug, child.slug));
    }
  }
  return paths;
}

/** The two local pages, sitemap-listed only when the business-info gate passes. */
export function localPagePaths(info: { addressLine1?: string | null; phoneDisplay?: string | null }): string[] {
  return evaluateLocalPageGate(info) ? ['/locations/wilson-road', '/delivery/kampala-wakiso'] : [];
}

/**
 * Does any shown product carry a verified warranty fact? Drives whether the
 * warranty FAQ renders — we never claim a warranty period the data does not.
 */
export function hasVerifiedWarrantyFact(products: ProductPublicDto[]): boolean {
  return products.some(
    (p) =>
      Object.keys(p.verifiedSpecs ?? {}).some((k) => k.toLowerCase().includes('warranty')) ||
      (p.attributeValues ?? []).some((a) => a.isVerified && a.name.toLowerCase().includes('warranty')),
  );
}
