import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { Registry } from '../../../infrastructure/Registry';
import { ApiResponse } from '@goldplus/shared';
import { customerSessionMiddleware } from '../middleware/customerSession';
import { createHash } from 'crypto';
import { clientIp } from '../clientAddress';
import { CHECKOUT_POLICY_VERSION } from '../../../domain/commerce/CheckoutPrincipal';
import { isCheckoutSuccess } from '../../../application/use-cases/commerce/ExecuteCheckoutIntentUseCase';
import { isRedirectReady } from '../../../application/use-cases/commerce/StartOrderPaymentUseCase';
import { paymentDidConfirm } from '../../../application/use-cases/commerce/ReconcileOrderPaymentUseCase';
import { isCartApplied, type CartOutcome } from '../../../application/use-cases/commerce/MutateCartUseCase';
import { resolveCartCredential, cartRefusalStatus } from '../middleware/cartCredential';

import {
  applyOptionalCustomerSession,
  resolveCheckoutIntent,
} from '../middleware/checkoutIntent';
import { checkoutOperationIdentity, intentPrincipalKey, normalizeUgandaDistrict } from '@goldplus/shared';
import type { PaymentStartResponseDto } from '@goldplus/shared';
import { logger } from '../../../infrastructure/logging/logger';
import { toCheckoutResponseDto } from '../../../application/mappers/toCheckoutResponseDto';

// Slice 3B: server-authoritative checkout input. Client prices/sku/names are
// deliberately absent — only productId + quantity are trusted; extra fields
// sent by older clients are stripped, never used.
const checkoutBodySchema = z.object({
  customerDetails: z.object({
    name: z.string().trim().min(1).max(255),
    email: z.string().trim().email().max(255).optional().or(z.literal('').transform(() => undefined)),
    phone: z.string().trim().min(5).max(20),
    deliveryArea: z.string().trim().min(1).max(255),
    deliveryAddress: z.string().trim().min(1).max(255),
    deliveryLocation: z
      .object({
        // Canonicalised against the official district list. The old location
        // dataset shipped wrong districts (Kireka/Nansana under Mukono) and
        // that wrongness became order rows; the boundary now refuses what the
        // vocabulary cannot verify, and stores the canonical spelling.
        district: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .transform((value, ctx) => {
            const canonical = normalizeUgandaDistrict(value);
            if (!canonical) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `"${value}" is not a Uganda district. Pick the district from the list.`,
              });
              return z.NEVER;
            }
            return canonical;
          }),
        region: z.string().trim().max(100).optional(),
        areaSlug: z.string().trim().max(160).optional(),
        gpsLat: z.number().min(-2.5).max(5.5).optional(),
        gpsLng: z.number().min(28).max(36.5).optional(),
        gpsAccuracyM: z.number().min(0).max(100000).optional(),
        gpsSource: z.enum(['device', 'pasted_link']).optional(),
        countyOrMunicipality: z.string().trim().max(150).optional(),
        subcountyDivisionTc: z.string().trim().max(150).optional(),
        parishWard: z.string().trim().max(150).optional(),
        postcode: z.string().trim().max(20).optional(),
        displayLabel: z.string().trim().max(255).optional(),
      })
      .nullish(),
  }),
  buyerType: z.enum(['retail', 'wholesale', 'corporate']),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
      })
    )
    .min(1)
    .max(50),
  // No clientOrderKey. The operation identity is derived server-side from the
  // verified principal and the signed intent id, so the caller cannot influence
  // it at all. A field accepted here would be attacker-controlled by definition.
  couponCode: z.string().trim().min(3).max(40).nullish(),
  previewQuoteId: z.string().uuid().nullish(),
  acceptPriceChange: z.boolean().optional(),
  redeemPoints: z.number().int().positive().max(1_000_000).optional(),
  // Fingerprint inputs, all optional so an older client is not rejected. They cannot be
  // used to influence WHAT is bought — that is still items + quantities only — but they
  // do make "same key, different intent" detectable in three more ways.
  paymentMethod: z.enum(['pesapal', 'offline']).nullish(),
  cartId: z.string().uuid().nullish(),
  cartVersion: z.number().int().min(1).nullish(),
  // Marketing attribution (last-touch UTM + referrer). Optional, never trusted for
  // pricing — recorded best-effort after the order for reporting only.
  attribution: z
    .object({
      source: z.string().trim().max(120).nullish(),
      medium: z.string().trim().max(120).nullish(),
      campaign: z.string().trim().max(160).nullish(),
      term: z.string().trim().max(160).nullish(),
      content: z.string().trim().max(160).nullish(),
      landingPath: z.string().trim().max(2000).nullish(),
      referrer: z.string().trim().max(2000).nullish(),
      firstAt: z.string().trim().max(40).nullish(),
    })
    .nullish(),
});

const routes = new Hono();
const registry = Registry.getInstance();

/**
 * Loyalty at payment time (loyalty brief PART F): points no longer vest here —
 * vesting moved to DELIVERY confirmation via the order-transition subscriber,
 * which closes the refused-COD earn hole structurally. What payment
 * confirmation DOES settle is a prepaid redemption reservation: the discount
 * was honoured in the paid amount, so the points are consumed now.
 */
// settleLoyaltyOnPaymentConfirmed RETIRED 2026-08-06: loyalty settlement moved
// into SettlePaymentUseCase with the rest of the confirmation effects, so the
// callback, the IPN, the reconciliation poller and ops re-verify cannot drift.

