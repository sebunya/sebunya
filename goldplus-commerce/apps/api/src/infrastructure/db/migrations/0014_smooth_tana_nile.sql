CREATE TABLE IF NOT EXISTS "payment_measurement_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" varchar(255) NOT NULL,
	"payment_reference" varchar(255),
	"pesapal_tracking_id" varchar(255),
	"status" varchar(50) NOT NULL,
	"amount" real,
	"currency" varchar(10),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_measurement_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" varchar(255) NOT NULL,
	"payment_reference" varchar(255),
	"event_id" varchar(255) NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"payload_summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_measurement_events_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "purchase_measurement_events_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pmr_order_idx" ON "payment_measurement_reconciliations" ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pmr_payment_ref_idx" ON "payment_measurement_reconciliations" ("payment_reference");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pmr_pesapal_idx" ON "payment_measurement_reconciliations" ("pesapal_tracking_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pme_order_idx" ON "purchase_measurement_events" ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pme_idempotency_idx" ON "purchase_measurement_events" ("idempotency_key");