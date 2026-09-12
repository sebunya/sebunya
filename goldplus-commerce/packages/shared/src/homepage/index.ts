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

export interface HomepageContent {
  trustItems: HomeTrustItem[];
  pathwayCards: HomePathwayCard[];
  /** Footer WhatsApp channel block copy (0114 extension). Editable; icon/CTA stay in code. */
  whatsappChannel: HomeWhatsappChannel;
  /** Footer copy + link columns (0114 extension). */
  footer: HomeFooter;
}

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
};
