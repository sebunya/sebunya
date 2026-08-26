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

export const DEFAULT_BUSINESS_INFO: BusinessInfo = {
  phoneDisplay: '0705 004545',
  phoneDial: 'tel:+256705004545',
  whatsappNumber: '256705004545',
  whatsappUrl: 'https://wa.me/256705004545',
  whatsappChannelUrl: 'https://whatsapp.com/channel/0029VbByb56KmCPSiisvMs44',
  addressLine1: 'Wilson Road, Kampala',
  addressLine2: 'Next to Uhuru Restaurant, opposite Pioneer Mall parking.',
  mapUrl: 'https://www.google.com/maps/search/?api=1&query=GoldPlus%20Wilson%20Road%20Kampala',
  shopHours: '8:30am to 6:00pm',
  deliveryHours: '8:30am to 8:00pm',
  deliveryNote: 'Same-day in Kampala & Wakiso. Fee shown before you pay.',
  openDays: 'Monday to Saturday',
  sameDayCutoffHour: 17,
  closedDays: [0],
  socials: [
    { key: 'instagram', label: 'Instagram', href: 'https://instagram.com/ShopGoldPlus', enabled: true },
    { key: 'x', label: 'X', href: 'https://x.com/ShopGoldPlus', enabled: true },
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