// Public delivery-fee estimate for a destination. Returns CONFIRMED only when
// an enabled zone exists (the operator's standing promise); otherwise a
// clearly-labelled ESTIMATE from the geographic band model / observed medians,
// or UNAVAILABLE — never a guess dressed as a price.
routes.get('/delivery-estimate', async (c) => {
  const district = c.req.query('district') ?? '';
  const area = c.req.query('area') ?? null;
  const result = await registry.getDeliveryEstimateUseCase.execute({ district, area });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } }, 400);
  }
  return c.json({ success: true, data: result });
});

// Public programme terms so checkout can show a truthful earn preview. Terms
// only — the same numbers the marketing page states; never balances or ledgers.
routes.get('/loyalty-programme', async (c) => {
  const [active, config, programme] = await Promise.all([
    registry.loyaltyGate.isActive(),
    registry.loyaltyRepo.getConfig(),
    registry.loyaltyCompletionRepo.getProgrammeConfig(),
  ]);
  const redemptionConfigured =
    programme.pointValueUgx !== null && programme.redemptionMinPoints !== null && programme.redemptionMaxShareBps !== null;
  return c.json({
    success: true,
    data: {
      active,
      earnRatePer1000Ugx: active ? config.earnRatePer1000Ugx : 0,
      expiryDays: active ? config.expiryDays : 0,
      // PART G customer surface: value and limits shown WITH the balance —
      // absent config is stated as not-yet-configured, never defaulted.
      redemption: active && redemptionConfigured && !programme.killSwitch
        ? {
            configured: true as const,
            pointValueUgx: programme.pointValueUgx,
            minPoints: programme.redemptionMinPoints,
            maxShareBps: programme.redemptionMaxShareBps,
          }
        : { configured: false as const },
      // Vesting truth for customer copy: points vest on delivery.
      vesting: 'on_delivery' as const,
      // 0087 gamification surface: only ACTIVE earn sources appear, with the
      // real configured values — the page never promises an unshipped mechanic.
      earnSources: active && !programme.killSwitch
        ? {
            verificationScan: (await registry.loyaltyCompletionRepo.getActiveRule('verification_scan').catch(() => null))?.rate ?? null,
            counterfeitReport: (await registry.loyaltyCompletionRepo.getActiveRule('counterfeit_report').catch(() => null))?.rate ?? null,
            phoneVerification: (await registry.loyaltyCompletionRepo.getActiveRule('phone_verification').catch(() => null))?.rate ?? null,
            referral: programme.referralReferrerPoints !== null
              ? { referrer: programme.referralReferrerPoints, referee: programme.referralRefereePoints }
              : null,
            birthday: programme.birthdayPoints,
            streak: programme.streakTargetOrders !== null && programme.streakRewardPoints !== null
              ? { orders: programme.streakTargetOrders, windowDays: programme.streakWindowDays, points: programme.streakRewardPoints }
              : null,
          }
        : null,
      // Badge catalogue (0087): the real, admin-defined badges — public-safe
      // fields only. Empty until badges are configured (never an invented list).
      badges: active && !programme.killSwitch
        ? await registry.gamificationRepo.listCatalogBadges().catch(() => [])
        : [],
      // Active tiers (0087): thresholds + service benefits, public-safe fields only.
      tiers: active
        ? (await registry.loyaltyTierRepo.listTiers().catch(() => []))
            .filter((t) => t.active && t.thresholdLifetimePoints !== null)
            .map((t) => ({ code: t.code, name: t.name, threshold: t.thresholdLifetimePoints, benefits: t.benefits ?? {} }))
        : [],
      termsVersion: programme.termsVersion,
    },
  });
});

/**
 * Public business/contact info (0112) for the footer and contact points.
 * Falls back to DEFAULT — the footer is never a database outage.
 */
routes.get('/business-info', async (c) => {
  const data = await registry.businessInfoService.getPublicConfig();
  c.header('Cache-Control', 'public, max-age=60');
  return c.json({ success: true, data });
});

/**
 * The product discovery taxonomy (categories, subcategories, keywords, homepage
 * tiles, aliases) for the storefront. Falls back to DEFAULT — discovery is never
 * a database outage.
 */
routes.get('/taxonomy', async (c) => {
  const data = await registry.taxonomyService.getPublicConfig();
  c.header('Cache-Control', 'public, max-age=60');
  return c.json({ success: true, data });
});

/**
 * Homepage marketing content (trust strip + business-pathway cards) for the
 * storefront. Falls back to DEFAULT — the homepage is never a database outage.
 */
routes.get('/homepage-content', async (c) => {
  const data = await registry.homepageContentService.getPublicConfig();
  c.header('Cache-Control', 'public, max-age=60');
  return c.json({ success: true, data });
});

/**
 * Miscellaneous storefront copy (support intro + payment-method labels). Falls
 * back to DEFAULT — never a database outage.
 */
routes.get('/storefront-copy', async (c) => {
  const data = await registry.storefrontCopyService.getPublicConfig();
  c.header('Cache-Control', 'public, max-age=60');
  return c.json({ success: true, data });
});

/**
 * The active storefront discount for DISPLAY (card/PDP/cart).
 *
 * Reads the SAME active promotion versions the checkout evaluator charges from,
 * and reports the campaign ONLY when it is a single, unconditional, site-wide,
 * auto (no coupon) PERCENTAGE_OFF within its window — the exact case the display
 * can mirror penny-for-penny (sale = retail - floor(retail * bps / 10000)).
 * Anything more complex returns active:false, so the storefront never previews a
 * number different from what the evaluator will actually charge. Public + safe:
 * it only reveals the public discount percentage and its end date.
 */
