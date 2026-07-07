import { z } from 'zod';

/**
 * PHASE 3 — CANONICAL EVENT GOVERNANCE
 *
 * Self-Critique Fix: Event names align exactly with GA4/GTM canonical naming
 * conventions. All optional fields are typed correctly, no runtime coercion surprises.
 *
 * IMMUTABLE RULE: Every event MUST have a `event_id` (UUID v4, deterministic).
 * This is the deduplication key for Meta CAPI, TikTok Events API, and GA4.
 *
 * PURCHASE events are ALWAYS sourced from the server — never the browser.
 * The browser schema variant (TelemetryBrowserEventSchema) omits purchase.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Sub-schemas
// ─────────────────────────────────────────────────────────────────────────────

/** All ad-network click IDs and browser fingerprints forwarded server-side */
export const TelemetryUserDataSchema = z.object({
  // Hashed PII — SHA-256 + pepper, all lowercase, whitespace-stripped before hashing
  hashed_email: z.string().length(64).optional(),
  hashed_phone: z.string().length(64).optional(),

  // First-party identity
  fp_client_id: z.string().max(255).optional(),
  user_id:      z.string().uuid().optional(),
  session_id:   z.string().max(255).optional(),

  // Ad-network attribution signals
  gclid:     z.string().max(512).optional(),
  wbraid:    z.string().max(512).optional(),
  gbraid:    z.string().max(512).optional(),
  fbc:       z.string().max(512).optional(),
  fbp:       z.string().max(512).optional(),
  ttclid:    z.string().max(512).optional(),
  twclid:    z.string().max(512).optional(),
  li_fat_id: z.string().max(512).optional(),
  epik:      z.string().max(512).optional(),

  // Forwarded from browser for CAPI IP/UA matching requirements
  ip_address: z.string().max(64).optional(),
  user_agent: z.string().max(1024).optional(),
});

export const TelemetryItemSchema = z.object({
  item_id:       z.string().max(255),
  item_name:     z.string().max(500).optional(),
  price:         z.number().nonnegative().optional(),
  quantity:      z.number().int().positive().default(1),
  item_category: z.string().max(255).optional(),
  item_brand:    z.string().max(255).optional(),
  item_variant:  z.string().max(255).optional(),
});

export const TelemetryEcommerceSchema = z.object({
  transaction_id: z.string().max(255).optional(),
  value:          z.number().nonnegative().optional(),
  currency:       z.string().length(3).default('UGX'), // ISO 4217
  items:          z.array(TelemetryItemSchema).max(200).optional(),
  coupon:         z.string().max(100).optional(),
  shipping:       z.number().nonnegative().optional(),
  tax:            z.number().nonnegative().optional(),
});

/** Recommendation engine context for attribution and ML evaluation */
export const TelemetryRecommendationContextSchema = z.object({
  algo_version:  z.string().max(50).optional(),
  strategy:      z.string().max(100).optional(),  // e.g. "collaborative_filtering"
  rank_position: z.number().int().nonnegative().optional(),
  item_list_id:  z.string().max(255).optional(),
  item_list_name: z.string().max(500).optional(),
  session_attribution_window_days: z.number().int().positive().default(7),
});

// ─────────────────────────────────────────────────────────────────────────────
// Server-Canonical Event Names (full set, including purchase)
// ─────────────────────────────────────────────────────────────────────────────
export const CANONICAL_EVENT_NAMES = [
  'view_item_list',
  'select_item',
  'view_item',
  'add_to_cart',
  'remove_from_cart',
  'begin_checkout',
  'add_shipping_info',
  'add_payment_info',
  'purchase',  // SERVER-SIDE ONLY — guarded in router-level middleware
] as const;

export type CanonicalEventName = typeof CANONICAL_EVENT_NAMES[number];

// ─────────────────────────────────────────────────────────────────────────────
// MASTER SCHEMA — accepted by the server-side telemetry worker
// ─────────────────────────────────────────────────────────────────────────────
export const CanonicalTelemetryEventSchema = z.object({
  event_name: z.enum(CANONICAL_EVENT_NAMES),

  /**
   * Deterministic UUID v4. MUST be identical between browser and server
   * for the same real-world event. This is the deduplication key for
   * Meta CAPI, TikTok Events API, Pinterest CAPI, and sGTM.
   */
  event_id: z.string().uuid(),

  /** Unix timestamp (seconds). Must be within 7 days of dispatch time. */
  event_time: z.number().int().positive(),

  /** Whether this event was constructed in the browser or on the server */
  source: z.enum(['browser', 'server']),

  user_data:              TelemetryUserDataSchema.optional(),
  ecommerce:              TelemetryEcommerceSchema.optional(),
  recommendation_context: TelemetryRecommendationContextSchema.optional(),

  // Observability & Attribution Metadata
  page_location:  z.string().max(2048).optional(),
  page_referrer:  z.string().max(2048).optional(),
  page_title:     z.string().max(512).optional(),
  trace_id:       z.string().max(255).optional(), // Distributed tracing (Phase 16)
});

// ─────────────────────────────────────────────────────────────────────────────
// BROWSER-SAFE SCHEMA — accepted from the frontend /telemetry/collect endpoint.
// PURCHASE IS EXCLUDED. The server enforces this at the route level.
// ─────────────────────────────────────────────────────────────────────────────
export const BrowserTelemetryEventNames = CANONICAL_EVENT_NAMES.filter(
  (n) => n !== 'purchase'
) as Exclude<CanonicalEventName, 'purchase'>[];

export const BrowserTelemetryEventSchema = CanonicalTelemetryEventSchema.extend({
  event_name: z.enum(BrowserTelemetryEventNames as [string, ...string[]] as [
    Exclude<CanonicalEventName, 'purchase'>,
    ...Exclude<CanonicalEventName, 'purchase'>[]
  ]),
  source: z.literal('browser'),
});

export type CanonicalTelemetryEvent = z.infer<typeof CanonicalTelemetryEventSchema>;
export type BrowserTelemetryEvent   = z.infer<typeof BrowserTelemetryEventSchema>;
