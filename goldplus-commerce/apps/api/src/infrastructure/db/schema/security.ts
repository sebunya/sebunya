import { pgTable, uuid, varchar, integer, boolean, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './identity';

/**
 * Two-factor auth + OTP challenges + login/security event log.
 *
 * - user_two_factor: per-user 2FA config (TOTP secret, backup code hashes).
 * - otp_challenges: short-lived email/SMS codes (hash only, never plaintext).
 * - auth_attempts: append-only log of login attempts for throttling + fraud.
 */

export const userTwoFactor = pgTable('user_two_factor', {
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).primaryKey(),
  method: varchar('method', { length: 20 }).default('none').notNull(), // none | totp | sms | email
  totpSecret: varchar('totp_secret', { length: 128 }), // base32; enabled only after confirmation
  enabled: boolean('enabled').default(false).notNull(),
  backupCodes: jsonb('backup_codes').default([]).notNull(), // array of { hash, usedAt }
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    purpose: varchar('purpose', { length: 30 }).notNull(), // login_2fa | enroll_sms | enroll_email | step_up
    channel: varchar('channel', { length: 10 }).notNull(), // sms | email
    destination: varchar('destination', { length: 255 }).notNull(),
    codeHash: varchar('code_hash', { length: 128 }).notNull(),
    attempts: integer('attempts').default(0).notNull(),
    maxAttempts: integer('max_attempts').default(5).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('otp_challenges_user_idx').on(table.userId, table.createdAt),
  }),
);

export const authAttempts = pgTable(
  'auth_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 255 }),
    userId: uuid('user_id'),
    ipAddress: varchar('ip_address', { length: 100 }),
    outcome: varchar('outcome', { length: 30 }).notNull(), // SUCCESS | BAD_CREDENTIALS | LOCKED | 2FA_REQUIRED | 2FA_FAILED
    riskScore: integer('risk_score').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    emailIdx: index('auth_attempts_email_idx').on(table.email, table.createdAt),
    ipIdx: index('auth_attempts_ip_idx').on(table.ipAddress, table.createdAt),
  }),
);