routes.get('/storefront-discount', async (c) => {
  try {
    const now = new Date();
    const active = await registry.pricingRepo.listActiveVersions(now);
    const qualifying = active.filter(({ version }) =>
      version.conditions.length === 0 &&
      version.exclusions.length === 0 &&
      !version.couponCode &&
      version.schedule.startsAt <= now && now < version.schedule.endsAt &&
      version.benefits.some((b) => b.type === 'PERCENTAGE_OFF' && (!b.targetProductIds || b.targetProductIds.length === 0)),
    );
    if (qualifying.length !== 1) return c.json({ success: true, data: { active: false } });
    const { definition, version } = qualifying[0];
    const benefit = version.benefits.find((b) => b.type === 'PERCENTAGE_OFF' && (!b.targetProductIds || b.targetProductIds.length === 0))!;
    if (!Number.isFinite(benefit.value) || benefit.value <= 0 || benefit.value >= 10_000) return c.json({ success: true, data: { active: false } });
    return c.json({
      success: true,
      data: {
        active: true,
        percentBps: benefit.value,
        percent: Math.round(benefit.value / 100),
        // The evaluator caps every line at this floor
        // (`available = base - prior - priceFloorUgx * quantity`). Omitting it
        // here made the display promise a price the checkout would refuse to
        // charge — the exact divergence this endpoint exists to prevent.
        priceFloorUgx: version.priceFloorUgx,
        endsIso: version.schedule.endsAt.toISOString(),
        name: definition.name,
      },
    });
  } catch {
    return c.json({ success: true, data: { active: false } });
  }
});

/**
 * Promo-code preview: the SAME evaluator that charges at checkout, run against
 * the caller's basket with and without the code, so the shown effect equals the
 * charge to the shilling. Returns the persisted quoteId — checkout passes it as
 * previewQuoteId and the existing PRICE_CHANGED consistency gate holds the
 * promise. Server-priced from canonical retail (client prices are ignored), so
 * this reveals nothing a PDP does not. An unknown or unqualified code is a
 * truthful zero with a reason, never an error page.
 */
routes.post('/pricing-preview', async (c) => {
  const body = await c.req.json().catch(() => null);
  const rawItems = Array.isArray(body?.items) ? body.items.slice(0, 50) : [];
  const items = rawItems
    .map((i: any) => ({ productId: String(i?.productId ?? ''), quantity: Number(i?.quantity) }))
    .filter((i: any) => /^[0-9a-f-]{36}$/i.test(i.productId) && Number.isInteger(i.quantity) && i.quantity >= 1 && i.quantity <= 99);
  if (items.length === 0) {
    return c.json({ success: false, error: { code: 'INVALID_BASKET', message: 'Pricing preview needs the basket items.' } }, 400);
  }
  const couponCode = typeof body?.couponCode === 'string' && body.couponCode.trim() ? body.couponCode.trim().slice(0, 40) : null;
  try {
    // Baseline first (auto promotions only), then with the code: the delta is
    // the coupon's true effect under the live stacking rules.
    const base = await registry.evaluateCartPricingUseCase.execute({ items, couponCode: null, persist: false });
    const quote = couponCode
      ? await registry.evaluateCartPricingUseCase.execute({ items, couponCode, persist: true })
      : await registry.evaluateCartPricingUseCase.execute({ items, couponCode: null, persist: true });
    const couponDiscountUgx = couponCode ? Math.max(0, quote.discountTotalUgx - base.discountTotalUgx) : 0;
    return c.json({
      success: true,
      data: {
        quoteId: quote.id,
        baseSubtotalUgx: quote.baseSubtotalUgx,
        discountTotalUgx: quote.discountTotalUgx,
        goodsTotalUgx: quote.finalTotalUgx - quote.shippingUgx - quote.taxUgx,
        couponApplied: couponDiscountUgx > 0,
        couponDiscountUgx,
        couponMessage: couponCode
          ? couponDiscountUgx > 0
            ? null
            : "This code doesn't match a live offer for this basket, or its conditions aren't met."
          : null,
        expiresAt: quote.expiresAt.toISOString(),
      },
    });
  } catch (error) {
    const code = (error as { code?: string })?.code ?? 'PRICING_UNAVAILABLE';
    const message = error instanceof Error ? error.message : 'Pricing preview is unavailable right now.';
    return c.json({ success: false, error: { code, message } }, 400);
  }
});

/**
 * Public odds disclosure for the reward draw (0088).
 *
 * Deliberately public and unauthenticated: the odds a customer is offered
 * should be readable before they hold a card, and the terms page renders from
 * this so the disclosure is generated by the same weights the engine selects
 * on. Returns enabled:false — never an invented table — when draws are off.
 */
routes.get('/reward-draw', async (c) => {
  const config = await registry.loyaltyCompletionRepo.getProgrammeConfig();
  if (!config.enabled || config.killSwitch || !config.chanceEnabled) {
    return c.json({ success: true, data: { enabled: false } });
  }
  const campaign = await registry.loyaltyDrawRepo.findActiveCampaignByTrigger('order_delivered');
  if (!campaign) return c.json({ success: true, data: { enabled: false } });
  const prizes = await registry.loyaltyDrawRepo.listPrizes(campaign.id);
  const { publishedOdds } = await import('../../../domain/loyalty/RewardDraw');
  return c.json({
    success: true,
    data: {
      enabled: true,
      name: (campaign as unknown as { name?: string }).name ?? campaign.code,
      tokenExpiryDays: campaign.tokenExpiryDays,
      odds: publishedOdds(prizes).map((o) => ({ label: o.label, oddsBps: o.oddsBps, soldOut: o.soldOut })),
    },
  });
});

