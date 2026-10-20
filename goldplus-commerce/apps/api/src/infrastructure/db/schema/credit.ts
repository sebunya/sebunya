import { bigint, check, index, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Store credit and gift cards (migration 0196, gap analysis #17). An instrument is a bearer code kept only as a
 * keyed hash plus its last four symbols; its balance is the sum of credit_ledger, which is append-only except
 * that a HOLD row moves held -> captured | released exactly once.
 */
export const creditInstruments = pgTable('credit_instruments', {
  id: uuid('id').defaultRandom().primaryKey(),
  kind: varchar('kind', { length: 16 }).notNull(), // gift_card | store_credit
  codeHash: varchar('code_hash', { length: 64 }).notNull(),
  codeLast4: varchar('code_last4', { length: 4 }).notNull(),
  status: varchar('status', { length: 20 }).notNull(), // pending_approval | active | void
  initialValueUgx: bigint('initial_value_ugx', { mode: 'number' }).notNull(),
  reason: text('reason').notNull(),
  recipientName: varchar('recipient_name', { length: 120 }),
  recipientPhone: varchar('recipient_phone', { length: 20 }),
  customerUserId: uuid('customer_user_id'),
  sourceOrderId: uuid('source_order_id'),
  issuedBy: uuid('issued_by').notNull(),
  approvedBy: uuid('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  voidedBy: uuid('voided_by'),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  codeHashUq: uniqueIndex('credit_instruments_code_hash_uq').on(t.codeHash),
  customerIdx: index('credit_instruments_customer_idx').on(t.customerUserId),
  kindChk: check('credit_instruments_kind_chk', sql`${t.kind} in ('gift_card','store_credit')`),
  statusChk: check('credit_instruments_status_chk', sql`${t.status} in ('pending_approval','active','void')`),
}));

export const creditLedger = pgTable('credit_ledger', {
  id: uuid('id').defaultRandom().primaryKey(),
  instrumentId: uuid('instrument_id').notNull().references(() => creditInstruments.id),
  type: varchar('type', { length: 12 }).notNull(), // ISSUE | HOLD | RETURN | ADJUST | VOID
  amountUgx: bigint('amount_ugx', { mode: 'number' }).notNull(),
  holdState: varchar('hold_state', { length: 10 }), // held | captured | released (HOLD only)
  orderId: uuid('order_id'),
  actorId: uuid('actor_id'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  settledAt: timestamp('settled_at', { withTimezone: true }),
}, (t) => ({
  instrumentIdx: index('credit_ledger_instrument_idx').on(t.instrumentId, t.createdAt),
  orderIdx: index('credit_ledger_order_idx').on(t.orderId),
  typeChk: check('credit_ledger_type_chk', sql`${t.type} in ('ISSUE','HOLD','RETURN','ADJUST','VOID')`),
  holdChk: check('credit_ledger_hold_chk', sql`(${t.type} = 'HOLD') = (${t.holdState} is not null)`),
}));
