import { Hono } from 'hono';
import { ApiResponse } from '@goldplus/shared';
import { Registry } from '../../../infrastructure/Registry';
import { presentQuote, businessCutoffCountdown, freeDeliveryProgress, windowSentence } from '../../../domain/delivery/DeliveryPresentation';
import { quoteCacheKey } from '../../../domain/delivery/DeliveryQuoteCache';
import { REASON_COPY_KEY } from '../../../domain/delivery/DeliveryModel';
import { toEatParts, normalizeUgandaDistrict } from '@goldplus/shared';
import { normalizeDistrict } from '../../../domain/commerce/DeliveryFee';

/**
 * The PUBLIC delivery quote (brief PART 8 / customer surfaces).
 *
 * ONE endpoint answers the product page, the cart and checkout, so the same
 * basket cannot show three fees. The cache key includes the configuration
 * version, so publishing the launch numbers invalidates every cached
 * `CONFIG_INCOMPLETE` atomically — without that, customers would keep seeing
 * "fee unavailable" after the module started working and it would look as
 * though the numbers had not taken.
 *
 * Read-only, no PII in, no PII out. Every customer-facing sentence is resolved
 * from the registry here rather than baked into a page, so a Tier 1 edit
 * reaches all three surfaces at once.
 */
const routes = new Hono();

/** In-process, per-replica. A miss costs one recomputation; a stale quote costs trust. */
const CACHE = new Map<string, { at: number; body: unknown }>();
const CACHE_TTL_MS = 60_000;
/**
 * Bounded. The key is built from unauthenticated input (any area slug, any
 * subtotal, up to 100 line pairs) and expiry was only checked on READ, so a
 * client looping over subtotals grew this map without limit for the life of
 * the process. Oldest entry out when full; expired entries swept on write.
 */
const CACHE_MAX = 5_000;
function cacheSet(key: string, body: unknown, at: number) {
  if (CACHE.size >= CACHE_MAX) {
    for (const [k, v] of CACHE) if (at - v.at >= CACHE_TTL_MS) CACHE.delete(k);
    if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value as string);
  }
  CACHE.set(key, { at, body });
}

