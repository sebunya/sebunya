import { pgTable, uuid, varchar, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { users } from './identity';

export const addresses = pgTable('addresses', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  label: varchar('label', { length: 50 }).notNull(),
  recipientName: varchar('recipient_name', { length: 100 }).notNull(),
  phone: varchar('phone', { length: 20 }).notNull(),
  district: varchar('district', { length: 100 }).notNull(),
  areaDetails: text('area_details').notNull(),
  isDefault: boolean('is_default').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
