/**
 * Where sales started: the page each sale's journey began on, from the shop's own records.
 *
 * Every landing touch keeps the path it landed on (measurement.touchpoint.landing_path, collector v2), and every
 * order is linked to its visitor's touches (measurement.order_touch_link). So "which pages bring customers who buy"
 * is answerable without GA4: a sale's entry page is its first recorded arrival WITH a source, or its first direct
 * arrival when nothing else was recorded (the same direct rule as the channel models, ChannelReport.journeyFor).
 * Pure: the store supplies one entry touch per order, this groups them.
 *
 * Organic programme (docs/growth/README.md, gate G5): sales that started on a per-phone battery page or a guide are
 * read here, first-party, rather than from GA4's sessions.
 */
import { channelLabel } from './ChannelReport';

export interface EntryTouch { orderId: string; landingPath: string | null; channel: string }
export interface EntrySale { orderId: string; revenueUGX: bigint }

export interface EntryPageRow { path: string; section: string; channel: string; channelLabel: string; orders: number; revenueUGX: string }
export interface EntrySectionRow { section: string; orders: number; revenueUGX: string }
export interface EntryPagesReport {
  /** Sales in the report window, and how many have a recorded visit (the rest are codes, answers or nothing). */
  sales: number;
  salesWithVisit: number;
  pages: EntryPageRow[];
  /** Pages beyond the top rows, summed, so the table still adds up. */
  otherPages: { pages: number; orders: number; revenueUGX: string } | null;
  sections: EntrySectionRow[];
}

/**
 * The top-level hubs (apps/web/src/lib/categoryHubs.ts CATEGORY_HUBS): a landing on one of these, or a page below
 * it, is a category page. tests/unit/AttributionDirectAndEntryPages.test.ts keeps this list equal to the web's.
 */
export const HUB_ROOTS = ['power', 'audio', 'storage', 'computer-accessories', 'car-accessories', 'phone-batteries'] as const;

/** A landing path as one page: lower case, no trailing slash, capped (the touch already holds the path only). */
export function entryPagePath(p: string | null | undefined): string {
  const raw = String(p ?? '').trim().slice(0, 300);
  if (!raw.startsWith('/')) return '(unknown page)';
  const bare = raw.replace(/\/+$/, '').toLowerCase();
  return bare || '/';
}

/** The kind of page, for the section totals. Order matters: the most specific prefix first. */
export function entryPageSection(path: string): string {
  if (path === '/') return 'Home page';
  if (path.startsWith('/phone-batteries/')) return 'Phone battery pages';
  if (path.startsWith('/products/')) return 'Product pages';
  if (path === '/blog' || path.startsWith('/blog/')) return 'Guides';
  if (/^\/(battery-finder|charger-finder|product-finder)$/.test(path)) return 'Finders';
  if (path === '/shop' || path.startsWith('/shop/') || path === '/search') return 'Shop and search';
  const root = path.split('/')[1] ?? '';
  if ((HUB_ROOTS as readonly string[]).includes(root)) return 'Category pages';
  if (path.startsWith('/r/') || path === '/invite') return 'Invite links';
  if (path === '(unknown page)') return 'Unknown page';
  return 'Other pages';
}

const money = (n: bigint) => n.toString();

/**
 * Groups sales by entry page × channel (a page reached from search and the same page reached from WhatsApp are two
 * rows), largest revenue first; the top `limit` rows, the rest summed. Sections total every sale with a visit.
 */
export function entryPagesReport(sales: EntrySale[], entries: EntryTouch[], limit = 25): EntryPagesReport {
  const entryOf = new Map(entries.map((e) => [e.orderId, e]));
  const rows = new Map<string, { path: string; section: string; channel: string; orders: number; revenue: bigint }>();
  const sections = new Map<string, { orders: number; revenue: bigint }>();
  let salesWithVisit = 0;
  for (const s of sales) {
    const e = entryOf.get(s.orderId);
    if (!e) continue;
    salesWithVisit += 1;
    const path = entryPagePath(e.landingPath);
    const section = entryPageSection(path);
    const key = `${path}\u001f${e.channel}`;
    const r = rows.get(key) ?? { path, section, channel: e.channel, orders: 0, revenue: 0n };
    r.orders += 1; r.revenue += s.revenueUGX; rows.set(key, r);
    const sec = sections.get(section) ?? { orders: 0, revenue: 0n };
    sec.orders += 1; sec.revenue += s.revenueUGX; sections.set(section, sec);
  }
  const sorted = [...rows.values()].sort((a, b) => (b.revenue > a.revenue ? 1 : b.revenue < a.revenue ? -1 : 0) || b.orders - a.orders || a.path.localeCompare(b.path));
  const top = sorted.slice(0, Math.max(0, limit));
  const rest = sorted.slice(top.length);
  return {
    sales: sales.length,
    salesWithVisit,
    pages: top.map((r) => ({ path: r.path, section: r.section, channel: r.channel, channelLabel: channelLabel(r.channel), orders: r.orders, revenueUGX: money(r.revenue) })),
    otherPages: rest.length
      ? { pages: new Set(rest.map((r) => r.path)).size, orders: rest.reduce((n, r) => n + r.orders, 0), revenueUGX: money(rest.reduce((n, r) => n + r.revenue, 0n)) }
      : null,
    sections: [...sections.entries()]
      .map(([section, v]) => ({ section, orders: v.orders, revenueUGX: money(v.revenue) }))
      .sort((a, b) => (BigInt(b.revenueUGX) > BigInt(a.revenueUGX) ? 1 : BigInt(b.revenueUGX) < BigInt(a.revenueUGX) ? -1 : 0) || b.orders - a.orders),
  };
}
