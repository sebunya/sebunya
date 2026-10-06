export interface BusinessSocialLink {
  /** Stable platform key; the footer maps it to an icon in code. */
  key: string;
  label: string;
  href: string;
  enabled: boolean;
}

/**
 * Business / contact info shown across the storefront (footer, contact points).
 * One admin-editable document; DEFAULT_BUSINESS_INFO is the seed + SSR fallback.
 */
export interface BusinessInfo {
  phoneDisplay: string;
  phoneDial: string;
  whatsappNumber: string;
  whatsappUrl: string;
  whatsappChannelUrl: string;
  addressLine1: string;
  addressLine2: string;
  mapUrl: string;
  shopHours: string;
  deliveryHours: string;
  deliveryNote: string;
  openDays: string;
  /** Same-day order deadline, hour 0–23 Kampala time. Drives the header/checkout countdown. */
  sameDayCutoffHour: number;
  /** Weekdays with no same-day run, 0=Sun…6=Sat. */
  closedDays: number[];
  socials: BusinessSocialLink[];
}

/**
 * Where the shop is, as a point. Fixed on 2026-10-03 from the owner's photos
 * taken inside the shop (looking east across Burton Street at the Mapeera
 * building and Amani Mall) against satellite imagery: the Burton Street face
 * of the Zainab Aziza Building, its southern end, fourth floor. Accuracy is
 * the building face (about 10 m), not a GPS fix. The Google Business Profile
 * pin was moved to the same point the same day; `mapUrl` opens that listing by
 * its id so the link and the pin can never disagree.
 */
export const SHOP_LOCATION = {
  latitude: 0.31422,
  longitude: 32.57792,
  plusCode: '8H7H+M5M Kampala',
  building: 'Zainab Aziza Building',
  floor: '4th Floor',
  street: 'Burton Street',
  mapUrl: 'https://maps.google.com/?cid=2567724259551649466',
} as const;

export const DEFAULT_BUSINESS_INFO: BusinessInfo = {
  phoneDisplay: '0705 004545',
  phoneDial: 'tel:+256705004545',
  whatsappNumber: '256705004545',
  whatsappUrl: 'https://wa.me/256705004545',
  whatsappChannelUrl: 'https://whatsapp.com/channel/0029VbByb56KmCPSiisvMs44',
  addressLine1: 'Zainab Aziza Building, 4th Floor, Burton Street, Kampala',
  addressLine2: 'Opposite Pioneer Mall, next to Uhuru Restaurant.',
  mapUrl: SHOP_LOCATION.mapUrl,
  shopHours: '8:30am to 6:00pm',
  deliveryHours: '8:30am to 8:00pm',
  deliveryNote: 'Same-day in Kampala & Wakiso. Fee shown before you pay.',
  openDays: 'Monday to Saturday',
  sameDayCutoffHour: 17,
  closedDays: [0],
  socials: [
    { key: 'instagram', label: 'Instagram', href: 'https://instagram.com/ShopGoldPlus', enabled: true },
    { key: 'x', label: 'X', href: 'https://x.com/shopgoldplus', enabled: true },
    { key: 'facebook', label: 'Facebook', href: 'https://facebook.com/ShopGoldPlus', enabled: true },
    { key: 'youtube', label: 'YouTube', href: 'https://youtube.com/@ShopGoldPlus', enabled: true },
    { key: 'tiktok', label: 'TikTok', href: 'https://tiktok.com/@ShopGoldPlus', enabled: true },
    { key: 'linkedin', label: 'LinkedIn', href: 'https://linkedin.com/company/ShopGoldPlus', enabled: true },
    { key: 'threads', label: 'Threads', href: 'https://threads.net/@ShopGoldPlus', enabled: true },
    { key: 'pinterest', label: 'Pinterest', href: 'https://pinterest.com/ShopGoldPlus', enabled: true },
  ],
};

/** Known social platforms an admin may toggle/point (icon lives in the footer). */
export const BUSINESS_SOCIAL_KEYS = ['instagram', 'x', 'facebook', 'youtube', 'tiktok', 'linkedin', 'threads', 'pinterest'] as const;

/**
 * How each network writes its own name. Capitalising the key gave customers
 * "Youtube", "Tiktok" and "Linkedin" in the footer, and the admin save rewrote
 * whatever label was stored with those, so the mistake could not be corrected
 * from the admin either.
 */
export const BUSINESS_SOCIAL_LABELS: Record<(typeof BUSINESS_SOCIAL_KEYS)[number], string> = {
  instagram: 'Instagram',
  x: 'X',
  facebook: 'Facebook',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  threads: 'Threads',
  pinterest: 'Pinterest',
};

/**
 * The X (Twitter) handle for card attribution (`twitter:site`), read from the
 * same admin-editable social link the footer renders, so the card can never
 * name an account the site does not link to. Null when the X link is switched
 * off or is not a profile URL: a card without `twitter:site` is valid, a card
 * naming the wrong account is not.
 */
export function xHandleFromSocials(socials: ReadonlyArray<{ key: string; href: string; enabled: boolean }> | null | undefined): string | null {
  const x = (socials ?? []).find((s) => s.key === 'x' && s.enabled && s.href);
  if (!x) return null;
  try {
    const url = new URL(x.href);
    if (!/^(www\.|mobile\.)?(x|twitter)\.com$/i.test(url.hostname)) return null;
    const handle = url.pathname.split('/').filter(Boolean)[0]?.replace(/^@/, '') ?? '';
    return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? `@${handle}` : null;
  } catch {
    return null;
  }
}
