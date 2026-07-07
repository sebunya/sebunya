import { z } from 'zod';

/**
 * MEASUREMENT CONTROL TOWER — ZERO-PARTY DATA SCHEMAS
 *
 * Zero-party data is information a customer intentionally and proactively shares.
 * Unlike first-party data (inferred from behaviour) or third-party data (purchased),
 * zero-party data has maximum consent quality and maximum signal accuracy.
 *
 * Sources in GoldPlus:
 * - Product quiz answers ("What is your primary use case for this generator?")
 * - Wishlist intent signals ("Save for later" actions)
 * - Declared purchase intent ("Planning to buy in next 30 days")
 * - Self-reported attributes (business type, industry, fleet size)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Signal Types
// ─────────────────────────────────────────────────────────────────────────────

export const ZERO_PARTY_SIGNAL_TYPES = [
  'quiz_answer',
  'declared_intent',
  'preference_update',
  'wishlist_add',
  'comparison_save',
  'feedback',
] as const;

export type ZeroPartySignalType = typeof ZERO_PARTY_SIGNAL_TYPES[number];

// ─────────────────────────────────────────────────────────────────────────────
// Quiz Answer Schema
// ─────────────────────────────────────────────────────────────────────────────

export const QuizAnswerSchema = z.object({
  quiz_id:    z.string().max(100),
  question_id: z.string().max(100),
  answer_key:  z.string().max(255),
  answer_label: z.string().max(500).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Declared Purchase Intent
// ─────────────────────────────────────────────────────────────────────────────

export const DeclaredIntentSchema = z.object({
  intent_type: z.enum([
    'buy_soon',           // Buying within 30 days
    'researching',        // Still in research phase
    'comparing',          // Comparing options
    'budget_constrained', // Interested but budget limited
  ]),
  product_id:        z.string().max(255).optional(),
  product_category:  z.string().max(255).optional(),
  declared_budget:   z.number().nonnegative().optional(),
  declared_currency: z.string().length(3).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Zero-Party Signal (inbound event)
// ─────────────────────────────────────────────────────────────────────────────

export const ZeroPartySignalSchema = z.object({
  // Identity — at minimum fp_client_id is required
  fp_client_id: z.string().max(255),
  user_id:      z.string().uuid().optional(),
  session_id:   z.string().max(255).optional(),

  // Signal classification
  signal_type:  z.enum(ZERO_PARTY_SIGNAL_TYPES),

  // Typed payload — one of the structured signal schemas, or free-form JSON
  payload: z.union([
    QuizAnswerSchema,
    DeclaredIntentSchema,
    z.record(z.unknown()), // Fallback for unstructured zero-party data
  ]),

  // Attribution context
  page_location:    z.string().max(2048).optional(),
  product_id:       z.string().max(255).optional(),
  source_component: z.string().max(100).optional(), // e.g. "product_quiz", "wishlist_button"

  // Timestamp
  captured_at: z.number().int().positive().optional(), // Unix seconds
});

export type ZeroPartySignal = z.infer<typeof ZeroPartySignalSchema>;