// ---------------------------------------------------------------------------
// Cart
//
// Every route below previously took a `cartId` from the request body or path and
// acted on it with NO authorization of any kind: add items to any cart, change any
// quantity, empty any cart, read any cart's contents. The id is a v4 UUID, so it is
// not guessable — but the design rested on that secrecy, and the value travels where
// a secret must not. It is the browser's `goldplus_cart_id` cookie, and on the read
// route it was a URL PATH SEGMENT, so it reached access logs, proxy logs, browser
// history and Referer headers.
//
// The cart id now comes from a SIGNED CREDENTIAL, never from the request payload, and
// the routes are thin: schema, identity, delegate, map.
// ---------------------------------------------------------------------------

/** Bounded so an oversized or malformed payload is refused before any work. */
const cartMutationSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(0).max(999).optional(),
  /** The version the caller believes it is changing. Optional on a first write. */
  expectedVersion: z.number().int().min(1).optional(),
});

const cartClearSchema = z.object({
  expectedVersion: z.number().int().min(1).optional(),
});

/**
 * Refusal codes safe to name back to the caller.
 *
 * NOT_OWNED is deliberately reported as CART_NOT_FOUND by the use case, so a caller
 * probing ids cannot tell an existing cart from a missing one.
 */
const CART_REFUSAL_STATUS: Record<string, 404 | 409 | 422 | 503> = {
  CART_NOT_FOUND: 404,
  NOT_OWNED: 404,
  VERSION_CONFLICT: 409,
  PRODUCT_UNAVAILABLE: 409,
  QUANTITY_OUT_OF_BOUNDS: 422,
  CART_LIMIT_EXCEEDED: 422,
  RETRYABLE_FAILURE: 503,
};

const CART_REFUSAL_MESSAGE: Record<string, string> = {
  CART_NOT_FOUND: 'This basket is no longer available. Please start a new one.',
  NOT_OWNED: 'This basket is no longer available. Please start a new one.',
  VERSION_CONFLICT: 'Your basket changed in another tab. It has been refreshed — please try again.',
  PRODUCT_UNAVAILABLE: 'One or more items are no longer available. Please review your basket.',
  QUANTITY_OUT_OF_BOUNDS: 'That quantity is not allowed.',
  CART_LIMIT_EXCEEDED: 'Your basket has too many different products.',
  RETRYABLE_FAILURE: 'The basket service is temporarily unavailable. Please try again.',
};

/**
 * Establishes who the caller is and which cart they may touch.
 *
 * Returns a Response on refusal so each handler stays a single expression rather than
 * repeating four lines of error mapping — which is how one of them came to be missed.
 */
async function requireCart(c: Context) {
  // The session is resolved FIRST: a USER-owned cart is cross-checked against it, and
  // that check cannot run before the session is known.
  await applyOptionalCustomerSession(c);
  const resolved = resolveCartCredential(c);
  if (!resolved.ok) {
    return {
      refusal: c.json(
        {
          success: false,
          error: {
            code: resolved.code,
            message:
              resolved.code === 'CART_SESSION_UNAVAILABLE'
                ? 'The basket service is temporarily unavailable. Please try again.'
                : 'Your basket session has expired. Please reload the page.',
          },
        },
        cartRefusalStatus(resolved.code),
      ),
    } as const;
  }
  return {
    claims: resolved.claims,
    owner: { kind: resolved.claims.ownerKind, id: resolved.claims.ownerId },
    traceId: c.req.header('x-request-id') ?? crypto.randomUUID(),
  } as const;
}

function cartResponse(c: Context, outcome: CartOutcome) {
  if (isCartApplied(outcome)) {
    return c.json({ success: true, data: outcome.cart });
  }

  if (outcome.kind === 'VERSION_CONFLICT') {
    // The refreshed cart is returned WITH the conflict, so the storefront can show
    // the customer what the basket actually holds instead of an error with no state.
    return c.json(
      {
        success: false,
        error: {
          code: 'VERSION_CONFLICT',
          message: CART_REFUSAL_MESSAGE.VERSION_CONFLICT,
          details: outcome.cart,
        },
      },
      409,
    );
  }

  const status = CART_REFUSAL_STATUS[outcome.kind] ?? 400;
  return c.json(
    {
      success: false,
      // A stable code and a fixed message. The previous handlers returned
      // `err.message`, which carries query fragments and internal identifiers.
      error: {
        code: outcome.kind,
        message: CART_REFUSAL_MESSAGE[outcome.kind] ?? 'The basket could not be updated.',
        ...(outcome.kind === 'PRODUCT_UNAVAILABLE' ? { details: { productIds: outcome.reason.split(',') } } : {}),
      },
    },
    status,
  );
}

routes.get('/cart', async (c) => {
  const gate = await requireCart(c);
  if ('refusal' in gate) return gate.refusal;
  const outcome = await registry.mutateCartUseCase.read({
    cartId: gate.claims.cartId,
    owner: gate.owner,
    traceId: gate.traceId,
  });
  return cartResponse(c, outcome);
});

