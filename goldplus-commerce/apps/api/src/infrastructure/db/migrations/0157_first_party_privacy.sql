-- 0157: first-party data, part two (docs/first-party/README.md).
--
-- Two additive pieces, nothing dropped, nothing rewritten:
--   1. privacy_requests — a signed-in customer's own data requests: EXPORT
--      (served at once, recorded here), ANONYMISE_HISTORY and DELETE_ACCOUNT
--      (received here, carried out or declined by a person in admin, each step
--      audited). result holds counts only, never personal data.
--   2. customer_consent_anchors — browser ids (`_fp_cid`) tied to a customer
--      ONLY so a stored refusal on that browser is honoured (advertising
--      audiences, messaging). Written when identity stitching was NOT allowed to
--      link the browser as behaviour (personalisation refused, or the consent
--      answer unreadable). Never read for profiling or personalisation.
--
-- Rollback: DROP TABLE privacy_requests, customer_consent_anchors;
CREATE TABLE IF NOT EXISTS "privacy_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(16) NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(24) NOT NULL,
	"status" varchar(16) DEFAULT 'RECEIVED' NOT NULL,
	"customer_note" text,
	"idempotency_key" varchar(80),
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"completed_at" timestamp with time zone,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "privacy_requests_reference_unique" UNIQUE ("reference"),
	CONSTRAINT "privacy_requests_idempotency_key_unique" UNIQUE ("idempotency_key"),
	CONSTRAINT "privacy_requests_kind_chk" CHECK ("kind" IN ('EXPORT', 'ANONYMISE_HISTORY', 'DELETE_ACCOUNT')),
	CONSTRAINT "privacy_requests_status_chk" CHECK ("status" IN ('RECEIVED', 'COMPLETED', 'DECLINED', 'WITHDRAWN'))
);
--> statement-breakpoint
-- One open erasure request of each kind per customer; exports are served at once.
CREATE UNIQUE INDEX IF NOT EXISTS "privacy_requests_open_uq"
	ON "privacy_requests" ("user_id", "kind") WHERE "status" = 'RECEIVED';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "privacy_requests_status_idx" ON "privacy_requests" ("status", "requested_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "privacy_requests_user_idx" ON "privacy_requests" ("user_id", "requested_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_consent_anchors" (
	"canonical_customer_id" uuid NOT NULL,
	"fp_client_id" varchar(120) NOT NULL,
	"reason" varchar(40) NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	PRIMARY KEY ("canonical_customer_id", "fp_client_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_consent_anchors_fp_idx" ON "customer_consent_anchors" ("fp_client_id");
