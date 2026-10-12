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
  /**
   * Lowercase words that EXCLUDE a product from this child even when its
   * subcategory matches: the taxonomy folds wired earphones into "earbuds",
   * so the wireless page says which names do not belong (copy handoff
   * 2026-10-12, UX-02).
   */
  excludeKeywords?: string[];
  /** False when the live taxonomy has no subcategory for this child. */
  taxonomyMapped: boolean;
}

/** An entry tile on a hub that points outside its own children (e.g. /power → /phone-batteries). */
export interface HubTile {
  label: string;
  href: string;
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
  /** Extra entry tiles shown with the children (a related range that lives at its own URL). */
  extraTiles?: HubTile[];
}

/** Superlatives and claims we never publish — enforced by unit test. */
export const BANNED_PHRASES: readonly string[] = ['best in Uganda', '#1', 'guaranteed cheapest', 'five star'];

const GATE = DEFAULT_RELEASE_GATE;

const DELIVERY_FAQ: HubFaq = { question: 'Do you deliver in Kampala and Wakiso?', source: 'delivery' };
const WARRANTY_FAQ: HubFaq = { question: 'Is there a warranty on these products?', source: 'warranty' };
const SHOP_FAQ: HubFaq = {
  question: 'Where is the GoldPlus shop?',
  answer:
    'The GoldPlus shop is on the 4th floor of the Zainab Aziza Building, Burton Street, central Kampala, opposite Pioneer Mall. You can buy online on this site or visit the shop in person. Contact details and directions are in the footer of every page.',
};

/**
 * Hub copy follows the website copy handoff of 2026-10-12: a specific subject
 * first and the brand once in the title; an intro that tells the shopper what
 * to check (connector, output, capacity, fit) rather than what to feel; no
 * promise the catalogue cannot keep (no mounts, no charge counts, no "tested").
 */