routes.post('/cart/add', async (c) => {
  const gate = await requireCart(c);
  if ('refusal' in gate) return gate.refusal;

  const parsed = cartMutationSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ success: false, error: { code: 'INVALID_CART_REQUEST', message: 'Invalid basket request.' } }, 400);
  }

  const outcome = await registry.mutateCartUseCase.mutate({
    cartId: gate.claims.cartId,
    owner: gate.owner,
    expectedVersion: parsed.data.expectedVersion,
    // Defaults to one, which is what an "add to basket" button means. Zero is not a
    // meaningful add and would silently do nothing.
    mutation: { kind: 'ADD', productId: parsed.data.productId, quantity: parsed.data.quantity ?? 1 },
    traceId: gate.traceId,
  });
  return cartResponse(c, outcome);
});

routes.post('/cart/update', async (c) => {
  const gate = await requireCart(c);
  if ('refusal' in gate) return gate.refusal;

  const parsed = cartMutationSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || parsed.data.quantity === undefined) {
    return c.json({ success: false, error: { code: 'INVALID_CART_REQUEST', message: 'Invalid basket request.' } }, 400);
  }

  const outcome = await registry.mutateCartUseCase.mutate({
    cartId: gate.claims.cartId,
    owner: gate.owner,
    expectedVersion: parsed.data.expectedVersion,
    mutation: { kind: 'UPDATE', productId: parsed.data.productId, quantity: parsed.data.quantity },
    traceId: gate.traceId,
  });
  return cartResponse(c, outcome);
});

routes.post('/cart/remove', async (c) => {
  const gate = await requireCart(c);
  if ('refusal' in gate) return gate.refusal;

  const parsed = cartMutationSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ success: false, error: { code: 'INVALID_CART_REQUEST', message: 'Invalid basket request.' } }, 400);
  }

  const outcome = await registry.mutateCartUseCase.mutate({
    cartId: gate.claims.cartId,
    owner: gate.owner,
    expectedVersion: parsed.data.expectedVersion,
    mutation: { kind: 'REMOVE', productId: parsed.data.productId },
    traceId: gate.traceId,
  });
  return cartResponse(c, outcome);
});

routes.post('/cart/clear', async (c) => {
  const gate = await requireCart(c);
  if ('refusal' in gate) return gate.refusal;

  const parsed = cartClearSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ success: false, error: { code: 'INVALID_CART_REQUEST', message: 'Invalid basket request.' } }, 400);
  }

  const outcome = await registry.mutateCartUseCase.mutate({
    cartId: gate.claims.cartId,
    owner: gate.owner,
    expectedVersion: parsed.data.expectedVersion,
    mutation: { kind: 'CLEAR' },
    traceId: gate.traceId,
  });
  return cartResponse(c, outcome);
});

