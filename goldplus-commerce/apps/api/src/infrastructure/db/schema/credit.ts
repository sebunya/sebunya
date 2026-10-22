import { bigint, check, customType, date, index, integer, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
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

/**
 * 0199: a gift card a customer buys online for someone else. Paid through Pesapal under its own reference (GC-…),
 * never as an order; once paid, the card is issued and its code texted in one transaction (on deliver_on, when set).
 */
export const giftCardPurchases = pgTable('gift_card_purchases', {
  id: uuid('id').defaultRandom().primaryKey(),
  reference: varchar('reference', { length: 20 }).notNull(),
  amountUgx: bigint('amount_ugx', { mode: 'number' }).notNull(),
  buyerName: varchar('buyer_name', { length: 120 }).notNull(),
  buyerPhone: varchar('buyer_phone', { length: 20 }).notNull(),
  buyerEmail: varchar('buyer_email', { length: 255 }),
  buyerUserId: uuid('buyer_user_id'),
  fromName: varchar('from_name', { length: 60 }).notNull(),
  recipientName: varchar('recipient_name', { length: 120 }).notNull(),
  recipientPhone: varchar('recipient_phone', { length: 20 }),
  sendTo: varchar('send_to', { length: 10 }).notNull(), // recipient | buyer
  message: varchar('message', { length: 160 }),
  theme: varchar('theme', { length: 16 }).default('gold').notNull(),
  deliverOn: date('deliver_on'),
  status: varchar('status', { length: 20 }).default('awaiting_payment').notNull(),
  orderTrackingId: varchar('order_tracking_id', { length: 255 }),
  redirectUrl: text('redirect_url'),
  providerStatus: text('provider_status'),
  confirmationCode: varchar('confirmation_code', { length: 120 }),
  paymentMethod: varchar('payment_method', { length: 60 }),
  instrumentId: uuid('instrument_id').references(() => creditInstruments.id),
  /** 0201: the buyer's optional photo. */
  photoId: uuid('photo_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  referenceUq: uniqueIndex('gift_card_purchases_reference_uq').on(t.reference),
  statusIdx: index('gift_card_purchases_status_idx').on(t.status, t.createdAt),
  buyerPhoneIdx: index('gift_card_purchases_buyer_phone_idx').on(t.buyerPhone, t.createdAt),
  buyerUserIdx: index('gift_card_purchases_buyer_user_idx').on(t.buyerUserId),
  sendToChk: check('gift_card_purchases_send_to_chk', sql`${t.sendTo} in ('recipient','buyer')`),
}));

/** 0200: the owner's occasion adjustments (one row): Eid dates and time-boxed feature/hide. Prominence only. */
export const giftCardOccasionSettings = pgTable('gift_card_occasion_settings', {
  id: smallint('id').primaryKey().default(1),
  settings: jsonb('settings').default({}).notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType() { return 'bytea'; } });

/** 0201: an optional photo on a gift card bought online: a re-encoded square JPEG without metadata. */
export const giftCardPhotos = pgTable('gift_card_photos', {
  id: uuid('id').defaultRandom().primaryKey(),
  image: bytea('image').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  attachedAt: timestamp('attached_at', { withTimezone: true }),
  /** HMAC of the uploader's rate-limit key (the per-visitor daily ceiling), never an address. */
  uploaderKey: varchar('uploader_key', { length: 64 }),
});
