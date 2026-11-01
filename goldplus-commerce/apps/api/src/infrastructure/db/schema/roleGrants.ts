import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core';

/** Maker/checker ledger for PLATFORM_ADMINISTRATOR grants (§6). */
export const roleGrantRequests = pgTable(
  'role_grant_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    roleName: varchar('role_name', { length: 50 }).notNull(),
    status: varchar('status', { length: 12 }).default('PENDING').notNull(), // PENDING | APPROVED | REJECTED
    requestedBy: uuid('requested_by').notNull(),
    decidedBy: uuid('decided_by'),
    reason: varchar('reason', { length: 500 }),
    requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index('role_grant_requests_status_idx').on(t.status),
    userIdx: index('role_grant_requests_user_idx').on(t.userId),
  }),
);