routes.post('/orders/create', async (c) => {
  // Thin transport adapter. Validate input, establish identity, delegate, map.
  // Orchestration — fingerprinting, claiming, fencing, pricing, order creation,
  // reservation, side effects, completion and failure classification — lives in
  // ExecuteCheckoutIntentUseCase, so transaction and recovery policy is testable
  // without HTTP and reusable by any other caller.
  const raw = await c.req.json().catch(() => null);
  const parsed = checkoutBodySchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const message = first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid checkout payload.';
    return c.json({ success: false, error: { code: 'INVALID_CHECKOUT', message } }, 400);
  }
  const body = parsed.data;

  await applyOptionalCustomerSession(c);

  const intent = resolveCheckoutIntent(c);
  if (!intent.ok) {
    const status = intent.code === 'CHECKOUT_SESSION_UNAVAILABLE' ? 503 : 409;
    return c.json({
      success: false,
      error: {
        code: intent.code,
        message:
          intent.code === 'CHECKOUT_SESSION_UNAVAILABLE'
            ? 'Checkout is temporarily unavailable. Please try again.'
            : 'Your checkout session is no longer valid. Please reload the checkout page.',
      },
    }, status);
  }
  const claims = intent.claims;
  const traceId = c.req.header('x-request-id') ?? crypto.randomUUID();

  // R3.1: the experience profile is resolved server-side from the HttpOnly
  // visit token the web SSR forwards — the ONE identity join that lets a paid
  // order be attributed to the recommendations this visitor actually saw.
  // Resolution failure never blocks checkout.
  let checkoutProfileId: string | null = null;
  const rawVisitToken = c.req.header('x-gp-visit');
  if (rawVisitToken) {
    try {
      checkoutProfileId = (await registry.resolveExperienceProfileUseCase.execute(rawVisitToken))?.id ?? null;
    } catch {
      // Provenance, not correctness.
    }
  }

  const outcome = await registry.executeCheckoutIntentUseCase.execute({
    claims,
    profileId: checkoutProfileId,
    // Derived server-side: a hidden form field would be caller-controlled.
    identity: checkoutOperationIdentity(claims, 'CREATE_ORDER', CHECKOUT_POLICY_VERSION),
    principalKey: intentPrincipalKey(claims),
    customerDetails: body.customerDetails,
    buyerType: body.buyerType,
    items: body.items,
    couponCode: body.couponCode ?? null,
    previewQuoteId: body.previewQuoteId ?? null,
    acceptPriceChange: body.acceptPriceChange ?? false,
    redeemPoints: body.redeemPoints ?? null,
    // Fingerprint inputs. The payment method matters because online and offline are
    // materially different operations; the basket id and version pin which basket state
    // was priced, which the item list alone cannot express.
    paymentMethod: body.paymentMethod ?? null,
    cartId: body.cartId ?? null,
    cartVersion: body.cartVersion ?? null,
    traceId,
  });

  if (isCheckoutSuccess(outcome)) {
    const dto = toCheckoutResponseDto({
      order: outcome.order,
      reservationState: outcome.reservationState,
      deliveryFeeConfirmed: outcome.deliveryFeeConfirmed,
      idempotentReplay: outcome.idempotentReplay,
    });

    // Best-effort marketing attribution — recorded AFTER the order, never affects it.
    if (body.attribution && (outcome.order as any)?.id) {
      void registry.orderAttributionRepo
        .record({ orderId: (outcome.order as any).id, orderNumber: (outcome.order as any).orderNumber ?? null, ...body.attribution })
        .catch(() => undefined);
    }

    if (outcome.kind === 'BLOCKED_STOCK') {
      // The order exists and is recorded truthfully, but it does not progress.
      return c.json({
        success: false,
        error: {
          code: 'STOCK_NOT_RESERVED',
          message:
            'Your order was recorded but stock could not be confirmed, so it cannot be paid for yet. Our team will contact you.',
          details: dto,
        },
      }, 409);
    }
    return c.json({ success: true, data: dto, meta: { traceId } });
  }

  // Expected commerce decisions are typed, not parsed out of error messages.
  const mapping: Record<string, { status: 400 | 409 | 503; code: string; message: string }> = {
    CHECKOUT_IN_PROGRESS: {
      status: 409, code: 'CHECKOUT_IN_PROGRESS',
      message: 'This order is already being processed. Please wait a moment.',
    },
    IDEMPOTENCY_CONFLICT: {
      status: 409, code: 'IDEMPOTENCY_CONFLICT',
      message: 'This checkout reference was already used for a different order. Start a new checkout.',
    },
    LEASE_LOST: {
      status: 409, code: 'CHECKOUT_IN_PROGRESS',
      message: 'This order is already being processed. Please wait a moment.',
    },
    PRICE_REVIEW_REQUIRED: {
      status: 409, code: 'PRICE_CHANGED',
      message: 'The price changed since you started. Please review the updated total.',
    },
    INTENT_INVALID: {
      status: 409, code: 'CHECKOUT_INTENT_INVALID',
      message: 'Your checkout session is no longer valid. Please reload the checkout page.',
    },
    SESSION_INVALID: {
      status: 409, code: 'CHECKOUT_INTENT_INVALID',
      message: 'Please sign in again to complete this order.',
    },
    FAILED_FINAL: { status: 400, code: 'ORDER_FAILED', message: 'This order cannot be completed.' },
    FAILED_RETRYABLE: {
      status: 503, code: 'ORDER_FAILED',
      message: 'The order could not be completed. Please try again.',
    },
  };

  const mapped = mapping[outcome.kind] ?? {
    status: 400 as const, code: 'ORDER_FAILED',
    message: 'The order could not be completed. Please try again.',
  };
  if (outcome.retryAfterSeconds) c.header('Retry-After', String(outcome.retryAfterSeconds));

  // The kind AND the typed reason, together. The public body carries a collapsed
  // code by design, so without this line two different refusals — a conflicting
  // fingerprint and a lost lease — are indistinguishable in the logs, and an
  // operator investigating "customers cannot check out" has nothing to go on.
  logger.warn(
    { outcome: outcome.kind, reason: outcome.reason, traceId },
    'CHECKOUT_REFUSED',
  );

  // A known business rejection is named by its CODE (the storefront maps it to
  // its own wording); an unexpected one never leaks internal text, which can
  // carry query fragments. The code used to be prefixed onto the sentence as
  // well — "PRICE_CHANGED: The price changed…" — which put a SCREAMING_SNAKE
  // enum in front of the customer on the most sensitive refusal there is.
  const publicMessage = mapped.message;

  return c.json({
    success: false,
    error: { code: mapped.code, message: publicMessage },
    meta: { traceId },
  }, mapped.status);
});

const maskPhone = (phone: string | null | undefined) => {
  if (!phone) return '*****';
  if (phone.length <= 5) return '*****';
  return phone.slice(0, 3) + '****' + phone.slice(-3);
};

const maskEmail = (email: string | null | undefined) => {
  if (!email) return '*****';
  const parts = email.split('@');
  if (parts.length !== 2) return '*****';
  const name = parts[0];
  const domain = parts[1];
  if (name.length <= 2) return '*@' + domain;
  return name.slice(0, 1) + '***' + name.slice(-1) + '@' + domain;
};

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const failedAttemptsLimiter = new Map<string, RateLimitEntry>();