routes.post('/quote', async (c) => {
  const body = await c.req.json().catch(() => null);
  const items = Array.isArray(body?.items)
    ? (body.items as Array<{ productId?: unknown; quantity?: unknown }>)
        .map((i) => ({ productId: String(i?.productId ?? ''), quantity: Number(i?.quantity ?? 0) }))
        .filter((i) => i.productId && Number.isInteger(i.quantity) && i.quantity > 0)
        .slice(0, 100)
    : [];

  const registry = Registry.getInstance();
  const [raw, versionId] = await Promise.all([
    registry.deliveryConfigReader.currentValues(),
    registry.deliveryConfigReader.publishedVersionId(),
  ]);

  const now = new Date();
  const parts = toEatParts(now);
  const areaSlug = typeof body?.areaSlug === 'string' ? body.areaSlug : null;
  const district = typeof body?.district === 'string' ? body.district : null;
  const subtotalUgx = Number.isFinite(Number(body?.subtotalUgx)) ? Number(body.subtotalUgx) : undefined;

  const key = quoteCacheKey({
    configVersionId: versionId,
    originCode: null,
    areaSlug,
    district,
    goodsTotalUgx: subtotalUgx ?? 0,
    hasPin: body?.hasPin === true,
    eatHourOfWeek: parts.weekday * 24 + parts.hour,
  });
  // The basket contents change the parcel plan, so they are part of identity.
  // The free-text destination is part of identity too: without it, 'Ntinda' and
  // 'Kajjansi' with the same basket shared one cached fee for sixty seconds.
  const areaText = typeof body?.deliveryArea === 'string' ? body.deliveryArea.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120) : '';
  const fullKey = `${key}:${areaText}:${items.map((i) => `${i.productId}x${i.quantity}`).sort().join(',')}`;
  const hit = CACHE.get(fullKey);
  if (hit && now.getTime() - hit.at < CACHE_TTL_MS) {
    return c.json({ success: true, data: hit.body } satisfies ApiResponse<unknown>);
  }
  if (hit) CACHE.delete(fullKey);

  const outcome = await registry.deliveryQuotingUseCase.execute({
    areaSlug,
    deliveryArea: typeof body?.deliveryArea === 'string' ? body.deliveryArea : null,
    district,
    items,
    subtotalUgx,
    at: now,
    hasPin: body?.hasPin === true,
  });

  let presented = presentQuote(outcome.quote);
  const copy = (k: string | null) => (k ? (raw[k] ?? null) : null);

  // CONFIG_INCOMPLETE — and only that — hands THIS request to the legacy zone
  // fee, exactly as CheckoutUseCase and /commerce/delivery-estimate do. Without
  // it the panel said "we are finalising pricing for your area" directly under
  // a Delivery row, and an order, carrying a CONFIRMED zone fee.
  if (outcome.mayFallBackToLegacy) {
    const districtName = outcome.resolved?.input.district || district;
    const canonical = districtName ? normalizeUgandaDistrict(districtName) : null;
    const zone = canonical ? await registry.deliveryZoneRepo.findByDistrict(normalizeDistrict(canonical)) : null;
    if (zone && zone.enabled) {
      const threshold = outcome.freeDeliveryThresholdUgx;
      const waived = threshold !== null && outcome.thresholdBasisUgx >= threshold;
      presented = { ...presented, tone: 'quoted', copyKey: null, feeUgx: waived ? 0 : zone.feeUgx };
    }
  }
  // Stage 2 ("this fee is fixed… our rider will never ask for a different
  // amount") only when there IS a fee. It used to follow whether the request
  // named a place, so it sat under answers that carried no fee at all.
  const hasFee = presented.feeUgx !== null;

  const data = {
    tone: presented.tone,
    feeUgx: presented.feeUgx,
    perParcelFeeUgx: presented.perParcelFeeUgx,
    parcelCount: presented.parcelCount,
    parcelSentence: presented.parcelSentence,
    parcelNotice: presented.parcelCount && presented.parcelCount > 1 ? copy('copy_parcel_count_notice') : null,
    // Every sentence resolved from the registry, never hardcoded on a page.
    message: copy(presented.copyKey),
    shipmentSentence: presented.shipmentSentence,
    windowSentence: windowSentence(presented.window),
    // Stage 1 before an area is known, stage 2 once it is. Stage 3 is the
    // variance path and lives on the order, not on a quote.
    disclaimer: copy(hasFee ? 'copy_fixed_stage2' : 'copy_estimate_stage1'),
    disclaimerStage: hasFee ? 2 : 1,
    // Alongside EVERY quote, whatever the outcome.
    pickup: copy('copy_pickup_offer'),
    pinNudge: copy('copy_pin_nudge'),
    // Business info: the one authority for the cutoff hour and closed days.
    cutoff: await registry.businessInfoService
      .getPublicConfig()
      .then((biz) => businessCutoffCountdown({ now, cutoffHour: biz.sameDayCutoffHour, closedDays: biz.closedDays }))
      .catch(() => null),
    // The SAME threshold the quote waived the fee on (the zone's own when its
    // policy is active), on the same basis — "qualifies" now means free.
    freeDelivery: freeDeliveryProgress({
      thresholdUgx: outcome.freeDeliveryThresholdUgx,
      basisUgx: outcome.thresholdBasisUgx,
    }),
    proportionality: presented.proportionality
      ? { ...presented.proportionality, message: copy('copy_fee_exceeds_value') }
      : null,
    belowMinimum: presented.belowMinimum
      ? { ...presented.belowMinimum, message: copy('copy_below_minimum_order') }
      : null,
    requiresAcknowledgement: presented.requiresAcknowledgement,
    mayBeDefault: presented.mayBeDefault,
    // The district a customer must narrow within, when that is what is needed.
    narrowWithinDistrict: presented.tone === 'needs_narrowing' ? (outcome.resolved?.input.district ?? district) : null,
    configVersionId: versionId,
  };

  cacheSet(fullKey, data, now.getTime());
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

/** The three disclaimer stages, so a page never hardcodes one. */
routes.get('/copy', async (c) => {
  const raw = await Registry.getInstance().deliveryConfigReader.currentValues();
  return c.json({
    success: true,
    data: {
      stage1: raw.copy_estimate_stage1 ?? null,
      stage2: raw.copy_fixed_stage2 ?? null,
      pickup: raw.copy_pickup_offer ?? null,
      pinNudge: raw.copy_pin_nudge ?? null,
      reasons: Object.fromEntries(Object.entries(REASON_COPY_KEY).map(([reason, key]) => [reason, raw[key] ?? null])),
    },
  });
});

export default routes;
