/**
 * Homepage marketing content shown below the hero — the trust strip and the
 * business-pathway cards. One admin-editable JSONB document (homepage_content
 * singleton); DEFAULT_HOMEPAGE_CONTENT is the seed + SSR fallback. Icons and card
 * button styling stay in code (keyed / by position); the copy is editable.
 */
export interface HomeTrustItem {
  /** Icon key mapped to a code SVG (shield | clipboard | support). */
  iconKey: string;
  title: string;
  body: string;
}

export interface HomeWhatsappChannel {
  heading: string;
  body: string;
}

export interface HomeFooterLink {
  label: string;
  href: string;
}

export interface HomeFooterColumn {
  heading: string;
  links: HomeFooterLink[];
}

/** Footer copy + links (0114 extension). Layout, icons and payment logos stay in code. */
export interface HomeFooter {
  columns: HomeFooterColumn[];
  legalLinks: HomeFooterLink[];
  attribution: HomeFooterLink;
  paymentHeading: string;
  copyrightNotice: string;
  visitHeading: string;
  openHeading: string;
}

export interface HomePathwayCard {
  title: string;
  body: string;
  ctaLabel: string;
  href: string;
}

export type HomeAmbassadorRole = 'AMBASSADOR' | 'MODEL';
export const HOME_AMBASSADOR_ROLES: readonly HomeAmbassadorRole[] = ['AMBASSADOR', 'MODEL'];
export const HOME_AMBASSADOR_ROLE_LABEL: Record<HomeAmbassadorRole, string> = { AMBASSADOR: 'GoldPlus ambassador', MODEL: 'GoldPlus model' };
/** Most people the section holds (the owner plans eight). */
export const HOME_AMBASSADORS_MAX = 12;

/** A portrait resolved from the media library at save time: the renditions the page serves, never the multi-megabyte original. */
export interface HomeAmbassadorImage {
  assetId: string;
  src: string;
  srcset: string | null;
  width: number | null;
  height: number | null;
}

/**
 * A real person photographed with a GoldPlus product. Only people with a signed
 * photo release on file AND published are ever sent to the storefront; everything
 * shown is what the owner entered (no invented quotes, no stand-in people).
 */
export interface HomeAmbassador {
  id: string;
  name: string;
  role: HomeAmbassadorRole;
  /** One short line under the name, in the owner's words. Empty: the product held is shown instead. */
  tagline: string;
  image: HomeAmbassadorImage | null;
  imageAlt: string;
  /** The product in the photo; the card links to it. Empty: the card does not link. */
  productSlug: string;
  releaseOnFile: boolean;
  /** Who confirmed the signed release, and when (set by the API when the box is ticked; admin-only, never public). */
  releaseConfirmedBy: string | null;
  releaseConfirmedAt: string | null;
  published: boolean;
}

/** What the storefront receives for a person: only what the card shows. */
export interface HomeAmbassadorPublic {
  id: string;
  name: string;
  role: HomeAmbassadorRole;
  tagline: string;
  image: { src: string; srcset: string | null; width: number | null; height: number | null };
  imageAlt: string;
  productSlug: string;
}

export interface HomeAmbassadors {
  heading: string;
  intro: string;
  ctaLabel: string;
  ctaHref: string;
  people: HomeAmbassador[];
}

export interface HomepageContent {
  trustItems: HomeTrustItem[];
  pathwayCards: HomePathwayCard[];
  /** Footer WhatsApp channel block copy (0114 extension). Editable; icon/CTA stay in code. */
  whatsappChannel: HomeWhatsappChannel;
  /** Footer copy + link columns (0114 extension). */
  footer: HomeFooter;
  /** Ambassadors & models section above the footer. Hidden while no one is published. */
  ambassadors: HomeAmbassadors;
}

/** The ambassadors section as the storefront receives it (see HomeAmbassadorPublic). */
export interface HomeAmbassadorsPublic {
  heading: string;
  intro: string;
  ctaLabel: string;
  ctaHref: string;
  people: HomeAmbassadorPublic[];
}

/** The homepage document as the PUBLIC endpoint serves it: the ambassadors reduced to what cards show. */
export type PublicHomepageContent = Omit<HomepageContent, 'ambassadors'> & { ambassadors: HomeAmbassadorsPublic };

export const HOME_TRUST_ICON_KEYS = ['shield', 'clipboard', 'support'] as const;

