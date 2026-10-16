import { boolean, index, integer, numeric, pgTable, smallint, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

/**
 * Server-side experience profiles (0100, R2 2026-08-06).
 *
 * One row per opaque browser locator. The browser carries only a random
 * HttpOnly cookie value; this table stores its SHA-256 — the raw token never
 * touches the database, logs or analytics. Everything meaningful (events,
 * carts, orders) lives in its canonical table and joins on profile id.
 *
 * customer_id is set exactly once by the login merge and never downgraded:
 * a later anonymous observation cannot overwrite an authenticated truth.
 */
export const experienceProfiles = pgTable(
  "experience_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    customerId: uuid("customer_id"),
    customerLinkedAt: timestamp("customer_linked_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    /** 0193: the visitor's "Deliver to" area (area only), set by the customer. */
    deliverAreaSlug: varchar("deliver_area_slug", { length: 160 }),
    deliverDistrict: varchar("deliver_district", { length: 60 }),
    deliverLabel: varchar("deliver_label", { length: 120 }),
    deliverSetAt: timestamp("deliver_set_at", { withTimezone: true }),
  },
  (table) => ({
    tokenHashUq: uniqueIndex("experience_profiles_token_hash_uq").on(table.tokenHash),
    customerIdx: index("experience_profiles_customer_idx").on(table.customerId),
    lastSeenIdx: index("experience_profiles_last_seen_idx").on(table.lastSeenAt),
  }),
);

/**
 * 0193: location signals — what customers tell us about where they want delivery. No coordinates, no IP, no user
 * agent. Linked to a profile/customer only with personalisation consent (a CHECK enforces it); deleted after 395 days.
 */
export const locationSignals = pgTable(
  "location_signals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    kind: varchar("kind", { length: 30 }).notNull(),
    surface: varchar("surface", { length: 20 }).notNull(),
    profileId: uuid("profile_id"),
    customerId: uuid("customer_id"),
    areaSlug: varchar("area_slug", { length: 160 }),
    district: varchar("district", { length: 60 }),
    feeUgx: integer("fee_ugx"),
    quoteKind: varchar("quote_kind", { length: 40 }),
    offerRank: smallint("offer_rank"),
    offerKm: numeric("offer_km", { precision: 7, scale: 2 }),
    personalisation: boolean("personalisation").default(false).notNull(),
  },
  (table) => ({
    areaTimeIdx: index("location_signals_area_time_idx").on(table.areaSlug, table.occurredAt),
    timeIdx: index("location_signals_time_idx").on(table.occurredAt),
  }),
);

