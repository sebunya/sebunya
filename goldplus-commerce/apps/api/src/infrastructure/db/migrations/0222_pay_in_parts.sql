-- 0222: pay in parts (lay-by), owner rules decided 2026-11-07 (domain/layby/PayInParts.ts).
--
-- layby_settings: the owner's numbers as settings, seeded with the decisions (deposit 30%, 30 days, 10% fee on what
-- was paid, goods total at least UGX 100,000, reminders on days 20 and 27). Unknown keys are refused by the app.
-- layby_plans: one per order. The order is NOT paid until the whole total is in; its stock stays held and it is
-- neither delivered nor collected before then. A cancelled or lapsed plan records the refund (paid less the fee);
-- the refund itself is a person's job (a Care Desk task).
-- layby_payments: each Pesapal payment under its own LB- merchant reference, settled once (compare-and-set).
--
-- Additive: new tables only. Rollback: drop them (orders are untouched).

CREATE TABLE IF NOT EXISTS "layby_settings" (
  "key" varchar(64) PRIMARY KEY NOT NULL,
  "value" varchar(200) NOT NULL,
  "updated_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "layby_settings" ("key", "value") VALUES
  ('layby_deposit_percent', '30'),
  ('layby_term_days', '30'),
  ('layby_cancellation_fee_percent', '10'),
  ('layby_min_goods_ugx', '100000'),
  ('layby_reminder_days', '20,27')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "layby_plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL REFERENCES "orders"("id"),
  "order_number" varchar(64) NOT NULL,
  "customer_name" varchar(255),
  "customer_phone" varchar(32) NOT NULL,
  "total_ugx" bigint NOT NULL,
  "deposit_ugx" bigint NOT NULL,
  "paid_ugx" bigint DEFAULT 0 NOT NULL,
  "deposit_percent" integer NOT NULL,
  "term_days" integer NOT NULL,
  "fee_percent" integer NOT NULL,
  "status" varchar(20) DEFAULT 'awaiting_deposit' NOT NULL,
  "deposit_paid_at" timestamp with time zone,
  "due_at" timestamp with time zone,
  "reminders_sent" integer[] DEFAULT '{}' NOT NULL,
  "completed_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "closed_by" uuid,
  "close_reason" varchar(500),
  "fee_ugx" bigint,
  "refund_ugx" bigint,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "layby_plans_order_uq" UNIQUE ("order_id"),
  CONSTRAINT "layby_plans_status_chk" CHECK ("status" in ('awaiting_deposit','active','paid','lapsed','cancelled')),
  CONSTRAINT "layby_plans_amounts_chk" CHECK ("total_ugx" > 0 AND "deposit_ugx" > 0 AND "deposit_ugx" <= "total_ugx" AND "paid_ugx" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "layby_plans_status_idx" ON "layby_plans" ("status", "due_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "layby_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "plan_id" uuid NOT NULL REFERENCES "layby_plans"("id"),
  "reference" varchar(20) NOT NULL,
  "kind" varchar(12) NOT NULL,
  "amount_ugx" bigint NOT NULL,
  "status" varchar(20) DEFAULT 'awaiting_payment' NOT NULL,
  "order_tracking_id" varchar(255),
  "redirect_url" text,
  "provider_status" text,
  "confirmation_code" varchar(120),
  "payment_method" varchar(60),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "paid_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "layby_payments_reference_uq" UNIQUE ("reference"),
  CONSTRAINT "layby_payments_kind_chk" CHECK ("kind" in ('deposit','instalment')),
  CONSTRAINT "layby_payments_amount_chk" CHECK ("amount_ugx" > 0),
  CONSTRAINT "layby_payments_status_chk" CHECK ("status" in ('awaiting_payment','paid','failed','abandoned','review'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "layby_payments_tracking_uq" ON "layby_payments" ("order_tracking_id") WHERE "order_tracking_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "layby_payments_plan_idx" ON "layby_payments" ("plan_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "layby_payments_status_idx" ON "layby_payments" ("status", "created_at");
