/**
 * The whole editable header, one document (§9). Every array element carries a
 * stable `key`/`id` so telemetry and the editor can address it. Rendering is
 * driven from this shape; DEFAULT_NAV_CONFIG (config.ts) is the single seed +
 * SSR fallback — the role HERO_SLIDE_LIBRARY plays for the hero.
 */

export interface NavLink { label: string; href: string; }

export interface NavContact {
  phoneDisplay: string; // "0705 004545"
  tel: string; // "tel:+256705004545"
  telNumber: string; // "+256705004545"
  whatsappUrl: string; // "https://wa.me/256705004545"
  whatsappNumber: string; // "256705004545"
  whatsappBatteryPrefill: string;
  businessHoursNote: string;
  reachCallLabel: string;
  reachWhatsappLabel: string;
}

export interface NavBrand {
  logoSrc: string; logoAlt: string; logoHref: string; logoAriaLabel: string;
  featuredDefaultImage: string;
}

export interface NavRailItem {
  key: string; // 'all'|'power'|'sound'|'storage'|'car'|'pc'|'flash'
  label: string; // <= NAV_LIMITS.categoryLabel
  href: string;
  tag?: string; // e.g. "Live"
}

export interface NavTile { label: string; descriptor: string; href: string; variant?: 'go'; }
export interface NavListRow { label: string; href: string; bold?: boolean; }
export interface NavChip { label: string; href: string; style?: 'green'; }
export interface NavFeatured {
  eyebrow: string; name: string; line: string; href: string; alt: string; img: string;
}

export interface NavBatteryFinder {
  heading: string;
  note: string;
  formAction: string;
  inputName: string;
  inputPlaceholder: string;
  brandChips: NavChip[];
  askAction: NavLink;
}

export interface NavCapacityRow {
  rowLabel: string;
  allSizes: NavLink;
  caps: NavLink[];
}

export interface NavFlashDiscountRow { label: string; pct: string | null; href: string; bold?: boolean; }

export interface NavFlashPanel {
  countdownHeading: string;
  countdownLabels: { d: string; h: string; m: string; s: string };
  noteDefault: string;
  noteFinalHours: string;
  stock: { left: number; of: number; label: string; barWidthPct: number };
  cta: NavLink;
  discountRowsHeading: string;
  discountRows: NavFlashDiscountRow[];
  featured: NavFeatured;
}

export type NavPanelShape = 'wide' | 'list';

export interface NavMegaPanel {
  key: string; // matches a rail key
  shape: NavPanelShape;
  heading?: string;
  tiles?: NavTile[];
  listRows?: NavListRow[];
  capacityMatrix?: NavCapacityRow[];
  batteryFinder?: NavBatteryFinder;
  note?: string;
  featColumn?: { heading: string; rows: NavListRow[] };
  featured?: NavFeatured | null;
}

export interface NavSearch {
  formAction: string;
  inputName: string;
  placeholderDesktop: string;
  placeholderMobile: string;
  scanLink: { href: string; ariaLabel: string };
  sheetHeadings: { recent: string; recentClear: string; trending: string; products: string };
  footerCtaLabel: string;
  footerCtaHref: string;
  zeroResultCopy: string; // may contain {q}
  trendingTerms: NavLink[]; // empty until seeded from query logs; CMS-owned
}

export interface NavPopoverCopy {
  signedIn: {
    subTemplate: string; // "You have <b>{points} points</b> — that is UGX {money} off your next order."
    links: Array<NavLink & { value?: string }>;
    mobileRow: NavLink[];
  };
  returning: {
    heading: string; holdTag: string; holdTitle: string;
    holdSubManyVisits: string; holdSubDefault: string;
    formAction: string; formInputPlaceholder: string; submit: string;
    altLink: NavLink; mobileSub: string;
  };
  firstTime: {
    heading?: string; holdTag: string; holdTitle: string; holdSub: string;
    formAction: string; formInputPlaceholder: string; submit: string;
    joinNote: string; altLink: NavLink; mobileSub: string;
  };
}

export interface NavMiniCartCopy {
  heading: string; subtotalLabel: string;
  checkoutCta: NavLink; viewCartCta: NavLink;
  cutoffSunday: string; cutoffAfter: string; cutoffBefore: string; // {left} in cutoffBefore
}

export interface NavMobileExtras {
  quickLinks: NavRailItem[];
  mflashPrefix: string;
  mflashGo: string;
  mflashHref: string;
  batteryAccordionHeading: string;
}

export interface NavSettings {
  firstOrderEstimateUgx: string; // "UGX 18,500" — the ONE field, fanned out to all 4 sites
  firstOrderDiscountPct: number; // 10
  pointsToUgxRate: number; // 10
  referralPct: number; // 10
  saleEndsIso: string; // MIRRORS the hero flash deadline — never a second deadline
  cutoffTimeLabel: string; // "5:00pm"
  nbaVisible: number; // 1 (kept: 3)
  searchSuggestions: number; // 6
  recentSearches: number; // 5
  miniCartItems: number; // 4
  dayStartHour: number; // 6.5
  dayEndHour: number; // 18.75
}

export interface NavConfig {
  contact: NavContact;
  brand: NavBrand;
  search: NavSearch;
  rail: NavRailItem[];
  panels: NavMegaPanel[]; // the 6 non-flash panels; mobile accordions render from the SAME records
  flash: NavFlashPanel; // the flash panel (distinct: countdown/stock/discounts)
  mobile: NavMobileExtras;
  popover: NavPopoverCopy;
  miniCart: NavMiniCartCopy;
  settings: NavSettings;
}
