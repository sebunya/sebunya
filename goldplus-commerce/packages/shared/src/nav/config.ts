import { HERO_SLIDE_LIBRARY } from '../hero/library';
import type { NavConfig } from './types';

/**
 * DEFAULT_NAV_CONFIG — the single source of truth for the header content, used by
 * BOTH the idempotent boot seed and the SSR fallback (the role HERO_SLIDE_LIBRARY
 * plays for the hero). After seeding it belongs to marketing via the admin editor;
 * the seed is add-only and never overwrites an operator's edits.
 *
 * Three seed-time corrections vs. the previous hardcoded header:
 *  1. The refer-a-friend link is the canonical /account/rewards (the old header
 *     had a /account/account/rewards double-`account` bug).
 *  2. The first-order estimate is ONE field (settings.firstOrderEstimateUgx),
 *     not four duplicated literals.
 *  3. settings.saleEndsIso is DERIVED from the hero flash deadline so the header
 *     countdown can never fork into a second, contradictory clock.
 */

const WA = 'https://wa.me/256705004545';
const WA_BATTERY = 'https://wa.me/256705004545?text=Hi%20GoldPlus%2C%20I%20need%20a%20battery%20for%20my%20';
const FEAT = '/nav/featured-default.png';
const flashSlide = HERO_SLIDE_LIBRARY.find((s) => s.slideKey === 'flash');
// No deadline is typed anywhere any more: the header reads the live promotion
// (/commerce/storefront-discount) and so does the hero. Kept as a field for
// older stored documents; always empty in the seed.
const SALE_ENDS_ISO = '';

const brandChips = [
  { label: 'Tecno', href: '/shop?category=power&q=tecno' },
  { label: 'Infinix', href: '/shop?category=power&q=infinix' },
  { label: 'itel', href: '/shop?category=power&q=itel' },
  { label: 'Samsung', href: '/shop?category=power&q=samsung' },
  { label: 'iPhone', href: '/shop?category=power&q=iphone' },
  { label: 'Redmi', href: '/shop?category=power&q=redmi' },
  { label: 'Xiaomi', href: '/shop?category=power&q=xiaomi' },
  { label: 'Huawei', href: '/shop?category=power&q=huawei' },
  { label: 'Nokia', href: '/shop?category=power&q=nokia' },
  { label: 'Oppo', href: '/shop?category=power&q=oppo' },
  { label: 'All brands →', href: '/shop?category=power&q=battery', style: 'green' as const },
];

// No per-size chips. Twenty capacity links (1GB…512GB, twice) advertised a
// range the catalogue does not hold — eighteen of them landed on "No matching
// products yet". Each row now links to everything of its kind; the sizes in
// stock are whatever the shop page shows.
const caps = () => [] as { label: string; href: string }[];

