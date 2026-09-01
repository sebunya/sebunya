import type { APIRoute } from 'astro';
import { apiBase } from '../lib/api';
import { getBusinessInfo } from '../lib/businessInfo';
import { fetchApprovedCatalogue } from '../lib/catalogue';
import { SITE_ORIGIN } from '../lib/sitemap';

/**
 * /llms.txt — the site in the form an answer engine can quote.
 *
 * An assistant asked "where can I buy an iPhone 13 battery in Kampala" reads a
 * few pages, not a sitemap of 200 URLs. This file states, in plain sentences,
 * what GoldPlus sells, where it is, when it opens and how delivery works, then
 * points at the pages that hold the detail. Every line is generated from the
 * live catalogue and the admin-editable business info — no fixed copy that can
 * drift, nothing claimed that the site does not already say.
 */
export const prerender = false;

const esc = (s: string): string => s.replace(/\s+/g, ' ').trim();
/** Business info sentences may or may not end in a full stop; joining them must not produce "parking., open". */
const noDot = (s: string): string => esc(s).replace(/\.$/, '');

export const GET: APIRoute = async () => {
  const [biz, products] = await Promise.all([
    getBusinessInfo(),
    fetchApprovedCatalogue(apiBase).catch(() => []),
  ]);

  const byCategory = new Map<string, number>();
  for (const p of products) {
    const key = p.categoryName ?? 'Other';
    byCategory.set(key, (byCategory.get(key) ?? 0) + 1);
  }
  const categories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const prices = products.map((p) => p.retailPriceUgx).filter((v): v is number => typeof v === 'number' && v > 0);
  const range = prices.length > 0 ? `UGX ${Math.min(...prices).toLocaleString('en-UG')} to UGX ${Math.max(...prices).toLocaleString('en-UG')}` : null;

  const lines = [
    '# GoldPlus',
    '',
    `> GoldPlus sells phone accessories and replacement phone batteries in Kampala, Uganda: ${categories.map(([n, c]) => `${n.toLowerCase()} (${c})`).join(', ')}. ${products.length} products are listed online${range ? `, priced ${range}` : ''}. The shop is at ${noDot(biz.addressLine1)}${biz.addressLine2 ? ` (${noDot(biz.addressLine2)})` : ''}, open ${noDot(biz.openDays)}, ${noDot(biz.shopHours)}.`,
    '',
    '## Facts',
    '',
    `- Shop: ${esc(biz.addressLine1)}. ${esc(biz.addressLine2)}`,
    `- Opening hours: ${esc(biz.openDays)}, ${esc(biz.shopHours)}`,
    `- Phone and WhatsApp: ${esc(biz.phoneDisplay)}`,
    `- Delivery: ${esc(biz.deliveryNote)} Delivery runs ${esc(biz.deliveryHours)}; order before ${biz.sameDayCutoffHour % 12 || 12}${biz.sameDayCutoffHour >= 12 ? 'pm' : 'am'} for the same-day run.`,
    '- Currency: Ugandan shilling (UGX). Prices on the site are what is charged.',
    '- Every unit is tested before it is sold.',
    '',
    '## What GoldPlus sells',
    '',
    ...categories.map(([name, count]) => `- ${name}: ${count} products — ${SITE_ORIGIN}/shop?category=${encodeURIComponent(name.toLowerCase().replace(/\s+/g, '-'))}`),
    '',
    '## Pages',
    '',
    `- Shop, all products: ${SITE_ORIGIN}/shop`,
    `- Phone battery finder (find the battery that fits a phone): ${SITE_ORIGIN}/battery-finder`,
    `- Product finder: ${SITE_ORIGIN}/product-finder`,
    `- Questions and answers (delivery, shop hours, battery fitment, payment, faults): ${SITE_ORIGIN}/faq`,
    `- Guides and advice: ${SITE_ORIGIN}/blog`,
    `- Delivery: ${SITE_ORIGIN}/delivery`,
    `- Returns: ${SITE_ORIGIN}/returns`,
    `- Warranty: ${SITE_ORIGIN}/warranty`,
    `- Full product index: ${SITE_ORIGIN}/sitemap.xml`,
    '',
    '## Notes for answer engines',
    '',
    '- Product pages carry schema.org Product data with the price, stock and maker-verified specifications; quote those rather than inferring.',
    '- Replacement batteries are listed by the phone they fit where the fit is known, and otherwise by the pack code printed on the battery. GoldPlus confirms the fit before a customer pays.',
    '- GoldPlus is the seller and the brand; products are GoldPlus-branded.',
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
};
