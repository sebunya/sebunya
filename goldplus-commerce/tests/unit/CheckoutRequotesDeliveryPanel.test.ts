import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  buildDeliveryQuoteRequest,
  renderDeliveryQuotePanel,
  DELIVERY_QUOTE_UNREACHABLE_HTML,
} from '../../apps/web/src/lib/deliveryQuotePanel';
import { canEditProductPrices } from '../../apps/web/src/lib/adminPricingAccess';

/**
 * F2 remainder: the checkout DeliveryQuote panel is re-quoted in the browser
 * after a location pick, through the ONE quoting service (POST /delivery/quote,
 * docs/delivery/CONTRACT.md #1) and drawn by the SAME renderer the server uses.
 *
 * #21: the product editor's price inputs are only editable for an admin with a
 * pricing permission, the same rule the API enforces.
 */
const read = (p: string) => readFileSync(p, 'utf8');

const quoted = {
  tone: 'quoted',
  feeUgx: 12000,
  perParcelFeeUgx: 12000,
  parcelCount: 1,
  parcelSentence: null,
  parcelNotice: null,
  message: null,
  shipmentSentence: null,
  windowSentence: 'Arrives tomorrow.',
  disclaimer: 'This fee is fixed.',
  disclaimerStage: 2,
  pickup: 'Collect from our shop.',
  pinNudge: 'Drop a pin for a faster rider.',
  cutoff: { sentence: 'Order within 2 hours for same-day dispatch.' },
  freeDelivery: { qualifies: false, pct: 40, remainingUgx: 60000 },
  proportionality: null,
  belowMinimum: null,
  narrowWithinDistrict: null,
};

describe('delivery quote request (the same body the server sends)', () => {
  it('carries the place, the basket and the subtotal', () => {
    expect(buildDeliveryQuoteRequest({
      district: ' Kampala ', areaSlug: 'kampala-ntinda', deliveryArea: 'Ntinda',
      items: [{ productId: 'p1', quantity: 2 }], subtotalUgx: 290000,
    })).toEqual({
      areaSlug: 'kampala-ntinda', district: 'Kampala', deliveryArea: 'Ntinda',
      items: [{ productId: 'p1', quantity: 2 }], subtotalUgx: 290000,
    });
  });

  it('no place is null, not an empty string, and bad lines are dropped', () => {
    const body = buildDeliveryQuoteRequest({
      district: '', areaSlug: null, deliveryArea: '  ',
      items: [{ productId: '', quantity: 1 }, { productId: 'p2', quantity: 0 }, { productId: 'p3', quantity: 1.5 }],
    });
    expect(body).toEqual({ areaSlug: null, district: null, items: [], subtotalUgx: null });
  });
});

