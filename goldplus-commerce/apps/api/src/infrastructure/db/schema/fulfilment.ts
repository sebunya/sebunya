import { pgTable, uuid, varchar, integer, text, jsonb, timestamp, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { orders } from './commerce';
import { users } from './identity';

/**
 * Launch Phase 1 (Section 9.3) — admin fulfilment tasks.
 *
 * One row per placed order (unique order_id makes creation idempotent). The row
 * is the internal "New Orders" work item: truthful payment status, full product
 * summary, and an explicit operations lifecycle. Timeline history lives in the
 * shared audit_logs table (entity = 'fulfilment_task').
 */
export const fulfilmentTasks = pgTable(
  'fulfilment_tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id').references(() => orders.id).notNull(),
    orderNumber: varchar('order_number', { length: 20 }).notNull(),
    status: varchar('status', { length: 30 }).default('NEW').notNull(),
    paymentStatus: varchar('payment_status', { length: 30 }).notNull(),
    paymentMethod: varchar('payment_method', { length: 40 }),
    customerName: varchar('customer_name', { length: 255 }).notNull(),
    customerContactMasked: varchar('customer_contact_masked', { length: 80 }).notNull(),
    deliveryArea: varchar('delivery_area', { length: 255 }).notNull(),
    deliverySummary: text('delivery_summary').notNull(),
    totalUgx: integer('total_ugx').notNull(),
    deliveryFeeUgx: integer('delivery_fee_ugx').default(0).notNull(),
    itemCount: integer('item_count').notNull(),
    items: jsonb('items').notNull(),
    warnings: jsonb('warnings'),
    priority: varchar('priority', { length: 10 }).default('normal').notNull(),
    slaDueAt: timestamp('sla_due_at', { withTimezone: true }).notNull(),
    slaPolicyVersion: integer('sla_policy_version').default(1).notNull(),
    teamId: uuid('team_id'),
    assignedTo: uuid('assigned_to').references(() => users.id),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orderIdx: uniqueIndex('fulfilment_tasks_order_id_idx').on(table.orderId),
    statusIdx: index('fulfilment_tasks_status_idx').on(table.status),
    createdIdx: index('fulfilment_tasks_created_idx').on(table.createdAt),
    assignedIdx: index('fulfilment_tasks_assigned_idx').on(table.assignedTo),
    slaIdx: index('fulfilment_tasks_sla_idx').on(table.slaDueAt),
    teamIdx: index('fulfilment_tasks_team_idx').on(table.teamId),
  })
);

/** Fulfilment teams (queues). Reuses users/roles — not a second staff directory. */
export const fulfilmentTeams = pgTable(
  'fulfilment_teams',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 120 }).notNull(),
    slug: varchar('slug', { length: 140 }).notNull(),
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    slugIdx: uniqueIndex('fulfilment_teams_slug_idx').on(table.slug),
  })
);

/** Team membership — links existing users to a fulfilment team. */
export const fulfilmentTeamMembers = pgTable(
  'fulfilment_team_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id').references(() => fulfilmentTeams.id).notNull(),
    userId: uuid('user_id').references(() => users.id).notNull(),
    active: boolean('active').default(true).notNull(),
    isLead: boolean('is_lead').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    memberIdx: uniqueIndex('fulfilment_team_members_team_user_idx').on(table.teamId, table.userId),
    userIdx: index('fulfilment_team_members_user_idx').on(table.userId),
  })
);

/** F2 — persisted, idempotent SLA escalation events (one per task/stage/version). */
export const fulfilmentSlaEvents = pgTable(
  'fulfilment_sla_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('task_id').references(() => fulfilmentTasks.id).notNull(),
    stage: varchar('stage', { length: 20 }).notNull(),
    policyVersion: integer('policy_version').notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    teamId: uuid('team_id'),
    assigneeId: uuid('assignee_id'),
    dueAtSnapshot: timestamp('due_at_snapshot', { withTimezone: true }).notNull(),
    prioritySnapshot: varchar('priority_snapshot', { length: 10 }).notNull(),
    detail: text('detail'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    keyIdx: uniqueIndex('fulfilment_sla_events_key_idx').on(table.idempotencyKey),
    taskIdx: index('fulfilment_sla_events_task_idx').on(table.taskId),
    stageIdx: index('fulfilment_sla_events_stage_idx').on(table.stage),
  })
);
