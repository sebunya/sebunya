CREATE TABLE IF NOT EXISTS "first_party_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fp_client_id" varchar(255),
	"user_id" uuid,
	"gclid" varchar(512),
	"wbraid" varchar(512),
	"gbraid" varchar(512),
	"fbc" varchar(512),
	"fbp" varchar(512),
	"ttclid" varchar(512),
	"twclid" varchar(512),
	"li_fat_id" varchar(512),
	"epik" varchar(512),
	"hashed_email" varchar(64),
	"hashed_phone" varchar(64),
	"ip_address" varchar(64),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "telemetry_dlq" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"original_outbox_event_id" uuid NOT NULL,
	"event_name" varchar(100) NOT NULL,
	"event_id" varchar(255) NOT NULL,
	"payload" jsonb NOT NULL,
	"total_attempts" integer NOT NULL,
	"failed_reason" text NOT NULL,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_note" text,
	CONSTRAINT "telemetry_dlq_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "dealer_applications" ALTER COLUMN "location" SET DATA TYPE varchar(512);