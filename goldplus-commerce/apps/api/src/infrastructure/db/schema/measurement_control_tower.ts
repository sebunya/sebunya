import { pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';

export const measurementControlTowerAuditLog = pgTable('measurement_control_tower_audit_log', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  adminUserId: text('admin_user_id').notNull(),
  action: text('action').notNull(),
  section: text('section'),
  safeReferenceId: text('safe_reference_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  metadata: jsonb('metadata'),
});