describe('delivery quote panel renderer', () => {
  it('leads with the fee and shows the registry sentences', () => {
    const html = renderDeliveryQuotePanel(quoted, { stage: 2 });
    expect(html).toContain('data-delivery-quote');
    expect(html).toContain('data-tone="quoted"');
    expect(html).toMatch(/Delivery UGX 12,000/);
    expect(html).toContain('Arrives tomorrow.');
    expect(html).toContain('Add UGX 60,000 for free delivery.');
    expect(html).toContain('style="width:40%"');
    expect(html).toContain('data-disclaimer-stage="2"');
    expect(html).toContain('opens Google Maps in a new tab');
  });

  it('the pin nudge is stage 2 only and never on the compact product panel', () => {
    expect(renderDeliveryQuotePanel(quoted, { stage: 2 })).toContain('Drop a pin');
    expect(renderDeliveryQuotePanel(quoted, { stage: 1 })).not.toContain('Drop a pin');
    expect(renderDeliveryQuotePanel(quoted, { stage: 2, compact: true })).not.toContain('Drop a pin');
  });

  it('no fee shows the registry message; narrowing names the district', () => {
    const html = renderDeliveryQuotePanel(
      { ...quoted, tone: 'needs_narrowing', feeUgx: null, message: 'Pick your area.', narrowWithinDistrict: 'Wakiso' },
      { stage: 2 },
    );
    expect(html).not.toMatch(/Delivery UGX/);
    expect(html).toContain('Pick your area.');
    expect(html).toContain('Choose your specific area in Wakiso to see the exact fee.');
    expect(html).toContain('border-amber-200 bg-amber-50');
  });

  it('the fee-to-value interstitial carries its acknowledgement checkbox', () => {
    const html = renderDeliveryQuotePanel({
      ...quoted,
      proportionality: { message: 'Delivery costs more than the items.', feeUgx: 30000, subtotalUgx: 10000, addToReachProportionateUgx: 20000, addToReachFreeUgx: null },
    }, { stage: 2 });
    expect(html).toContain('data-proportionality');
    expect(html).toContain('name="acknowledgeDeliveryCost"');
    expect(html).not.toContain('and delivery is free');
  });

  it('escapes every value from the quote body (data, never markup)', () => {
    const html = renderDeliveryQuotePanel({ ...quoted, windowSentence: '<img src=x onerror=alert(1)>', tone: '"><script>' }, { stage: 2 });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('an absent body renders nothing; unreachable says the fee is confirmed before dispatch', () => {
    expect(renderDeliveryQuotePanel(null, { stage: 2 })).toBe('');
    expect(DELIVERY_QUOTE_UNREACHABLE_HTML).toContain('We will confirm the delivery fee with you before dispatch.');
  });
});

describe('checkout re-quotes the panel through the one quoting service', () => {
  const checkout = read('apps/web/src/pages/checkout.astro');
  const component = read('apps/web/src/components/DeliveryQuote.astro');

  it('the server component and the page script share one renderer', () => {
    expect(component).toMatch(/renderDeliveryQuotePanel\(q, \{ stage, compact \}\)/);
    expect(component).toMatch(/buildDeliveryQuoteRequest\(/);
    expect(checkout).toMatch(/import \{ buildDeliveryQuoteRequest, renderDeliveryQuotePanel, DELIVERY_QUOTE_UNREACHABLE_HTML \} from '\.\.\/lib\/deliveryQuotePanel'/);
  });

  it('a location pick POSTs /delivery/quote and redraws the panel, latest pick wins', () => {
    expect(checkout).toMatch(/<dd id="checkout-delivery-quote" data-subtotal=\{cart\.subtotalUgx\}/);
    expect(checkout).toMatch(/fetch\(`\$\{API_BASE\}\/delivery\/quote`, \{\s*method: 'POST'/);
    expect(checkout).toMatch(/if \(seq !== quoteSeq\) return;[^\n]*\n\s*quotePanelEl\.innerHTML = html;/);
    expect(checkout).toMatch(/setCutoffFor\(district\);\s*void refreshQuotePanel\(district, area, areaSlug\);/);
  });

  it('clearing the place, or written directions, re-quotes with no place', () => {
    expect(checkout.match(/void refreshQuotePanel\(null, null, null\)/g)?.length).toBe(2);
  });
});

describe('#21 product editor: prices editable only with a pricing permission', () => {
  it('pricing.manage or pricing.approve, nothing else', () => {
    expect(canEditProductPrices(['pricing.manage'])).toBe(true);
    expect(canEditProductPrices(['products.write', 'pricing.approve'])).toBe(true);
    expect(canEditProductPrices(['products.write', 'pricing.read'])).toBe(false);
    expect(canEditProductPrices([])).toBe(false);
    expect(canEditProductPrices(undefined)).toBe(false);
  });

  it('without it the page shows the prices read-only and resubmits them unchanged', () => {
    const page = read('apps/web/src/pages/admin/products/[id]/edit-properties.astro');
    expect(page).toMatch(/const canEditPrices = canEditProductPrices\(viewerPermissions\);/);
    // The editable inputs only in the permitted branch; hidden originals otherwise.
    expect(page).toMatch(/\{canEditPrices \? \(<>\s*<FormField\s+id="priceUgx"/);
    expect(page).toMatch(/Prices are read-only for your role[\s\S]{0,600}<input type="hidden" name="priceUgx" value=\{String\(product\.priceUgx\)\} \/>/);
  });
});
