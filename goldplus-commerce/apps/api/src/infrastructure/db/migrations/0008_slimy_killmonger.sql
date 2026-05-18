CREATE TABLE IF NOT EXISTS "payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"merchant_reference" varchar(255) NOT NULL,
	"order_tracking_id" varchar(255),
	"amount" integer NOT NULL,
	"currency" varchar(10) DEFAULT 'UGX' NOT NULL,
	"status" varchar(30) DEFAULT 'not_started' NOT NULL,
	"redirect_url" varchar(512),
	"provider" varchar(50) DEFAULT 'pesapal' NOT NULL,
	"ipn_received_at" timestamp with time zone,
	"callback_received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_attempts_merchant_reference_unique" UNIQUE("merchant_reference")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_tracking_idx" ON "payment_attempts" ("order_tracking_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_reference_idx" ON "payment_attempts" ("merchant_reference");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