routes.post('/orders/lookup', async (c) => {
  try {
    const body = await c.req.json();
    const rawRef = body.reference;
    const rawContact = body.contact;

    // Strict type safety: reject non-string inputs immediately to prevent malformed payload abuse
    if (typeof rawRef !== 'string' || typeof rawContact !== 'string') {
      return c.json({
        success: false,
        error: {
          code: 'VERIFICATION_FAILED',
          message: 'We could not verify that order. Please check your reference and contact details.'
        }
      }, 400);
    }

    const reference = rawRef.trim();
    const contact = rawContact.trim();

    // Enforce size limits and non-empty checks
    if (!reference || !contact || reference.length > 80 || contact.length > 120) {
      return c.json({
        success: false,
        error: {
          code: 'VERIFICATION_FAILED',
          message: 'We could not verify that order. Please check your reference and contact details.'
        }
      }, 400);
    }

    // Direct block of GP-DRAFT lookups to avoid hitting the database
    if (reference.toUpperCase().startsWith('GP-DRAFT-')) {
      return c.json({
        success: false,
        error: {
          code: 'VERIFICATION_FAILED',
          message: 'We could not verify that order. Please check your reference and contact details.'
        }
      }, 400);
    }

    const ip = clientIp(c);

    // Create safe anonymous fingerprint using SHA-256 (no raw credentials stored in keys)
    const fingerprint = createHash('sha256')
      .update(`${ip}-${reference.toUpperCase()}`)
      .digest('hex');

    const now = Date.now();
    const limitWindowMs = 10 * 60 * 1000; // 10 minutes
    const maxFailedAttempts = 5;

    // Self-cleaning Map inline to prevent memory growth
    for (const [key, val] of failedAttemptsLimiter.entries()) {
      if (val.resetTime <= now) {
        failedAttemptsLimiter.delete(key);
      }
    }

    // Rate Limiter Enforcement
    const record = failedAttemptsLimiter.get(fingerprint);
    if (record && record.resetTime > now) {
      if (record.count >= maxFailedAttempts) {
        return c.json({
          success: false,
          error: {
            code: 'TOO_MANY_REQUESTS',
            message: 'Too many lookup attempts. Please wait a few minutes and try again.'
          }
        }, 429);
      }
    }

    const registerFailure = () => {
      const current = failedAttemptsLimiter.get(fingerprint);
      if (current && current.resetTime > now) {
        current.count += 1;
      } else {
        failedAttemptsLimiter.set(fingerprint, {
          count: 1,
          resetTime: now + limitWindowMs,
        });
      }
    };

    const order = await registry.getOrderByIdUseCase.execute(reference);
    if (!order) {
      registerFailure();
      return c.json({
        success: false,
        error: {
          code: 'VERIFICATION_FAILED',
          message: 'We could not verify that order. Please check your reference and contact details.'
        }
      }, 401);
    }

    const normalizedContact = contact.toLowerCase();
    const storedEmail = (order.customerEmail ?? '').trim().toLowerCase();
    const storedPhone = (order.customerPhone ?? '').trim();

    const contactMatch =
      (storedEmail && normalizedContact === storedEmail) ||
      (storedPhone && normalizedContact.replace(/\s+/g, '') === storedPhone.replace(/\s+/g, ''));

    if (!contactMatch) {
      registerFailure();
      return c.json({
        success: false,
        error: {
          code: 'VERIFICATION_FAILED',
          message: 'We could not verify that order. Please check your reference and contact details.'
        }
      }, 401);
    }

    // Clean rate limit tracking on success
    failedAttemptsLimiter.delete(fingerprint);

    // Minimize public response fields to prevent unnecessary database UUIDs or coordinates from leaking
    const maskedOrder = {
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      customerPhone: maskPhone(order.customerPhone),
      customerEmail: order.customerEmail ? maskEmail(order.customerEmail) : undefined,
      deliveryArea: order.deliveryArea,
      items: order.items,
      subtotalUgx: order.subtotalUgx,
      deliveryFeeUgx: order.deliveryFeeUgx,
      totalUgx: order.totalUgx,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      createdAt: order.createdAt,
    };

    const res: ApiResponse<any> = {
      success: true,
      data: maskedOrder,
    };
    return c.json(res);
  } catch (err: any) {
    if (err.message.includes('DATABASE_URL') || err.message.includes('relation "orders" does not exist')) {
      return c.json({ success: false, error: { code: 'DB_NOT_CONFIGURED', message: 'Database not configured yet' } }, 503);
    }
    return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred.' } }, 500);
  }
});

routes.get('/orders/:id', customerSessionMiddleware, async (c) => {
  try {
    const id = c.req.param('id') || '';
    const order = await registry.getOrderByIdUseCase.execute(id);
    
    if (!order) {
      return c.json({ success: false, error: { code: 'ORDER_NOT_FOUND', message: 'Order not found' } }, 404);
    }

    const res: ApiResponse<any> = {
      success: true,
      data: order,
    };
    return c.json(res);
  } catch (err: any) {
    if (err.message.includes('DATABASE_URL') || err.message.includes('relation "orders" does not exist')) {
      return c.json({ success: false, error: { code: 'DB_NOT_CONFIGURED', message: 'Database not configured yet' } }, 503);
    }
    return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } }, 500);
  }
});

/**
 * Starts payment for an order the caller owns.
 *
 * The previous handler took an orderId from the request body, started a provider
 * transaction against it with no authorization whatsoever, and answered every
 * failure with HTTP 400 carrying the server's own error message — so a missing IPN
 * configuration reached the customer as a bad request with internal text in it.
 *
 * The principal is now derived server-side from the verified checkout intent, and
 * outcomes are typed. This handler only maps them to status codes.
 */