export const CATEGORY_HUBS: CategoryHubConfig[] = [
  {
    slug: 'power',
    title: 'Power Banks, Chargers & Cables | GoldPlus Uganda',
    h1: 'Power and charging accessories',
    metaDescription:
      'Compare power banks, wall chargers and cables by connection and use. Looking for a phone battery? Check the exact model before ordering.',
    intro: [
      'Start with the device you want to charge. A wall charger supplies power, a cable connects it, and a power bank stores energy for use away from a socket. Choose the connection first, then compare the specifications that apply to your device.',
      'Replacement phone batteries have their own page, so a shopper looking for a cable does not have to scroll past the battery range. Prices and stock on every card are live.',
    ],
    categorySlug: 'power-devices',
    taxonomyMapped: true,
    buyingCriteria: [
      {
        heading: 'Capacity (mAh) and energy (Wh)',
        body: 'A power bank’s mAh figure is a capacity label stated at the voltage of its cells. To compare energy, use watt-hours where the package prints them (volts × amp-hours). Some energy is lost in conversion, so the number of phone charges depends on the phone, the cable and how both are used; a capacity figure alone does not promise a fixed count.',
      },
      {
        heading: 'Ports and connectors',
        body: 'Check which connector your phone uses (USB-C, Micro-USB or Lightning) and which ports the charger or power bank offers. On a charger with several ports, the output for one port can change when more than one device is connected; read the rating for the port you will use.',
      },
      {
        heading: 'What is in the box',
        body: 'Kits differ in whether a cable is included. Check the individual product page. We list what each product actually comes with, and if a detail is missing from a listing we say so rather than guess.',
      },
    ],
    faqs: [DELIVERY_FAQ, WARRANTY_FAQ, SHOP_FAQ],
    releaseGate: GATE,
    extraTiles: [{ label: 'Phone batteries', href: '/phone-batteries' }],
    children: [
      {
        slug: 'power-banks',
        title: 'Power Banks & Portable Charging | GoldPlus Uganda',
        h1: 'Power banks',
        metaDescription:
          'Compare GoldPlus power banks by connections, built-in leads and charging features. Check the exact model and labelled capacity before choosing.',
        intro:
          'Choose portable power around the devices you carry. Compare the input and output connections, built-in leads, any wireless charging and the capacity stated for the exact model. A larger capacity number does not mean faster charging or a fixed number of phone recharges.',
        subcategorySlug: 'power-banks',
        taxonomyMapped: true,
      },
      {
        slug: 'chargers',
        title: 'Phone Chargers & USB-C Wall Chargers | GoldPlus',
        h1: 'Phone chargers',
        metaDescription:
          'Compare GoldPlus wall chargers by connection, port layout and supported output. Check your device and cable, then confirm the exact kit.',
        intro:
          'Compare wall chargers by their ports, supported charging modes and listed output. On a charger with several ports, the available power may be shared when more than one device is connected. Check the exact kit to see whether a cable is included, and send us the device model if you are unsure which charger and cable to pair.',
        subcategorySlug: 'chargers',
        taxonomyMapped: true,
      },
      {
        slug: 'charging-cables',
        title: 'USB-C, Lightning & Micro-USB Cables | GoldPlus',
        h1: 'Charging cables: match both ends',
        metaDescription:
          'Choose a cable by the ports on your charger and device. Compare USB-C, Lightning and Micro-USB variants and available lengths at GoldPlus.',
        intro:
          'A cable needs to fit at both ends. Choose the connector on your charger or computer, then the connector on your device, and compare lengths for your desk, bedside or travel bag. Charging current and data-transfer speed are separate specifications: a 3A rating describes current, not a USB data standard.',
        // The live taxonomy has no cables subcategory — flagged, keyword-gathered.
        subcategorySlug: null,
        keywordFilter: ['cable'],
        taxonomyMapped: false,
      },
    ],
  },
  {
    slug: 'audio',
    title: 'Earbuds, Earphones & Audio Accessories | GoldPlus',
    h1: 'Choose how you listen',
    metaDescription:
      'Compare GoldPlus wired and wireless audio by connection, fit and controls. Check the exact model and device compatibility before ordering.',
    intro: [
      'Choose how you want to listen: a wired connection, wireless earbuds with a charging case, or an open-ear design. Check the fit, the device connection and the controls before comparing optional features.',
      'Stock levels and prices on this page are live. Delivery is available in Kampala and Wakiso, or collect from the shop.',
    ],
    categorySlug: 'sound-devices',
    taxonomyMapped: true,
    buyingCriteria: [
      {
        heading: 'Wired or wireless',
        body: 'Wired earphones connect directly to a compatible audio port; check whether your device needs a 3.5mm plug or USB-C. Wireless sets need a compatible Bluetooth connection and their own charging arrangements, usually a case with its own charging port.',
      },
      {
        heading: 'Listening time',
        body: 'Runtime depends on the model and on how it is used; listening at high volume is shorter than the figure on the box. We list only the figure recorded for each product, and nothing where the record does not give one.',
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
        title: 'Wireless Earbuds in Uganda | GoldPlus',
        h1: 'Wireless earbuds',
        metaDescription:
          'Explore wireless earbuds by fit, case design and charging connection. Compare confirmed details for the exact GoldPlus model you choose.',
        intro:
          'Compare the fit and the case-charging connection of the wireless sets in stock. Runtime depends on the model and on use; check the product details rather than assuming every pair lasts the same length of time.',
        subcategorySlug: 'earbuds',
        // The taxonomy folds wired earphones into "earbuds": keep them on the audio hub, off this page.
        excludeKeywords: ['wired', '3.5mm'],
        taxonomyMapped: true,
      },
      {
        slug: 'headphones',
        title: 'Headphones & Listening Designs | GoldPlus',
        h1: 'Headphones',
        metaDescription:
          'Browse identified headphone designs and check the fit and connection. Ask GoldPlus about available models before choosing.',
        intro: 'Headphone designs from the GoldPlus range, listed from live stock. Check the fit and the connection on each product page, and ask the team about available models before choosing.',
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
    title: 'USB Flash Drives & microSD Cards | GoldPlus Uganda',
    h1: 'Storage for compatible devices',
    metaDescription:
      'Compare USB flash drives and microSD cards by capacity and device connection. Check compatibility and keep another copy of important files.',
    intro: [
      'Choose storage by the device you will use it with. USB flash drives connect through a compatible USB port; microSD cards need a supported card slot or a reader. Check the capacity and the recording-speed requirement of your device, and keep another copy of important files.',
    ],
    categorySlug: 'storage-devices',
    taxonomyMapped: true,
    buyingCriteria: [
      {
        heading: 'How much storage do you need?',
        body: 'Documents and photos need far less space than video. As a rough guide, 1 GB holds hundreds of photos or documents, while an hour of HD video can take several gigabytes. Choose a capacity your device supports; the device manual lists the maximum.',
      },
      {
        heading: 'Flash drive or memory card',
        body: 'A USB flash drive plugs straight into a computer’s USB port; a microSD card fits phones, cameras and other devices with a card slot, and needs a reader for computers without one. A camera may also require a particular recording-speed class; capacity alone does not establish suitability.',
      },
      {
        heading: 'Formatted capacity',
        body: 'Every storage device shows slightly less usable space than the size printed on the package once it is formatted. This is normal across the industry, not a fault. Ask us about the checks available for a card before you buy.',
      },
    ],
    faqs: [DELIVERY_FAQ, WARRANTY_FAQ, SHOP_FAQ],
    releaseGate: GATE,
    children: [
      {
        slug: 'usb-flash-drives',
        title: 'USB Flash Drives & Flash Disks | GoldPlus Uganda',
        h1: 'USB flash drives',
        metaDescription:
          'Browse USB flash drives by capacity and check the connector your device uses. Compare current GoldPlus options and back up important files.',
        intro: 'USB flash drives (flash disks) from the GoldPlus range, listed from live stock. Check the connector your device uses and the capacity it supports.',
        subcategorySlug: 'flash-drives',
        taxonomyMapped: true,
      },
      {
        slug: 'memory-cards',
        title: 'microSD Memory Cards | GoldPlus Uganda',
        h1: 'microSD memory cards',
        metaDescription:
          'Choose a microSD card your device supports. Compare available capacities and check recording-speed requirements before ordering from GoldPlus.',
        intro: 'microSD cards from the GoldPlus range, listed from live stock. Check the card type, the maximum capacity and the recording-speed requirement of your device before ordering.',
        subcategorySlug: 'memory-cards',
        taxonomyMapped: true,
      },
    ],
  },
  {
    slug: 'phone-batteries',
    title: 'Replacement Phone Batteries in Kampala | GoldPlus',
    h1: 'Find the right replacement phone battery',
    metaDescription:
      'Match a replacement battery by exact phone variant and battery code. Browse the GoldPlus range or ask the team to help check the fit.',
    intro: [
      'Match the battery to the phone, not just to a familiar model name. The battery code, the connector and the exact phone variant all matter. If the code on your old battery is already accessible, share it with the team along with the phone model; do not open a sealed phone just to find it.',
    ],
    // The live taxonomy has no dedicated batteries category/subcategory; phone
    // batteries sit under Power Devices — keyword-gathered and flagged.
    categorySlug: 'power-devices',
    keywordFilter: ['battery'],
    taxonomyMapped: false,
    buyingCriteria: [
      {
        heading: 'Match the exact model',
        body: 'Phone batteries are model-specific. Check the battery code printed on your current battery, or your phone’s model number in Settings, and match it against the product listing before ordering. A matching shape, connector appearance or capacity alone does not establish compatibility.',
      },
      {
        heading: 'Rated and typical capacity',
        body: 'Some battery labels print two capacities: a rated value and a typical value. Keep them separate when comparing, and compare like with like. Neither replaces the need to confirm the correct battery model.',
      },
    ],
    faqs: [DELIVERY_FAQ, WARRANTY_FAQ, SHOP_FAQ],
    releaseGate: GATE,
    children: [],
  },
  {
    slug: 'computer-accessories',
    title: 'Computer Accessories: Mouse & Sound Cards | GoldPlus',
    h1: 'Computer accessories',
    metaDescription:
      'Browse the current GoldPlus mouse and USB sound-card range. Check each product connection and compatibility before ordering.',
    intro: [
      'The current GoldPlus computer range: a mouse and USB sound cards, sold from our shop in the Zainab Aziza Building, Kampala, with delivery in Kampala and Wakiso. Check the connection each product uses before ordering.',
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
    title: 'USB Car Chargers | GoldPlus Uganda',
    h1: 'Car chargers',
    metaDescription:
      'Compare GoldPlus car chargers with USB-A and USB-C options. Check the vehicle-socket input and confirmed port output for your phone and cable.',
    intro: [
      'Keep a compatible charging connection in the car. Compare USB-A and USB-C car chargers, then check the vehicle-socket input and the output listed for the port you intend to use. The phone, the cable and the charger must support a compatible charging mode.',
    ],
    categorySlug: 'car-accessories',
    taxonomyMapped: true,
    buyingCriteria: [
      {
        heading: 'Car chargers and sockets',
        body: 'Car chargers plug into the 12V accessory socket. Check the output ports (USB-A or USB-C) against the cable your phone uses, and read the rating for the port you will use rather than a combined figure on the box.',
      },
      {
        heading: 'The cable and the phone decide the speed',
        body: 'A charger with a fast-charging port only charges quickly when the cable and the phone support the same mode. Each product page shows the details recorded for that model; ask us if a rating needs confirming.',
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
    if (child.excludeKeywords?.length && matchesKeywords(p, child.excludeKeywords)) return false;
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
 * Local-page gate: the Zainab Aziza shop / delivery pages are indexable only when
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
  return evaluateLocalPageGate(info) ? ['/locations/zainab-aziza', '/delivery/kampala-wakiso'] : [];
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