export const DEFAULT_HOMEPAGE_CONTENT: HomepageContent = {
  trustItems: [
    {
      iconKey: 'shield',
      title: "Check it's real in seconds",
      body: "Every product carries a code you can verify online. If it doesn't check out, it isn't from us.",
    },
    {
      iconKey: 'clipboard',
      title: 'The spec you read is the spec you get',
      body: "If a detail isn't verified, we mark it missing. We would rather leave a gap than fill it to close a sale.",
    },
    {
      iconKey: 'support',
      title: 'A real person in Kampala',
      body: 'Message our team on WhatsApp and reach a person, not a queue. Report a fake and we act on it.',
    },
  ],
  whatsappChannel: {
    heading: 'New at GoldPlus',
    body: 'New arrivals, restocks and offers — straight from GoldPlus.',
  },
  footer: {
    columns: [
      { heading: 'Shop', links: [
        { label: 'Power', href: '/shop?category=power' },
        { label: 'Sound', href: '/shop?category=sound' },
        { label: 'Storage', href: '/shop?category=storage' },
        { label: 'Car', href: '/shop?category=car' },
        { label: 'PC', href: '/shop?category=pc' },
        { label: 'Shop all', href: '/shop' },
        { label: 'Find the right product', href: '/product-finder' },
        { label: 'Guides & advice', href: '/blog' },
      ] },
      { heading: 'Buying', links: [
        { label: 'Your cart', href: '/cart' },
        { label: 'Checkout', href: '/checkout' },
        { label: 'Track your order', href: '/track-order' },
        { label: 'Request a quote', href: '/quote-request' },
        { label: 'GoldPlus Rewards', href: '/loyalty' },
        { label: 'Become a dealer', href: '/dealers/apply' },
      ] },
      { heading: 'Account', links: [
        { label: 'My account', href: '/account' },
        { label: 'Your orders', href: '/account/orders' },
        { label: 'Saved addresses', href: '/account/addresses' },
        { label: 'Points & rewards', href: '/account/loyalty' },
        { label: 'Sign in', href: '/login' },
        { label: 'Create an account', href: '/register' },
      ] },
      { heading: 'Help', links: [
        { label: 'Verify a product', href: '/verification' },
        { label: 'Questions and answers', href: '/faq' },
        { label: 'Get support', href: '/support' },
        { label: 'Report an issue', href: '/support/issue' },
        { label: 'Report a counterfeit', href: '/support/fake' },
        { label: 'Your preferences', href: '/preferences' },
      ] },
    ],
    legalLinks: [
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Preferences', href: '/preferences' },
      { label: 'Terms of sale', href: '/terms' },
      { label: 'Returns', href: '/returns' },
      { label: 'Warranty', href: '/warranty' },
      { label: 'Cookies', href: '/cookies' },
    ],
    attribution: { label: 'Built by Ten-X Africa', href: 'https://www.tenxafrica.com' },
    paymentHeading: 'Pay how you already pay',
    copyrightNotice: 'GoldPlus. All rights reserved.',
    visitHeading: 'Visit the shop',
    openHeading: 'Open',
  },
  pathwayCards: [
    {
      title: 'Shopping for yourself',
      body: 'Genuine electronics you can verify. Before you pay, and again the day they arrive.',
      ctaLabel: 'Start shopping',
      href: '/shop',
    },
    {
      title: 'Selling to your customers',
      body: 'Stock originals your buyers can trust, with the codes to prove it. Apply to become an authorised GoldPlus dealer.',
      ctaLabel: 'Become a dealer',
      href: '/dealers/apply',
    },
    {
      title: 'Buying for a team',
      body: 'Fitting out an office or a fleet? Get a wholesale quote built around your exact spec.',
      ctaLabel: 'Get a quote',
      href: '/quote-request?kind=corporate',
    },
  ],
  ambassadors: {
    heading: 'Powered by GoldPlus',
    intro: '',
    ctaLabel: 'Shop all products',
    ctaHref: '/shop',
    people: [],
  },
};

/** The default as the public endpoint serves it (no people until the owner publishes some). */
export const DEFAULT_PUBLIC_HOMEPAGE_CONTENT: PublicHomepageContent = {
  ...DEFAULT_HOMEPAGE_CONTENT,
  ambassadors: { ...DEFAULT_HOMEPAGE_CONTENT.ambassadors, people: [] },
};
