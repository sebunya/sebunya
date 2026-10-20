-- 0196: store credit and gift cards as a payment tender (gap analysis #17, owner approval 2026-10-20).
--
-- WHAT
-- 1. credit_instruments: one row per gift card or store credit. The code is a bearer secret: only a keyed
--    hash (code_hash) and its last four symbols are kept. Above UGX 500,000 an instrument waits for a second
--    staff member (status pending_approval) before it can be spent.
-- 2. credit_ledger: the balance is the sum of these rows. ISSUE adds, HOLD reserves against one order and is
--    later captured (order paid) or released (order cancelled), RETURN gives a refund's credit-paid part back,
--    ADJUST is a staff correction, VOID cancels what is left. Rows are never deleted.
-- 3. orders.store_credit_applied_ugx / store_credit_instrument_id: what credit pays of the order. total_amount
--    is unchanged (the full sale, as every revenue reader expects); Pesapal is asked for total - credit.
--
-- Additive: new tables, and two order columns with a default / nullable, so the running code keeps working
-- on the migrated database. Rollback: drop the two columns and the two tables (no other table refers to them).

CREATE TABLE IF NOT EXISTS "credit_instruments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" varchar(16) NOT NULL,
  "code_hash" varchar(64) NOT NULL,
  "code_last4" varchar(4) NOT NULL,
  "status" varchar(20) NOT NULL,
  "initial_value_ugx" bigint NOT NULL,
  "reason" text NOT NULL,
  "recipient_name" varchar(120),
  "recipient_phone" varchar(20),
  "customer_user_id" uuid,
  "source_order_id" uuid,
  "issued_by" uuid NOT NULL,
  "approved_by" uuid,
  "approved_at" timestamp with time zone,
  "voided_by" uuid,
  "voided_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "credit_instruments_kind_chk" CHECK ("kind" in ('gift_card','store_credit')),
  CONSTRAINT "credit_instruments_status_chk" CHECK ("status" in ('pending_approval','active','void')),
  CONSTRAINT "credit_instruments_value_chk" CHECK ("initial_value_ugx" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_instruments_code_hash_uq" ON "credit_instruments" ("code_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_instruments_customer_idx" ON "credit_instruments" ("customer_user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "instrument_id" uuid NOT NULL REFERENCES "credit_instruments"("id"),
  "type" varchar(12) NOT NULL,
  "amount_ugx" bigint NOT NULL,
  "hold_state" varchar(10),
  "order_id" uuid,
  "actor_id" uuid,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "settled_at" timestamp with time zone,
  CONSTRAINT "credit_ledger_type_chk" CHECK ("type" in ('ISSUE','HOLD','RETURN','ADJUST','VOID')),
  CONSTRAINT "credit_ledger_hold_chk" CHECK (("type" = 'HOLD') = ("hold_state" is not null)),
  CONSTRAINT "credit_ledger_hold_state_chk" CHECK ("hold_state" is null or "hold_state" in ('held','captured','released')),
  CONSTRAINT "credit_ledger_sign_chk" CHECK (
    ("type" in ('ISSUE','RETURN') and "amount_ugx" > 0) or ("type" in ('HOLD','VOID') and "amount_ugx" < 0) or ("type" = 'ADJUST' and "amount_ugx" <> 0)
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_ledger_instrument_idx" ON "credit_ledger" ("instrument_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_ledger_order_idx" ON "credit_ledger" ("order_id");
--> statement-breakpoint
-- One live hold per order: a retry or a replayed checkout can never reserve twice.
CREATE UNIQUE INDEX IF NOT EXISTS "credit_ledger_one_hold_per_order_uq" ON "credit_ledger" ("order_id") WHERE "type" = 'HOLD' AND "hold_state" <> 'released';
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "store_credit_applied_ugx" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "store_credit_instrument_id" uuid;
