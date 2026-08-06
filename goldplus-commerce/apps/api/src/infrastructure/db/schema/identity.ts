import { pgTable, uuid, varchar, timestamp, boolean, primaryKey, integer, index, uniqueIndex, date } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  phone: varchar('phone', { length: 20 }).unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  /** 0085: verified phone is the loyalty identity spine (loyalty brief PART I). */
  phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
  /** 0087: shareable referral code, generated lazily on first request. */
  referralCode: varchar('referral_code', { length: 12 }),
  /** 0087: customer-supplied; powers birthday points and the 0090 age gate. */
  dateOfBirth: date('date_of_birth'),
  /** 0090: opted out of chance mechanics; the rest of loyalty is unaffected. */
  chanceSelfExcludedAt: timestamp('chance_self_excluded_at', { withTimezone: true }),
  // Slice 3B: immediate hard-revocation cutoff. Any access token issued at or
  // before this instant is rejected. Set on password change, disable or an
  // admin "log out everywhere". Null means no forced invalidation.
  sessionsInvalidatedAfter: timestamp('sessions_invalidated_after', { withTimezone: true }),
});

/**
 * Slice 3B — durable, revocable sessions. Each row is one refresh credential in
 * a family (the durable session). Rotation marks a row consumed (rotatedAt) and
 * inserts a new row in the same familyId; a presented credential whose row is
 * already consumed is reuse, and the whole family is revoked. The refresh token
 * is stored only as a SHA-256 hash.
 */
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    familyId: uuid('family_id').notNull(),
    refreshHash: varchar('refresh_hash', { length: 64 }).notNull(),
    jti: uuid('jti').notNull(),
    keyVersion: integer('key_version').notNull().default(1),
    permissionVersion: integer('permission_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).defaultNow().notNull(),
    accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }).notNull(),
    refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }).notNull(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: varchar('revoked_reason', { length: 48 }),
    userAgentHash: varchar('user_agent_hash', { length: 64 }),
    ipHash: varchar('ip_hash', { length: 64 }),
  },
  (table) => ({
    refreshHashUq: uniqueIndex('auth_sessions_refresh_hash_uq').on(table.refreshHash),
    familyIdx: index('auth_sessions_family_idx').on(table.familyId),
    refreshExpiryIdx: index('auth_sessions_refresh_expiry_idx').on(table.refreshExpiresAt),
  }),
);

/** Slice 3C — privileged MFA. The TOTP secret is stored encrypted. */
export const userMfa = pgTable('user_mfa', {
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .primaryKey(),
  secretCiphertext: varchar('secret_ciphertext', { length: 512 }).notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Slice 3C — single-use break-glass codes, stored only as SHA-256 hashes. */
export const userMfaRecoveryCodes = pgTable(
  'user_mfa_recovery_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    codeHashUq: uniqueIndex('user_mfa_recovery_code_hash_uq').on(table.codeHash),
    userIdx: index('user_mfa_recovery_codes_user_idx').on(table.userId),
  }),
);

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
    // 0100 (R2): the server-side experience profile this observation belongs
    // to — the column that finally gave this table a writer.
    profileId: uuid("profile_id"),
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
    profileIdx: index("identity_links_profile_idx").on(table.profileId),
    profileAnonUq: uniqueIndex("identity_links_profile_anon_uq")
      .on(table.profileId, table.anonymousId)
      .where(sql`${table.linkType} = 'PROFILE_OBSERVED'`),
    profileCustomerUq: uniqueIndex("identity_links_profile_customer_uq")
      .on(table.profileId, table.customerId)
      .where(sql`${table.linkType} = 'CUSTOMER_LOGIN'`),
    emailHashIdx: index("identity_links_email_hash_idx").on(table.emailHash),
    phoneHashIdx: index("identity_links_phone_hash_idx").on(table.phoneHash),
  })
);
