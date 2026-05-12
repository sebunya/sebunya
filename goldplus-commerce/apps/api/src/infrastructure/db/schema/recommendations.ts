import {
  index,
  integer,
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

export const recommendationRules = pgTable(
  "recommendation_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    type: varchar("type", { length: 80 }).notNull(),
    status: varchar("status", { length: 50 }).default("DRAFT").notNull(),
    priority: integer("priority").default(100).notNull(),
    placement: varchar("placement", { length: 80 }).notNull(),
    targetType: varchar("target_type", { length: 80 }).notNull(),
    targetValue: varchar("target_value", { length: 255 }),
    conditions: jsonb("conditions").default({}).notNull(),
    action: jsonb("action").default({}).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    statusIdx: index("recommendation_rules_status_idx").on(table.status),
    typeIdx: index("recommendation_rules_type_idx").on(table.type),
    placementIdx: index("recommendation_rules_placement_idx").on(table.placement),
    targetTypeIdx: index("recommendation_rules_target_type_idx").on(table.targetType),
    targetValueIdx: index("recommendation_rules_target_value_idx").on(table.targetValue),
    priorityIdx: index("recommendation_rules_priority_idx").on(table.priority),
    startsAtIdx: index("recommendation_rules_starts_at_idx").on(table.startsAt),
    endsAtIdx: index("recommendation_rules_ends_at_idx").on(table.endsAt),
    placementStatusIdx: index("recommendation_rules_placement_status_idx").on(
      table.placement,
      table.status
    ),
    placementStatusPriorityIdx: index("recommendation_rules_placement_status_priority_idx").on(
      table.placement,
      table.status,
      table.priority
    ),
    targetTypeTargetValueIdx: index("recommendation_rules_target_type_value_idx").on(
      table.targetType,
      table.targetValue
    ),
    createdAtIdx: index("recommendation_rules_created_at_idx").on(table.createdAt),
  })
);

export const recommendationRuleAuditLogs = pgTable(
  "recommendation_rule_audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ruleId: uuid("rule_id").references(() => recommendationRules.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 80 }).notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    performedBy: uuid("performed_by"),
    performedAt: timestamp("performed_at", { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
  },
  (table) => ({
    ruleIdIdx: index("recommendation_rule_audit_logs_rule_id_idx").on(table.ruleId),
    actionIdx: index("recommendation_rule_audit_logs_action_idx").on(table.action),
    performedByIdx: index("recommendation_rule_audit_logs_performed_by_idx").on(table.performedBy),
    performedAtIdx: index("recommendation_rule_audit_logs_performed_at_idx").on(table.performedAt),
  })
);
