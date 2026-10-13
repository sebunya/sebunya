import { sql } from 'drizzle-orm';
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

/**
 * Goldie conversation archive (0177): every channel, every message, with topic, mood and outcome
 * for the admin inbox and the meeting summary. Text is redacted (cards, PINs, OTPs) before insert.
 */
export const assistantConversations = pgTable('assistant_conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  channel: varchar('channel', { length: 20 }).notNull(),
  channelKey: varchar('channel_key', { length: 128 }).notNull(),
  customerId: uuid('customer_id'),
  contactName: varchar('contact_name', { length: 120 }),
  contactPhone: varchar('contact_phone', { length: 32 }),
  contactEmail: varchar('contact_email', { length: 200 }),
  firstTopic: varchar('first_topic', { length: 20 }),
  lastTopic: varchar('last_topic', { length: 20 }),
  worstMood: varchar('worst_mood', { length: 12 }).default('neutral').notNull(),
  outcome: varchar('outcome', { length: 20 }).default('open').notNull(),
  supportTicketId: uuid('support_ticket_id'),
  page: text('page'),
  messageCount: integer('message_count').default(0).notNull(),
  aiTurns: integer('ai_turns').default(0).notNull(),
  humanUntil: timestamp('human_until', { withTimezone: true }),
  csat: integer('csat'),
  csatComment: text('csat_comment'),
  nextAction: varchar('next_action', { length: 40 }),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  lastIdx: index('assistant_conversations_last_idx').on(t.lastMessageAt),
  customerIdx: index('assistant_conversations_customer_idx').on(t.customerId),
}));

export const assistantMessages = pgTable('assistant_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id').notNull(),
  role: varchar('role', { length: 12 }).notNull(),
  content: text('content').notNull(),
  intent: varchar('intent', { length: 20 }),
  mood: varchar('mood', { length: 12 }),
  route: varchar('route', { length: 16 }),
  channelMessageId: varchar('channel_message_id', { length: 160 }),
  cacheId: uuid('cache_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  conversationIdx: index('assistant_messages_conversation_idx').on(t.conversationId, t.createdAt),
}));

/** The Care Desk (0178): what a person must do, opened by Goldie or staff. */
export const careTasks = pgTable('care_tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  kind: varchar('kind', { length: 20 }).notNull(),
  priority: varchar('priority', { length: 10 }).default('normal').notNull(),
  status: varchar('status', { length: 12 }).default('open').notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  detail: text('detail'),
  customerName: varchar('customer_name', { length: 120 }),
  customerPhone: varchar('customer_phone', { length: 32 }),
  customerEmail: varchar('customer_email', { length: 200 }),
  orderNumber: varchar('order_number', { length: 40 }),
  conversationId: uuid('conversation_id'),
  channel: varchar('channel', { length: 20 }),
  proposedAction: jsonb('proposed_action'),
  dueAt: timestamp('due_at', { withTimezone: true }),
  assignedTo: uuid('assigned_to'),
  openedBy: varchar('opened_by', { length: 40 }).default('goldie').notNull(),
  resolvedBy: uuid('resolved_by'),
  resolution: text('resolution'),
  alertedAt: timestamp('alerted_at', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  // 0180: partial indexes for the open queue and dedupe (the generic 0178 index was dropped).
  openQueueIdx: index('care_tasks_open_queue_idx').on(t.priority, t.createdAt).where(sql`status = 'open'`),
}));

/** Who gets Care Desk alerts, how, and when they are on duty (0178). */
export const careTeamMembers = pgTable('care_team_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 80 }).notNull(),
  roleLabel: varchar('role_label', { length: 60 }),
  phone: varchar('phone', { length: 32 }),
  email: varchar('email', { length: 200 }),
  alertSms: boolean('alert_sms').default(true).notNull(),
  alertEmail: boolean('alert_email').default(true).notNull(),
  alertWhatsapp: boolean('alert_whatsapp').default(false).notNull(),
  onDuty: jsonb('on_duty'),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Goldie's answer memory (0179): paid answers reused at no model cost after a live price and stock check. */
export const assistantAnswerMemory = pgTable('assistant_answer_memory', {
  id: uuid('id').defaultRandom().primaryKey(),
  questionKey: varchar('question_key', { length: 64 }).notNull(),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  intent: varchar('intent', { length: 20 }),
  products: jsonb('products').default([]).notNull(),
  pinned: boolean('pinned').default(false).notNull(),
  edited: boolean('edited').default(false).notNull(),
  retired: boolean('retired').default(false).notNull(),
  asks: integer('asks').default(1).notNull(),
  served: integer('served').default(0).notNull(),
  poorRatings: integer('poor_ratings').default(0).notNull(),
  staleMisses: integer('stale_misses').default(0).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  lastServedAt: timestamp('last_served_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
