/**
 * Internal links point at INDEXABLE pages (2026-10-08 SEO audit).
 *
 * The menus, footer, home tiles and product breadcrumbs linked to
 * /shop?category=…&q=… — filter views that are, correctly, noindex. Two thirds
 * of all internal links therefore pointed at pages Google is told to ignore,
 * while the category hub pages (/power, /audio/wireless-earbuds …), which are
 * indexable and written for search, received 0.3% of them.
 *
 * indexableCategoryHref() maps a category / category+term filter link to the
 * hub that covers exactly that selection. Anything without an exact hub stays
 * as it was: capacity filters (32gb), sorting, paging, battery-finder searches.
 * Only hubs listed in the hubs sitemap (gate-passing, indexable) are targets.
 */

const CATEGORY_TO_HUB: Readonly<Record<string, string>> = {
  power: '/power',
  'power-devices': '/power',
  sound: '/audio',
  'sound-devices': '/audio',
  audio: '/audio',
  storage: '/storage',
  'storage-devices': '/storage',
  car: '/car-accessories',
  'car-accessories': '/car-accessories',
  pc: '/computer-accessories',
  'pc-accessories': '/computer-accessories',
};

/** Search terms (lower-case, as the menus send them) that equal a child hub. */
const TERM_TO_CHILD: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  '/power': {
    'power bank': '/power/power-banks',
    'power banks': '/power/power-banks',
    'power-banks': '/power/power-banks',
    'wall charger': '/power/chargers',
    'wall chargers': '/power/chargers',
    charger: '/power/chargers',
    chargers: '/power/chargers',
    cable: '/power/charging-cables',
    cables: '/power/charging-cables',
    'charging cable': '/power/charging-cables',
  },
  '/audio': {
    earbuds: '/audio/wireless-earbuds',
    'wireless earbuds': '/audio/wireless-earbuds',
  },
  '/storage': {
    'flash drive': '/storage/usb-flash-drives',
    'flash drives': '/storage/usb-flash-drives',
    'usb flash drive': '/storage/usb-flash-drives',
    'memory card': '/storage/memory-cards',
    'memory cards': '/storage/memory-cards',
  },
};

export function indexableCategoryHref(href: string): string {
  if (typeof href !== 'string' || !href.startsWith('/shop?')) return href;
  let url: URL;
  try {
    url = new URL(href, 'https://shopgoldplus.com');
  } catch {
    return href;
  }
  // Only a plain category (+ optional term) selection has a hub equivalent.
  for (const key of url.searchParams.keys()) if (key !== 'category' && key !== 'q') return href;
  const hub = CATEGORY_TO_HUB[(url.searchParams.get('category') ?? '').trim().toLowerCase()];
  if (!hub) return href;
  const term = (url.searchParams.get('q') ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!term) return hub + url.hash;
  const child = TERM_TO_CHILD[hub]?.[term];
  return child ? child + url.hash : href;
}

/** Rewrites every `href` string in a nested config object (menus), returning a copy. */
export function withIndexableHrefs<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => withIndexableHrefs(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = k === 'href' && typeof v === 'string' ? indexableCategoryHref(v) : withIndexableHrefs(v);
    }
    return out as T;
  }
  return value;
}
