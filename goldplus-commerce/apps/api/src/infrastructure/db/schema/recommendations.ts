import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { products } from "./products";

export const recommendationEvents = pgTable(
  "recommendation_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    eventType: varchar("event_type", { length: 80 }).notNull(),

    anonymousId: varchar("anonymous_id", { length: 160 }),
    customerId: uuid("customer_id"),

    sessionId: varchar("session_id", { length: 160 }),

    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),

    categoryId: uuid("category_id"),

    searchQuery: text("search_query"),

    placement: varchar("placement", { length: 80 }),

    recommendationProductId: uuid("recommendation_product_id").references(
      () => products.id,
      { onDelete: "set null" },
    ),

    source: varchar("source", { length: 160 }),

    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    eventTypeIdx: index("recommendation_events_event_type_idx").on(table.eventType),
    anonymousIdx: index("recommendation_events_anonymous_id_idx").on(table.anonymousId),
    customerIdx: index("recommendation_events_customer_id_idx").on(table.customerId),
    productIdx: index("recommendation_events_product_id_idx").on(table.productId),
    categoryIdx: index("recommendation_events_category_id_idx").on(table.categoryId),
    placementIdx: index("recommendation_events_placement_idx").on(table.placement),
    createdAtIdx: index("recommendation_events_created_at_idx").on(table.createdAt),
    productCreatedAtIdx: index("recommendation_events_product_created_at_idx").on(
      table.productId,
      table.createdAt,
    ),
    eventCreatedAtIdx: index("recommendation_events_type_created_at_idx").on(
      table.eventType,
      table.createdAt,
    ),
    anonymousCreatedAtIdx: index("recommendation_events_anonymous_created_at_idx").on(
      table.anonymousId,
      table.createdAt,
    ),
    recommendationProductCreatedAtIdx: index(
      "recommendation_events_recommendation_product_created_at_idx",
    ).on(table.recommendationProductId, table.createdAt),
  }),
);
