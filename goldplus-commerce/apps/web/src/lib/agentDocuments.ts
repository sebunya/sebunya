import type { ProductPublicDto } from '@goldplus/shared';
import { apiBase } from './api';
import { fetchApprovedCatalogue } from './catalogue';
import { getBusinessInfo } from './businessInfo';
import { SITE_ORIGIN } from './sitemap';
import { RETURNS_POLICY } from './returnsPolicy';
import { renderAgentMarkdown, ugx, type AgentDocument } from './agentMarkdown';

/**
 * The Markdown an agent gets for each page type. Generated from the same data
 * the HTML page renders — never scraped back out of the HTML — so the facts an
 * assistant quotes (price, stock, verified specifications, the returns window)
 * are the facts the shop holds.
 */
const availabilityWord = (kind: string): string =>
  kind === 'in_stock' ? 'In stock' : kind === 'pre_order' ? 'Available to pre-order' : kind === 'out_of_stock' ? 'Out of stock' : 'Stock not confirmed';

function productDocument(p: ProductPublicDto, jsonLd: unknown[]): AgentDocument {
  const lines: string[] = [`# ${p.name}`, ''];
  const facts: string[] = [];
  if (p.retailPriceUgx != null) facts.push(`- **Price:** ${ugx(p.retailPriceUgx)}`);
  facts.push(`- **Availability:** ${availabilityWord(p.availability?.kind ?? 'unknown')}`);
  if (p.categoryName) facts.push(`- **Category:** ${p.categoryName}`);
  if (p.sku) facts.push(`- **SKU:** ${p.sku}`);
  if (p.modelNumber) facts.push(`- **Model:** ${p.modelNumber}`);
  facts.push('- **Brand:** GoldPlus', '- **Condition:** New');
  lines.push(...facts, '');

  const body = (p.longDescription ?? '').trim() || (p.shortDescription ?? '').trim();
  if (body) lines.push(body, '');

  const specs = Object.entries(p.verifiedSpecs ?? {});
  if (specs.length > 0) {
    lines.push('## Specifications', '', '| Specification | Value |', '| --- | --- |');
    for (const [k, v] of specs) lines.push(`| ${k} | ${String(v)} |`);
    lines.push('', '_Specifications are taken from the manufacturer\'s own specification for this model._', '');
  }

  lines.push(
    '## Buying this',
    '',
    `- Product page: ${SITE_ORIGIN}/products/${p.slug}`,
    `- Delivery: same-day in Kampala and Wakiso; the fee is calculated for the address and shown before payment.`,
    `- Returns: ${RETURNS_POLICY.windowDays} days for a change of mind (unused and complete, customer covers return carriage). A faulty product is replaced or refunded with GoldPlus covering the carriage. ${RETURNS_POLICY.policyUrl}`,
    `- Payment: MTN or Airtel Mobile Money, Visa or Mastercard, or pay on delivery or at the shop.`,
    '',
  );
  return {
    title: p.name,
    description: (p.shortDescription ?? '').trim() || null,
    body: lines.join('\n'),
    jsonLd,
  };
}

function catalogueDocument(products: ProductPublicDto[], title: string, intro: string): AgentDocument {
  const byCategory = new Map<string, ProductPublicDto[]>();
  for (const p of products) {
    const key = p.categoryName || 'Other';
    byCategory.set(key, [...(byCategory.get(key) ?? []), p]);
  }
  const lines: string[] = [`# ${title}`, '', intro, ''];
  for (const [category, items] of [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`## ${category} (${items.length})`, '', '| Product | Price | Availability | Page |', '| --- | --- | --- | --- |');
    for (const p of items) {
      lines.push(`| ${p.name} | ${p.retailPriceUgx != null ? ugx(p.retailPriceUgx) : '—'} | ${availabilityWord(p.availability?.kind ?? 'unknown')} | ${SITE_ORIGIN}/products/${p.slug} |`);
    }
    lines.push('');
  }
  return { title, description: intro, body: lines.join('\n') };
}

/** The Markdown for a path, or null when this path has no agent representation. */
export async function agentDocumentFor(pathname: string): Promise<string | null> {
  const productMatch = pathname.match(/^\/products\/([^/]+)\/?$/);
  if (productMatch) {
    const res = await fetch(`${apiBase}/products/${encodeURIComponent(productMatch[1])}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const json: any = await res.json().catch(() => null);
    const product: ProductPublicDto | null = json?.success ? json.data : null;
    if (!product) return null;
    return renderAgentMarkdown(productDocument(product, []));
  }

  if (pathname === '/shop' || pathname === '/shop/') {
    const products = await fetchApprovedCatalogue(apiBase).catch(() => []);
    if (products.length === 0) return null;
    return renderAgentMarkdown(catalogueDocument(products, 'GoldPlus catalogue', `Every product GoldPlus currently sells online (${products.length}), with the price charged and live stock. Prices are in Ugandan shillings.`));
  }

  if (pathname === '/faq' || pathname === '/faq/') {
    const biz = await getBusinessInfo();
    const cutoff = `${biz.sameDayCutoffHour % 12 || 12}${biz.sameDayCutoffHour >= 12 ? 'pm' : 'am'}`;
    const body = [
      '# GoldPlus: questions and answers',
      '',
      '## Do you deliver, and how long does it take?',
      '',
      `${biz.deliveryNote} Delivery runs ${biz.deliveryHours}, ${biz.openDays}. Order before ${cutoff} for the same day's run. The fee is calculated for the address and shown before payment.`,
      '',
      '## Where is the GoldPlus shop and when is it open?',
      '',
      `${biz.addressLine1.replace(/\.$/, '')} — ${biz.addressLine2.replace(/\.$/, '')}. Open ${biz.openDays}, ${biz.shopHours}. Phone and WhatsApp ${biz.phoneDisplay}. Online orders can be collected at the shop.`,
      '',
      '## How do I know which replacement battery fits my phone?',
      '',
      `Search the phone in the battery finder (${SITE_ORIGIN}/battery-finder), match the code printed on the battery inside the phone to the code in the product name, or send the phone model on WhatsApp. GoldPlus confirms the fit before payment.`,
      '',
      '## How can I pay?',
      '',
      'MTN or Airtel Mobile Money, or a Visa or Mastercard through PesaPal; or pay on delivery or at the shop.',
      '',
      '## Are GoldPlus products genuine, and what if something is faulty?',
      '',
      `Products are GoldPlus-branded and every unit is tested before it is sold. A faulty product is replaced or refunded with GoldPlus covering the return carriage. A change-of-mind return is accepted within ${RETURNS_POLICY.windowDays} days of delivery or collection, unused and complete, with the customer covering the return carriage. ${RETURNS_POLICY.policyUrl}`,
      '',
    ].join('\n');
    return renderAgentMarkdown({ title: 'GoldPlus: questions and answers', description: 'Delivery, shop address and hours, battery fitment, payment methods and what happens if a product is faulty.', body });
  }

  return null;
}
