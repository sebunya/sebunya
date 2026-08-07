/**
 * The canonical 12-slide hero library (2026-08-07).
 *
 * ONE source of truth for the slides, used by three things that must never
 * drift apart: the boot seed (so a fresh or production database always has the
 * library), the storefront's SSR fallback (so the hero is never blank even if
 * the API is unreachable), and the tests.
 *
 * The copy here is the initial migration content, verbatim from the approved
 * reference build. After seeding it belongs to marketing via the CMS — the
 * seed is idempotent on slide_key and never overwrites an operator's edit.
 *
 * `slideKey` is LOCKED. The client engine keys its eligibility and scoring off
 * it (LIB[id]); renaming one silently drops a campaign from personalisation.
 */

export const HERO_THEMES = ['offer', 'logistics', 'loyalty', 'product', 'brand', 'trust'] as const;
export type HeroTheme = (typeof HERO_THEMES)[number];

export const HERO_TINTS = ['a', 'b', 'c', 'd'] as const;
export type HeroTint = (typeof HERO_TINTS)[number];

export const HERO_MEDIA = ['stage', 'bleed', 'card'] as const;
export type HeroMedia = (typeof HERO_MEDIA)[number];

export interface HeroSlideSeed {
  slideKey: string;
  position: number;
  enabled: boolean;
  theme: HeroTheme;
  tint: HeroTint;
  media: HeroMedia;
  kicker: string;
  /** May contain <em>…</em> accent wrapping ONLY; everything else is escaped on render. */
  headline: string;
  subcopy: string;
  ctaLabel: string;
  ctaUrl: string;
  finePrint: string;
  /** Media-library URL (bleed) or product image URL (stage). Empty = use fallback/none. */
  imageUrl: string;
  imageAlt: string;
  priority: number;
  /** Per-slide campaign data — see HeroSlideValidation for the per-key shapes. */
  extras: Record<string, unknown>;
}

export interface HeroSettingsSeed {
  slidesShown: number;
  dwellMs: number;
  autoplay: boolean;
}

export const HERO_SETTINGS_DEFAULT: HeroSettingsSeed = {
  slidesShown: 4,
  dwellMs: 6000,
  autoplay: true,
};

/** Product cut-out images for stage slides — real GoldPlus catalogue shots. */
const P = (slug: string) => `https://shopgoldplus.com/products/${slug}.webp`;

