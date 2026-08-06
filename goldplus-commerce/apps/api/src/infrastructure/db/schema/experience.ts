import { index, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

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
  },
  (table) => ({
    tokenHashUq: uniqueIndex("experience_profiles_token_hash_uq").on(table.tokenHash),
    customerIdx: index("experience_profiles_customer_idx").on(table.customerId),
    lastSeenIdx: index("experience_profiles_last_seen_idx").on(table.lastSeenAt),
  }),
);
