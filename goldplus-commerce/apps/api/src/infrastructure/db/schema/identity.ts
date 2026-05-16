import { pgTable, uuid, varchar, timestamp, boolean, primaryKey, integer, index } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  phone: varchar('phone', { length: 20 }).unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 50 }).unique().notNull(),
});

export const permissions = pgTable('permissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  action: varchar('action', { length: 50 }).notNull(),
  resource: varchar('resource', { length: 50 }).notNull(),
});

export const userRoles = pgTable('user_roles', {
  userId: uuid('user_id').references(() => users.id).notNull(),
  roleId: uuid('role_id').references(() => roles.id).notNull(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .references(() => roles.id, { onDelete: 'cascade' })
      .notNull(),
    permissionId: uuid('permission_id')
      .references(() => permissions.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roleId, table.permissionId] }),
  }),
);

export const identityLinks = pgTable(
  "identity_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    anonymousId: varchar("anonymous_id", { length: 160 }),
    browserId: varchar("browser_id", { length: 160 }),
    sessionId: varchar("session_id", { length: 160 }),
    cartId: uuid("cart_id"),
    leadId: uuid("lead_id"),
    customerId: uuid("customer_id"),
    emailHash: varchar("email_hash", { length: 64 }),
    phoneHash: varchar("phone_hash", { length: 64 }),
    linkType: varchar("link_type", { length: 50 }).notNull(),
    linkConfidence: integer("link_confidence").notNull().default(0),
    sourceEventId: uuid("source_event_id"),
    firstLinkedAt: timestamp("first_linked_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    anonymousIdx: index("identity_links_anonymous_idx").on(table.anonymousId),
    browserIdx: index("identity_links_browser_idx").on(table.browserId),
    sessionIdx: index("identity_links_session_idx").on(table.sessionId),
    cartIdx: index("identity_links_cart_idx").on(table.cartId),
    leadIdx: index("identity_links_lead_idx").on(table.leadId),
    customerIdx: index("identity_links_customer_idx").on(table.customerId),
    emailHashIdx: index("identity_links_email_hash_idx").on(table.emailHash),
    phoneHashIdx: index("identity_links_phone_hash_idx").on(table.phoneHash),
  })
);
