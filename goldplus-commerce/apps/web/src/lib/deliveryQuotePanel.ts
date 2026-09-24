/**
 * The delivery quote panel: ONE renderer for the server and the browser.
 *
 * `DeliveryQuote.astro` renders it on the server (product page, cart,
 * checkout) and the checkout page script renders it again after a location
 * pick, from the SAME public endpoint (`POST /delivery/quote`, the one quoting
 * service — docs/delivery/CONTRACT.md #1). Because both paths share this
 * function, the re-quoted panel cannot drift from the first paint.
 *
 * Every customer-facing sentence comes from the quote body (the registry);
 * the only fixed text here is the frame that was already in the component.
 * Every value is escaped: the quote body is data, never markup.
 *
 * Pure: no DOM, no fetch, no imports — unit-tested directly.
 */

export interface DeliveryQuoteRequestInput {
  areaSlug?: string | null;
  district?: string | null;
  /** Free-text area typed or picked, when there is one. */
  deliveryArea?: string | null;
  items?: Array<{ productId: string; quantity: number }>;
  subtotalUgx?: number | null;
}

/** The request body `POST /delivery/quote` expects. Same shape the server-side render sends. */
export function buildDeliveryQuoteRequest(input: DeliveryQuoteRequestInput): Record<string, unknown> {
  const areaSlug = typeof input.areaSlug === 'string' && input.areaSlug.trim() ? input.areaSlug.trim() : null;
  const district = typeof input.district === 'string' && input.district.trim() ? input.district.trim() : null;
  const items = (input.items ?? [])
    .filter((i) => i && typeof i.productId === 'string' && i.productId && Number.isInteger(i.quantity) && i.quantity > 0)
    .map((i) => ({ productId: i.productId, quantity: i.quantity }));
  const body: Record<string, unknown> = {
    areaSlug,
    district,
    items,
    subtotalUgx: typeof input.subtotalUgx === 'number' && Number.isFinite(input.subtotalUgx) ? input.subtotalUgx : null,
  };
  const area = typeof input.deliveryArea === 'string' ? input.deliveryArea.trim() : '';
  if (area) body.deliveryArea = area;
  return body;
}

