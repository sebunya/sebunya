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

export interface HomePathwayCard {
  title: string;
  body: string;
  ctaLabel: string;
  href: string;
}

export interface HomepageContent {
  trustItems: HomeTrustItem[];
  pathwayCards: HomePathwayCard[];
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