export const DEFAULT_NAV_CONFIG: NavConfig = {
  contact: {
    phoneDisplay: '0705 004545',
    tel: 'tel:+256705004545',
    telNumber: '+256705004545',
    whatsappUrl: WA,
    whatsappNumber: '256705004545',
    whatsappBatteryPrefill: WA_BATTERY,
    businessHoursNote: '',
    reachCallLabel: 'Call us',
    reachWhatsappLabel: 'WhatsApp',
  },
  brand: {
    logoSrc: '/nav/gp-wordmark-cream.png',
    logoAlt: 'GoldPlus',
    logoHref: '/',
    logoAriaLabel: 'GoldPlus home',
    featuredDefaultImage: FEAT,
  },
  search: {
    formAction: '/shop',
    inputName: 'q',
    placeholderDesktop: 'Search a phone model, a size, or a product…',
    placeholderMobile: 'Search a phone model or product…',
    scanLink: { href: '/verification', ariaLabel: 'Check if a product is genuine' },
    sheetHeadings: { recent: 'Recent', recentClear: 'Clear', trending: 'Trending in Kampala', products: 'Products' },
    footerCtaLabel: 'Ask us on WhatsApp',
    footerCtaHref: WA,
    zeroResultCopy: 'No match for <b>{q}</b>. Try a phone model, a size, or a category, or ask us directly.',
    trendingTerms: [],
  },
  rail: [
    { key: 'all', label: 'Shop All', href: '/shop' },
    { key: 'power', label: 'Power', href: '/shop?category=power' },
    { key: 'sound', label: 'Sound', href: '/shop?category=sound' },
    { key: 'storage', label: 'Storage', href: '/shop?category=storage' },
    { key: 'car', label: 'Car', href: '/shop?category=car' },
    { key: 'pc', label: 'PC', href: '/shop?category=pc' },
    { key: 'flash', label: 'On sale', href: '/shop', tag: 'Live' },
  ],
  panels: [
    {
      key: 'all',
      shape: 'wide',
      tiles: [
        { label: 'Power', descriptor: 'Power banks, chargers, cables', href: '/shop?category=power' },
        { label: 'Sound', descriptor: 'Earbuds and headphones', href: '/shop?category=sound' },
        { label: 'Storage', descriptor: 'Flash drives and memory cards', href: '/shop?category=storage' },
        { label: 'Car', descriptor: 'Chargers and Bluetooth', href: '/shop?category=car' },
        { label: 'PC', descriptor: 'Mouse and sound cards', href: '/shop?category=pc' },
        { label: 'Everything →', descriptor: 'The full range', href: '/shop', variant: 'go' },
      ],
      featColumn: {
        heading: 'Start here',
        rows: [
          { label: 'New this month', href: '/shop' },
          { label: 'Best sellers', href: '/shop' },
          { label: 'Best value picks', href: '/shop' },
          { label: 'How we verify stock', href: '/verification' },
        ],
      },
      featured: null,
    },
    {
      key: 'power',
      shape: 'list',
      heading: 'Power',
      listRows: [
        { label: 'Power banks', href: '/shop?category=power&q=power+bank' },
        { label: 'Wall chargers', href: '/shop?category=power&q=wall+charger' },
        { label: 'Adapters', href: '/shop?category=power&q=adapter' },
        { label: 'Cables', href: '/shop?category=power&q=cable' },
        { label: 'All Power →', href: '/shop?category=power', bold: true },
      ],
      batteryFinder: {
        heading: 'Phone batteries',
        note: 'Find yours by phone model',
        formAction: '/shop?category=power&q=battery',
        inputName: 'model',
        inputPlaceholder: 'Type your phone, e.g. Tecno Spark 10',
        brandChips,
        askAction: { label: "Can't find your model? Send us a photo of the old one", href: WA_BATTERY },
      },
      featured: {
        eyebrow: 'Most carried', name: 'Magnetic Power Bank', line: 'Clips to the back of your phone',
        href: '/shop?category=power&q=power+bank', alt: 'Magnetic Power Bank', img: FEAT,
      },
    },
    {
      key: 'sound',
      shape: 'wide',
      tiles: [
        { label: 'Earbuds', descriptor: 'True wireless, with a charging case', href: '/shop?category=sound&q=earbuds' },
        { label: 'Earphones', descriptor: 'Wired, with a mic for calls', href: '/shop?category=sound&q=earphones' },
        { label: 'Headphones', descriptor: 'On-ear, for everyday listening', href: '/shop?category=sound&q=headphones' },
        { label: 'Over-ear headphones', descriptor: 'Full cups, for studio and travel', href: '/shop?category=sound&q=over-ear' },
      ],
      featured: {
        eyebrow: 'Also worth carrying', name: 'Digital Display Power Bank', line: '20,000mAh, with a charge level you can read',
        href: '/shop?category=power&q=power+bank', alt: 'Digital Display Power Bank', img: FEAT,
      },
    },
    {
      key: 'storage',
      shape: 'wide',
      capacityMatrix: [
        { rowLabel: 'Flash drives', allSizes: { label: 'All sizes →', href: '/shop?category=storage&q=flash+drive' }, caps: caps() },
        { rowLabel: 'Memory cards', allSizes: { label: 'All sizes →', href: '/shop?category=storage&q=memory+card' }, caps: caps() },
      ],
      note: 'Every card is written full and read back before it is sold. <b>The size on the box is the size you get.</b>',
      featured: {
        eyebrow: 'Also worth carrying', name: 'Power Bank with Built-in Cables', line: 'No cable to forget at home',
        href: '/shop?category=power&q=power+bank', alt: 'Power Bank with Built-in Cables', img: FEAT,
      },
    },
    {
      key: 'car',
      shape: 'wide',
      tiles: [
        { label: 'Car chargers', descriptor: 'Fast charging built for Kampala potholes', href: '/shop?category=car&q=charger' },
        { label: 'Bluetooth for cars', descriptor: 'Calls and music in a car with no Bluetooth', href: '/shop?category=car&q=bluetooth' },
      ],
      featured: {
        eyebrow: 'Also worth carrying', name: 'Power Bank with Carry Handle', line: 'Enough charge for the whole car',
        href: '/shop?category=power&q=power+bank', alt: 'Power Bank with Carry Handle', img: FEAT,
      },
    },
    {
      key: 'pc',
      shape: 'wide',
      tiles: [
        { label: 'Mouse', descriptor: 'Wired and wireless, for work and play', href: '/shop?category=pc&q=mouse' },
        { label: 'Sound cards', descriptor: 'External audio for laptops and studios', href: '/shop?category=pc&q=sound+card' },
      ],
      featured: {
        eyebrow: 'Also worth carrying', name: '100W Portable Power Station', line: 'Keeps a desk running through a blackout',
        href: '/shop?category=power', alt: '100W Portable Power Station', img: FEAT,
      },
    },
  ],
  flash: {
    countdownHeading: 'Ends in',
    countdownLabels: { d: 'Days', h: 'Hrs', m: 'Min', s: 'Sec' },
    noteDefault: 'Same verified stock. Less money, until the clock runs out.',
    noteFinalHours: 'Final hours. Same verified stock, less money.',
    cta: { label: "See what's on sale →", href: '/shop' },
    featured: {
      eyebrow: 'Best seller, on sale', name: 'Magnetic Power Bank', line: 'On sale now',
      href: '/shop', alt: 'Magnetic Power Bank', img: FEAT,
    },
  },
  mobile: {
    quickLinks: [
      { key: 'all', label: 'Shop All', href: '/shop' },
      { key: 'flash', label: 'On sale', href: '/shop', tag: 'Live' },
    ],
    mflashPrefix: 'Sale ends in',
    mflashGo: 'Shop →',
    mflashHref: '/shop',
    batteryAccordionHeading: 'Phone batteries',
  },
  popover: {
    signedIn: {
      subTemplate: 'You have <b>{points} points</b>. That is {money} off your next order.',
      links: [
        { label: 'Your orders', href: '/account' },
        { label: 'Rewards', value: '{points} pts', href: '/account/rewards' },
        { label: 'Refer a friend', value: 'Earn points', href: '/account/rewards' },
        { label: 'Account settings', href: '/account#settings' },
        { label: 'Sign out', href: '/logout' },
      ],
      mobileRow: [
        { label: 'Your rewards', href: '/account/rewards' },
        { label: 'Your orders', href: '/account' },
      ],
    },
    returning: {
      heading: 'Welcome back',
      holdTag: 'On now',
      holdTitle: '{discountPct}% discount on everything',
      holdSubManyVisits: 'Comes off at checkout. No code needed',
      holdSubDefault: 'Comes off at checkout. No code needed',
      formAction: '/register',
      formInputPlaceholder: '07XX XXX XXX',
      submit: 'Claim it',
      altLink: { label: 'Sign in instead', href: '/account' },
      mobileSub: '<b>{discountPct}% discount on everything</b> right now. It comes off at checkout. Points start counting from today.',
    },
    firstTime: {
      holdTag: 'On now',
      holdTitle: '{discountPct}% discount on everything',
      holdSub: 'Comes off at checkout. No code needed',
      formAction: '/register',
      formInputPlaceholder: '07XX XXX XXX',
      submit: 'Claim it',
      joinNote: 'Your number is your account. Nothing else to fill in.',
      altLink: { label: 'I already have an account', href: '/account' },
      mobileSub: '<b>{discountPct}% discount on everything</b> right now. It comes off at checkout. Your phone number is your account.',
    },
  },
  miniCart: {
    heading: 'In your cart',
    subtotalLabel: 'Subtotal',
    checkoutCta: { label: 'Checkout', href: '/checkout' },
    viewCartCta: { label: 'View cart', href: '/cart' },
    cutoffSunday: 'Closed Sunday. This order goes out <b>Monday morning</b>',
    cutoffAfter: "Today's run has left. This order goes out <b>tomorrow morning</b>",
    cutoffBefore: 'Check out in <b>{left}</b> and we deliver <b>today</b>.',
  },
  settings: {
    firstOrderEstimateUgx: 'UGX 18,500',
    firstOrderDiscountPct: 10,
    pointsToUgxRate: 10,
    referralPct: 10,
    saleEndsIso: SALE_ENDS_ISO,
    cutoffTimeLabel: '5:00pm',
    nbaVisible: 1,
    searchSuggestions: 6,
    recentSearches: 5,
    miniCartItems: 4,
    dayStartHour: 6.5,
    dayEndHour: 18.75,
  },
};