export function escapeQuoteText(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ugx = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(Number(n)) ? '' : `UGX ${Math.round(Number(n)).toLocaleString('en-UG')}`;

// Tone drives the visual treatment. A customer who IS served must never see the
// styling we use for "we cannot serve you".
const TONE_CLASS: Record<string, string> = {
  quoted: 'border-gray-200 bg-white',
  served_differently: 'border-blue-200 bg-blue-50',
  needs_narrowing: 'border-amber-200 bg-amber-50',
  not_served: 'border-gray-300 bg-gray-50',
  confirmed_later: 'border-gray-200 bg-gray-50',
};

/** The panel when the quoting endpoint could not be reached. */
export const DELIVERY_QUOTE_UNREACHABLE_HTML =
  '<div class="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">We will confirm the delivery fee with you before dispatch.</div>';

export interface DeliveryQuotePanelOptions {
  stage: 1 | 2;
  compact?: boolean;
}

/**
 * The panel markup for a quote body. `null` quote (unreachable) renders the
 * confirm-before-dispatch line; an absent body renders nothing.
 */
export function renderDeliveryQuotePanel(q: any, opts: DeliveryQuotePanelOptions): string {
  if (!q || typeof q !== 'object') return '';
  const e = escapeQuoteText;
  const tone = typeof q.tone === 'string' ? q.tone : 'quoted';
  const out: string[] = [];
  out.push(`<div class="rounded-xl border px-4 py-3 ${TONE_CLASS[tone] ?? TONE_CLASS.quoted}" data-delivery-quote data-tone="${e(tone)}">`);

  if (q.feeUgx !== null && q.feeUgx !== undefined) {
    out.push('<div class="flex flex-wrap items-baseline justify-between gap-2">');
    out.push(`<span class="text-sm font-black text-brand-dark">Delivery ${e(ugx(q.feeUgx))}</span>`);
    if (q.parcelCount && q.parcelCount > 1) {
      out.push(`<span class="text-[11px] font-bold text-blue-800">${e(q.parcelCount)} parcels × ${e(ugx(q.perParcelFeeUgx))}</span>`);
    }
    out.push('</div>');
  } else {
    out.push(`<p class="text-sm text-gray-700">${e(q.message)}</p>`);
  }

  // Two parcels is two fees. Said BEFORE they commit, never discovered after.
  if (q.parcelSentence && q.parcelCount > 1) {
    out.push(`<p class="text-xs text-blue-900 mt-1">${e(q.parcelSentence)} ${e(q.parcelNotice)}</p>`);
  }
  // Bus: shipment and collection language, never delivery to the door.
  if (q.shipmentSentence) out.push(`<p class="text-xs text-blue-900 mt-1">${e(q.shipmentSentence)}</p>`);
  // Day level until an hour window is earned from a real sample.
  if (q.windowSentence) out.push(`<p class="text-xs text-gray-600 mt-1">${e(q.windowSentence)}</p>`);
  // AREA_TOO_COARSE: one step from a price. Prompt, never apologise.
  if (tone === 'needs_narrowing' && q.narrowWithinDistrict) {
    out.push(`<p class="text-xs text-amber-900 mt-1 font-bold">Choose your specific area in ${e(q.narrowWithinDistrict)} to see the exact fee.</p>`);
  }

  // The fee-to-value interstitial. Never the default, never hidden.
  const p = q.proportionality;
  if (p) {
    out.push('<div class="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2" data-proportionality>');
    out.push(`<p class="text-xs font-black text-amber-900">${e(p.message)}</p>`);
    out.push('<ul class="text-[11px] text-amber-900 mt-1 space-y-0.5">');
    out.push(`<li>Shipping is ${e(ugx(p.feeUgx))} on a basket of ${e(ugx(p.subtotalUgx))}.</li>`);
    out.push(`<li>Add ${e(ugx(p.addToReachProportionateUgx))} and the delivery becomes proportionate to what you are buying.</li>`);
    if (p.addToReachFreeUgx !== null && p.addToReachFreeUgx !== undefined) {
      out.push(`<li>Add ${e(ugx(p.addToReachFreeUgx))} and delivery is free.</li>`);
    }
    out.push('</ul>');
    out.push('<label class="flex items-start gap-2 text-[11px] text-amber-900 mt-2"><input type="checkbox" name="acknowledgeDeliveryCost" value="yes" class="mt-0.5 w-3.5 h-3.5" /><span>I know the delivery costs more than the items, and I want to go ahead.</span></label>');
    out.push('</div>');
  }

  if (q.belowMinimum) {
    const b = q.belowMinimum;
    out.push(`<p class="text-xs text-gray-700 mt-2">${e(b.message)} The minimum for this destination is ${e(ugx(b.minimumUgx))}; you are ${e(ugx(b.shortfallUgx))} short.</p>`);
  }

  // Free-delivery progress: the EXACT remaining amount.
  if (q.freeDelivery && !q.freeDelivery.qualifies) {
    const pct = Math.max(0, Math.min(100, Number(q.freeDelivery.pct) || 0));
    out.push('<div class="mt-2"><div class="h-1.5 rounded-full bg-gray-200 overflow-hidden">');
    out.push(`<div class="h-full bg-brand-primary" style="width:${pct}%"></div>`);
    out.push(`</div><p class="text-[11px] text-gray-600 mt-1">Add ${e(ugx(q.freeDelivery.remainingUgx))} for free delivery.</p></div>`);
  }
  if (q.freeDelivery?.qualifies) out.push('<p class="text-[11px] font-bold text-green-700 mt-2">Your order qualifies for free delivery.</p>');

  // Cut-off countdown, in East Africa Time. Absent when no cutoff is set.
  if (q.cutoff?.sentence) out.push(`<p class="text-[11px] text-gray-600 mt-2">${e(q.cutoff.sentence)}</p>`);

  // Directions to the shop, named as what it is: it opens Google Maps in a new
  // tab (announced), it is not the way to CHOOSE collection.
  if (q.pickup) {
    out.push(
      '<a href="https://www.google.com/maps/search/?api=1&amp;query=GoldPlus%20Wilson%20Road%20Kampala" target="_blank" rel="noopener noreferrer" class="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full border-2 border-brand-primary px-3.5 py-1.5 text-[11px] font-bold text-gray-900 hover:bg-brand-primary/10 outline-none focus-visible:ring-4 focus-visible:ring-brand-primaryInk transition-colors">Directions to our shop <span aria-hidden="true">&#8599;</span><span class="sr-only">(opens Google Maps in a new tab)</span></a>',
    );
  }

  // Secondary reassurance, collapsed so the panel leads with the fee.
  const showPin = !opts.compact && q.pinNudge && opts.stage === 2;
  if (q.pickup || showPin || q.disclaimer) {
    out.push('<details class="mt-2 group"><summary class="text-[11px] font-semibold text-gray-600 cursor-pointer select-none marker:content-none flex items-center gap-1"><span aria-hidden="true" class="transition-transform group-open:rotate-90">▸</span>How delivery works</summary><div class="mt-1.5 space-y-1.5">');
    if (q.pickup) out.push(`<p class="text-[11px] text-gray-600">${e(q.pickup)}</p>`);
    if (showPin) out.push(`<p class="text-[11px] text-gray-500">${e(q.pinNudge)}</p>`);
    if (q.disclaimer) {
      out.push(`<p class="text-[11px] text-gray-500 pt-2 border-t border-gray-200" data-disclaimer-stage="${e(q.disclaimerStage)}">${e(q.disclaimer)}</p>`);
    }
    out.push('</div></details>');
  }

  out.push('</div>');
  return out.join('');
}
