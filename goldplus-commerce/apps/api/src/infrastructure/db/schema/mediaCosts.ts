import { bigint, date, index, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

/**
 * The ONE canonical media-spend fact source (0102, R3.1 §12).
 *
 * Server-ingested only, immutable source references, duplicate-protected by a
 * logical unique key (in SQL — it uses coalesce expressions drizzle cannot
 * express). Ships empty: ROAS is UNAVAILABLE with
 * REASON=MEDIA_COST_NOT_CONNECTED until real rows exist, then activates from
 * the data alone. Spend is never invented, never defaulted, never client-set.
 */
export const mediaCostFacts = pgTable(
  "media_cost_facts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    spendDate: date("spend_date").notNull(),
    channel: varchar("channel", { length: 40 }).notNull(),
    platform: varchar("platform", { length: 80 }).notNull(),
    account: varchar("account", { length: 120 }).notNull(),
    campaign: varchar("campaign", { length: 150 }).notNull(),
    adSetOrGroup: varchar("ad_set_or_group", { length: 150 }),
    adOrCreative: varchar("ad_or_creative", { length: 150 }),
    currency: varchar("currency", { length: 3 }).default("UGX").notNull(),
    spendMinor: bigint("spend_minor", { mode: "number" }).notNull(),
    taxOrFeeMinor: bigint("tax_or_fee_minor", { mode: "number" }).default(0).notNull(),
    source: varchar("source", { length: 120 }).notNull(),
    sourceReference: varchar("source_reference", { length: 200 }),
    ingestedBy: uuid("ingested_by"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    dateIdx: index("media_cost_facts_date_idx").on(table.spendDate),
    campaignIdx: index("media_cost_facts_campaign_idx").on(table.campaign),
  }),
);
