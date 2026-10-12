import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * Shop-assistant money ledger (0175). One row per reserved paid turn.
 * RESERVED -> SETTLED (provider usage known) | RELEASED (certainly not billed)
 * | UNKNOWN (reservation went stale; counted at the reserved amount until an
 * operator reconciles it). No customer text is stored here, ever.
 */
export const assistantModelCalls = pgTable('assistant_model_calls', {
  id: uuid('id').defaultRandom().primaryKey(),
  month: varchar('month', { length: 7 }).notNull(),
  status: varchar('status', { length: 12 }).default('RESERVED').notNull(),
  reservedMicroUsd: bigint('reserved_micro_usd', { mode: 'number' }).notNull(),
  settledMicroUsd: bigint('settled_micro_usd', { mode: 'number' }),
  model: varchar('model', { length: 60 }).notNull(),
  providerRequestId: varchar('provider_request_id', { length: 120 }),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  cacheReadTokens: integer('cache_read_tokens'),
  cacheWriteTokens: integer('cache_write_tokens'),
  principalHash: varchar('principal_hash', { length: 64 }).notNull(),
  conversationId: varchar('conversation_id', { length: 64 }),
  outcome: varchar('outcome', { length: 40 }),
  releaseReason: text('release_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  settledAt: timestamp('settled_at', { withTimezone: true }),
}, (t) => ({
  monthStatusIdx: index('assistant_model_calls_month_status_idx').on(t.month, t.status),
  createdIdx: index('assistant_model_calls_created_idx').on(t.createdAt),
}));

/** Operator policy for the assistant (one row), versioned like battery_finder_config. */
export const assistantConfig = pgTable('assistant_config', {
  id: boolean('id').default(true).primaryKey(),
  config: jsonb('config').default({}).notNull(),
  version: integer('version').default(1).notNull(),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