routes.post('/payments/pesapal/start', async (c) => {
  const traceId = createHash('sha256')
    .update(`${Date.now()}:${Math.random()}`)
    .digest('hex')
    .slice(0, 16);

  const intent = await resolveCheckoutIntent(c);
  if (!intent.ok) {
    // No verified principal means nothing to authorize against. Refused before the
    // order id is even looked at.
    return c.json(
      { success: false, error: { code: 'CHECKOUT_INTENT_REQUIRED', message: 'Your checkout session expired. Please reload and try again.', traceId } },
      401,
    );
  }

  let orderId = '';
  try {
    const body = await c.req.json();
    orderId = String(body?.orderId ?? '').trim();
  } catch {
    orderId = '';
  }

  const outcome = await registry.startOrderPaymentUseCase.execute({
    orderId,
    principalKey: intentPrincipalKey(intent.claims),
    traceId,
  });

  if (isRedirectReady(outcome)) {
    const data: PaymentStartResponseDto = {
      redirectUrl: outcome.redirectUrl,
      orderTrackingId: outcome.orderTrackingId,
      merchantReference: outcome.merchantReference,
      reused: outcome.kind === 'ALREADY_STARTED',
    };
    return c.json({ success: true, data });
  }

  // Status per outcome, not one blanket 400. A server misconfiguration is a 503,
  // an already-paid order is a 409, and neither is the caller's mistake.
  const status =
    outcome.kind === 'NOT_FOUND' ? 404
    : outcome.kind === 'ALREADY_PAID' ? 409
    : outcome.kind === 'PROVIDER_NOT_CONFIGURED' ? 503
    : outcome.kind === 'PROVIDER_UNAVAILABLE' ? 502
    : 409;

  const code =
    outcome.kind === 'PROVIDER_NOT_CONFIGURED' ? 'PAYMENT_NOT_CONFIGURED'
    : outcome.kind === 'PROVIDER_UNAVAILABLE' ? 'PAYMENT_PROVIDER_UNAVAILABLE'
    : outcome.reason;

  return c.json(
    {
      success: false,
      // A stable code and a generic message. The diagnostic detail is in the log
      // line the trace id points at, not in the customer's browser.
      error: { code, message: 'Payment could not be started for this order.', traceId },
    },
    status as 404 | 409 | 502 | 503,
  );
});

routes.get('/payments/pesapal/callback', async (c) => {
  const trackingId = c.req.query('OrderTrackingId') || c.req.query('orderTrackingId') || '';
  const reference = c.req.query('OrderMerchantReference') || c.req.query('orderMerchantReference') || '';
  
  const frontendCallbackUrl = process.env.PESAPAL_CALLBACK_URL || 'http://localhost:3000/checkout/pesapal/callback';

  if (!trackingId || !reference) {
    // Without both ids nothing can be settled, so nothing is known about the
    // money — "unknown", not "failed", which the page renders as "not charged".
    return c.redirect(`${frontendCallbackUrl}?status=unknown_attempt`);
  }

  try {
    // ONE settlement path for callback, IPN, poller and ops re-verify. The
    // ~90-line effects block that used to live here is inside it, reported
    // per-effect rather than swallowed.
    const { verification: result, settlement } = await registry.settlePaymentUseCase.execute({
      orderTrackingId: trackingId,
      merchantReference: reference,
      source: 'callback',
      traceId: c.req.header('x-request-id') ?? crypto.randomUUID(),
    });
    void result;

    // What the CUSTOMER is told follows the settlement, not the raw provider status.
    // Reading the status directly here could show "success" for a payment the settlement
    // parked for review — the two would disagree, and the customer would believe the more
    // optimistic one.
    if (paymentDidConfirm(settlement)) {
      return c.redirect(`${frontendCallbackUrl}?status=success&trackingId=${encodeURIComponent(trackingId)}&reference=${encodeURIComponent(reference)}`);
    }

    // Deliberately no provider message in the URL: it is provider text on a page the
    // customer sees, and the storefront maps this code to its own wording.
    return c.redirect(`${frontendCallbackUrl}?status=${encodeURIComponent(settlement.kind.toLowerCase())}&trackingId=${encodeURIComponent(trackingId)}&reference=${encodeURIComponent(reference)}&code=${encodeURIComponent(settlement.reason)}`);
  } catch (err: any) {
    console.error('[API_ERROR] PesaPal callback failed:', err);
    // An exception here means we do NOT know what happened to the money, so
    // the customer is told exactly that — never "failed" (which the page
    // renders as "you have not been charged"), and never the exception text.
    return c.redirect(`${frontendCallbackUrl}?status=unknown_attempt&trackingId=${encodeURIComponent(trackingId)}&reference=${encodeURIComponent(reference)}`);
  }
});

const handleIpn = async (c: any) => {
  let trackingId = '';
  let reference = '';
  let notificationType = '';

  trackingId = c.req.query('OrderTrackingId') || c.req.query('orderTrackingId') || '';
  reference = c.req.query('OrderMerchantReference') || c.req.query('orderMerchantReference') || '';
  notificationType = c.req.query('OrderNotificationType') || c.req.query('orderNotificationType') || '';

  if (c.req.method === 'POST') {
    try {
      const body = await c.req.json();
      trackingId = trackingId || body.OrderTrackingId || body.orderTrackingId || '';
      reference = reference || body.OrderMerchantReference || body.orderMerchantReference || '';
      notificationType = notificationType || body.OrderNotificationType || body.orderNotificationType || '';
    } catch {
      // Ignore body parsing issues
    }
  }

  if (!trackingId || !reference) {
    return c.json({ error: 'Missing required parameters' }, 400);
  }

  try {
    // Same single settlement path as the browser callback. An IPN for an
    // unknown or unverifiable payment progresses nothing and is still
    // acknowledged 200, so the provider stops retrying a question we have
    // already answered.
    await registry.settlePaymentUseCase.execute({
      orderTrackingId: trackingId,
      merchantReference: reference,
      source: 'ipn',
      traceId: c.req.header('x-request-id') ?? crypto.randomUUID(),
    });

    return c.json({
      orderNotificationType: notificationType || 'IPNCHANGE',
      orderTrackingId: trackingId,
      orderMerchantReference: reference,
      status: 200
    });
  } catch (err: any) {
    console.error('[API_ERROR] PesaPal IPN failed:', err);
    return c.json({ error: 'An internal error occurred.' }, 500);
  }
};

routes.post('/payments/pesapal/ipn', handleIpn);
routes.get('/payments/pesapal/ipn', handleIpn);

export default routes;
