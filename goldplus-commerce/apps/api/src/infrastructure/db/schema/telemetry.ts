import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  jsonb,
  integer,
  boolean,
  text,
} from 'drizzle-orm/pg-core';

/**
 * PHASE 4 — ENTERPRISE IDENTITY GRAPH
 *
 * Persists first-party click IDs and browser identity signals server-side.
 * These are captured from URL query params by the API or forwarded from the
 * Astro frontend via the /telemetry/identity endpoint.
 *
 * This table is the authoritative linkage between ad-network click events
 * and GoldPlus orders/users, enabling server-side enhanced conversions
 * that would otherwise be lost when ITP or ad-blockers strip cookies.
 */
export const firstPartyIdentities = pgTable('first_party_identities', {
  id: uuid('id').defaultRandom().primaryKey(),

  // Stable first-party cookie ID set as an HTTP-only cookie by Caddy/API
  fpClientId: varchar('fp_client_id', { length: 255 }),

  // Optional: linked to an authenticated user after login
  userId: uuid('user_id'),

  // Ad-network click ID signals (raw, persisted for server-side attribution)
  gclid:   varchar('gclid', { length: 512 }),   // Google Ads
  wbraid:  varchar('wbraid', { length: 512 }),  // Google Ads (iOS)
  gbraid:  varchar('gbraid', { length: 512 }),  // Google Ads (Android)
  fbc:     varchar('fbc', { length: 512 }),     // Meta (_fbc cookie)
  fbp:     varchar('fbp', { length: 512 }),     // Meta (_fbp cookie)
  ttclid:  varchar('ttclid', { length: 512 }),  // TikTok
  twclid:  varchar('twclid', { length: 512 }),  // X/Twitter
  li_fat_id: varchar('li_fat_id', { length: 512 }), // LinkedIn
  epik:    varchar('epik', { length: 512 }),    // Pinterest

  // Hashed PII for server-side enhanced matching (SHA-256 + pepper)
  hashedEmail: varchar('hashed_email', { length: 64 }),
  hashedPhone: varchar('hashed_phone', { length: 64 }),

  // Metadata
  ipAddress:  varchar('ip_address', { length: 64 }),
  userAgent:  text('user_agent'),
  createdAt:  timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * PHASE 12 — TELEMETRY DEAD LETTER QUEUE
 *
 * Events that failed all retry attempts land here for manual replay or triage.
 * We rely on the EXISTING `outbox_events` table (system.ts) as the primary
 * durable queue so we do NOT create a duplicate. This table is strictly for
 * exhausted telemetry events, separate from the notification outbox which
 * has different domain concerns.
 */
export const telemetryDeadLetterQueue = pgTable('telemetry_dlq', {
  id: uuid('id').defaultRandom().primaryKey(),

  // Reference back to the originating outbox_events row
  originalOutboxEventId: uuid('original_outbox_event_id').notNull(),

  // The canonical event name and deterministic event_id for replay idempotency
  eventName: varchar('event_name', { length: 100 }).notNull(),
  eventId:   varchar('event_id', { length: 255 }).notNull().unique(), // UUID from canonical schema

  // Full payload for replay
  payload: jsonb('payload').notNull(),

  // Failure audit
  totalAttempts: integer('total_attempts').notNull(),
  failedReason:  text('failed_reason').notNull(),
  failedAt:      timestamp('failed_at', { withTimezone: true }).defaultNow().notNull(),

  // Operator resolution
  isResolved:   boolean('is_resolved').default(false).notNull(),
  resolvedAt:   timestamp('resolved_at', { withTimezone: true }),
  resolvedNote: text('resolved_note'),
});