export const HERO_SLIDE_LIBRARY: readonly HeroSlideSeed[] = [
  {
    slideKey: 'flash', position: 1, enabled: true, theme: 'offer', tint: 'a', media: 'stage',
    kicker: 'Flash sale · ends soon',
    headline: 'Up to <em>40% off</em> power banks',
    subcopy: '',
    ctaLabel: 'Shop the flash sale', ctaUrl: '/shop?promo=flash-sale',
    finePrint: 'Same verified stock. Less money, for now.',
    imageUrl: P('goldplus-magnetic-power-bank-gp-03'),
    imageAlt: 'GoldPlus magnetic power bank',
    priority: 0,
    extras: { saleEndsIso: '2026-08-09T23:59:59+03:00', originalPriceUgx: 185000, salePriceUgx: 111000, savePct: 40 },
  },
  {
    slideKey: 'welcome', position: 2, enabled: true, theme: 'offer', tint: 'c', media: 'stage',
    kicker: 'First time here',
    headline: "<em>10% off</em>, because you don't know us yet",
    subcopy: 'Fair enough. Buy one thing with the code below and judge us on how it holds up.',
    ctaLabel: 'Start with one', ctaUrl: '/shop?promo=WELCOME10',
    finePrint: 'First order only · One use per customer',
    imageUrl: P('goldplus-built-in-cable-power-bank-gp-pd-w3'),
    imageAlt: 'GoldPlus built-in cable power bank',
    priority: 0,
    extras: { promoCode: 'WELCOME10' },
  },
  {
    slideKey: 'referral', position: 3, enabled: true, theme: 'loyalty', tint: 'c', media: 'stage',
    kicker: 'Welcome back',
    headline: 'Give <em>10%</em>, get <em>10%</em>',
    subcopy: 'Someone you know has been sold a fake. Send them here — they save 10% on their first order, you earn 10% on your next.',
    ctaLabel: 'Get your link', ctaUrl: '/account/referrals',
    finePrint: 'Credited when their order ships · No cap on referrals',
    imageUrl: P('goldplus-digital-display-power-bank-gp-p07'),
    imageAlt: 'GoldPlus digital display power bank',
    priority: 0,
    extras: {},
  },
  {
    slideKey: 'sameday', position: 4, enabled: true, theme: 'logistics', tint: 'b', media: 'stage',
    kicker: 'Same-day delivery',
    headline: 'Order by 5pm. <em>Charged tonight.</em>',
    subcopy: 'Kampala and Wakiso the same day. Everywhere else, the next.',
    ctaLabel: 'Shop for today', ctaUrl: '/shop',
    finePrint: 'Cut-off 5:00pm, Monday to Saturday',
    imageUrl: P('goldplus-power-bank-with-handle-gp-x03'),
    imageAlt: 'GoldPlus power bank with carry handle',
    priority: 0,
    extras: { cutoffHour: 17 },
  },
  {
    slideKey: 'fees', position: 5, enabled: true, theme: 'logistics', tint: 'd', media: 'stage',
    kicker: 'Delivery, priced upfront',
    headline: 'No haggling with the <em>boda guy</em>',
    subcopy: 'You see the fee before you pay. We settle the rider. You just open the door.',
    ctaLabel: 'See delivery rates', ctaUrl: '/support/delivery',
    finePrint: 'Indicative rates · Exact fee shown at checkout',
    imageUrl: P('goldplus-100w-portable-power-station-gp-09'),
    imageAlt: 'GoldPlus 100W portable power station',
    priority: 0,
    extras: {
      fees: [
        { amount: 'UGX 5,000', label: 'City centre' },
        { amount: 'UGX 8,000', label: 'Greater Kampala' },
        { amount: 'Quoted', label: 'Upcountry' },
      ],
    },
  },
  {
    slideKey: 'ambassador', position: 6, enabled: true, theme: 'brand', tint: 'a', media: 'bleed',
    kicker: 'Carried every day',
    headline: 'The people you know <em>already carry it</em>',
    subcopy: "Musicians, riders, traders, students. The ones who can't afford a battery that lies to them.",
    ctaLabel: 'Meet them', ctaUrl: '/shop',
    finePrint: 'Real customers · Real daily use',
    imageUrl: '/hero/ambassador.jpg',
    imageAlt: 'GoldPlus product in everyday use',
    priority: 0,
    extras: {},
  },
  {
    slideKey: 'newarrivals', position: 7, enabled: true, theme: 'product', tint: 'b', media: 'bleed',
    kicker: 'Just landed',
    headline: 'New this month, <em>verified on arrival</em>',
    subcopy: 'Every new line is opened, tested and coded before it reaches the shelf.',
    ctaLabel: "See what's new", ctaUrl: '/shop?sort=newest',
    finePrint: 'Restocked weekly',
    imageUrl: '/hero/new-arrivals.jpg',
    imageAlt: 'GoldPlus power bank charging a phone and laptop on a train table',
    priority: 0,
    extras: {},
  },
  {
    slideKey: 'range', position: 8, enabled: true, theme: 'product', tint: 'd', media: 'bleed',
    kicker: 'The full range',
    headline: 'Power, sound, storage, <em>car</em>',
    subcopy: "One shop, one standard. If we wouldn't use it, we don't stock it.",
    ctaLabel: 'Browse everything', ctaUrl: '/shop',
    finePrint: 'Five families · One verification promise',
    imageUrl: '/hero/range.jpg',
    imageAlt: 'The GoldPlus range in everyday use',
    priority: 0,
    extras: {},
  },
  {
    slideKey: 'loyalty', position: 9, enabled: true, theme: 'loyalty', tint: 'b', media: 'stage',
    kicker: 'GoldPlus rewards',
    headline: 'Every shilling <em>earns its way back</em>',
    subcopy: 'Points on every order, member pricing, and every warranty you own in one place.',
    ctaLabel: 'Join free', ctaUrl: '/loyalty',
    finePrint: 'Free to join · Points never expire',
    imageUrl: P('goldplus-100w-portable-power-station-gp-09'),
    imageAlt: 'GoldPlus 100W portable power station',
    priority: 0,
    extras: { points: 1700, goalLabel: '800 to Gold' },
  },
  {
    slideKey: 'scratch', position: 10, enabled: true, theme: 'offer', tint: 'd', media: 'card',
    kicker: 'Scratch & save',
    headline: 'Scratch to reveal <em>your price</em>',
    subcopy: 'One scratch, one member discount. Reveal it, then keep it with a free rewards account.',
    ctaLabel: 'Join to claim', ctaUrl: '/loyalty',
    finePrint: 'One scratch per visitor',
    imageUrl: '',
    imageAlt: '',
    priority: 0,
    extras: {
      prizes: [
        { pct: 5, code: 'GP5', w: 45 },
        { pct: 10, code: 'GP10', w: 32 },
        { pct: 15, code: 'GP15', w: 18 },
        { pct: 20, code: 'GP20', w: 5 },
      ],
    },
  },
  {
    slideKey: 'nostories', position: 11, enabled: true, theme: 'trust', tint: 'a', media: 'stage',
    kicker: 'The no stories campaign',
    headline: 'No stories. <em>Just real specs.</em>',
    subcopy: 'If a capacity isn’t verified, we say so on the page. Real numbers, real warranty, a real person on the phone.',
    ctaLabel: 'Read the promise', ctaUrl: '/verification',
    finePrint: 'Verified capacity · Report a counterfeit',
    imageUrl: P('goldplus-digital-display-power-bank-gp-p07'),
    imageAlt: 'GoldPlus digital display power bank',
    priority: 0,
    extras: {},
  },
  {
    slideKey: 'authentic', position: 12, enabled: true, theme: 'trust', tint: 'c', media: 'stage',
    kicker: 'Guaranteed authenticity',
    headline: '<em>Verified</em> original electronics',
    subcopy: 'Every unit carries a code you can check before you trust it. Built for how Uganda actually uses power.',
    ctaLabel: 'Shop all products', ctaUrl: '/shop',
    finePrint: 'Originality verified · Direct local support',
    imageUrl: P('goldplus-power-bank-with-handle-gp-x03'),
    imageAlt: 'GoldPlus power bank with carry handle',
    priority: 0,
    extras: {},
  },
];

/** The evergreen slide the hero falls back to if everything is disabled (§2.5). */
export const HERO_FALLBACK_KEY = 'authentic';
