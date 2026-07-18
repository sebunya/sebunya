import { pgTable, uuid, varchar, integer, text, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
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
  })
);
