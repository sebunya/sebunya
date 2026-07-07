import { z } from 'zod';

/**
 * MEASUREMENT CONTROL TOWER — CONSENT GOVERNANCE SCHEMAS
 *
 * Defines the canonical data types for consent signal capture,
 * processing, and enforcement across the entire GoldPlus measurement stack.
 *
 * DESIGN INVARIANTS:
 * - Consent is purpose-scoped (not platform-scoped). We reason about
 *   "can we measure conversions?" not "can we fire Meta Pixel?".
 * - A single consent decision resolves across all downstream destinations
 *   via the ConversionRouter.
 * - Withdrawal is immediate and irreversible until re-grant.
 * - All consent decisions are stored immutably in the consent_records table.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Purpose Registry — the canonical list of measurement purposes
// ─────────────────────────────────────────────────────────────────────────────

export const CONSENT_PURPOSES = [
  'analytics',           // GA4, first-party analytics, session recording
  'advertising',         // Paid social CAPIs, remarketing pixels
  'personalization',     // Recommendation engine, A/B testing, UX adaptation
  'essential',           // Required for core commerce functionality (always granted)
] as const;

export type ConsentPurpose = typeof CONSENT_PURPOSES[number];

// ─────────────────────────────────────────────────────────────────────────────
// Grant Types
// ─────────────────────────────────────────────────────────────────────────────

export const CONSENT_GRANT_TYPES = [
  'explicit',    // User actively clicked "Accept All" or toggled purpose on
  'implicit',    // Legitimate interest — no user action needed (essential only)
  'withdrawn',   // User actively revoked a previously granted purpose
  'expired',     // Consent TTL elapsed (configurable, default 13 months)
  'unknown',     // No signal captured yet (pre-banner state)
] as const;

export type ConsentGrantType = typeof CONSENT_GRANT_TYPES[number];

// ─────────────────────────────────────────────────────────────────────────────
// Consent State Object
// ─────────────────────────────────────────────────────────────────────────────

export const ConsentStateSchema = z.object({
  analytics:       z.boolean().default(false),
  advertising:     z.boolean().default(false),
  personalization: z.boolean().default(false),
  essential:       z.literal(true).default(true), // Always true — essential cannot be denied
});

export type ConsentState = z.infer<typeof ConsentStateSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Consent Signal (inbound from browser / API)
// ─────────────────────────────────────────────────────────────────────────────

export const ConsentSignalSchema = z.object({
  fp_client_id: z.string().max(255),
  user_id:      z.string().uuid().optional(),

  // The actual consent decisions
  purposes: ConsentStateSchema,

  // How was this consent captured?
  grant_type: z.enum(CONSENT_GRANT_TYPES),

  // UI surface where the consent was collected
  capture_surface: z.enum([
    'cookie_banner',
    'privacy_settings',
    'checkout_gate',
    'api',
    'implicit',
  ]).default('cookie_banner'),

  // ISO 639-1 language of the consent surface shown to the user
  consent_language: z.string().length(2).default('en'),

  // Version of the consent notice (e.g. "v2.1") — bump on material changes
  notice_version: z.string().max(20).default('v1.0'),

  // Timestamp of consent action — must be within 60s of server receipt
  consent_at: z.number().int().positive().optional(), // Unix seconds
});

export type ConsentSignal = z.infer<typeof ConsentSignalSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Consent Withdrawal
// ─────────────────────────────────────────────────────────────────────────────

export const ConsentWithdrawalSchema = z.object({
  fp_client_id: z.string().max(255),
  user_id:      z.string().uuid().optional(),
  // Which purposes to withdraw. Omit essential (cannot be withdrawn).
  purposes: z.array(z.enum(['analytics', 'advertising', 'personalization'])).min(1),
  reason:   z.string().max(500).optional(),
});

export type ConsentWithdrawal = z.infer<typeof ConsentWithdrawalSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Consent Check Result — used internally by ConsentService
// ─────────────────────────────────────────────────────────────────────────────

export interface ConsentCheckResult {
  allowed:       boolean;
  grantType:     ConsentGrantType;
  purposes:      ConsentState;
  resolvedAt:    Date;
  /** If denied, the specific purpose that blocked routing */
  blockedReason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Destination Allowlist — maps purposes to upstream measurement destinations
// ─────────────────────────────────────────────────────────────────────────────

export const MEASUREMENT_DESTINATIONS = [
  'ga4',           // Google Analytics 4 via sGTM
  'meta_capi',     // Meta Conversions API
  'tiktok_capi',   // TikTok Events API
  'linkedin_capi', // LinkedIn Conversions API
  'pinterest_capi',// Pinterest Conversions API
  'gtm_web',       // GTM web container dataLayer push
] as const;

export type MeasurementDestination = typeof MEASUREMENT_DESTINATIONS[number];

/**
 * Defines which consent purposes are required to route to each destination.
 * This is the authoritative consent-destination mapping.
 */
export const DESTINATION_PURPOSE_MAP: Record<MeasurementDestination, ConsentPurpose> = {
  ga4:            'analytics',
  meta_capi:      'advertising',
  tiktok_capi:    'advertising',
  linkedin_capi:  'advertising',
  pinterest_capi: 'advertising',
  gtm_web:        'analytics',
} as const;
