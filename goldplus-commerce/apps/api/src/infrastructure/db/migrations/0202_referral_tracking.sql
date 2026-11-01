-- 0202: invite links are tracked, held referrals are a state a person decides, and we know how each friend came.
-- Additive: one CHECK widened (adds 'held'), four nullable/defaulted columns, one new table. No ledger row is
-- written or changed. Rollback (comments only; roll the code back first):
--   UPDATE loyalty_referrals SET status = 'pending' WHERE status = 'held';
--   ALTER TABLE loyalty_referrals DROP CONSTRAINT loyalty_referrals_status_check,
--     ADD CONSTRAINT loyalty_referrals_status_check CHECK (status in ('pending','awarded','rejected'));
--   ALTER TABLE loyalty_referrals DROP COLUMN source, DROP COLUMN held_reason, DROP COLUMN decided_by, DROP COLUMN decided_at;
--   DROP TABLE loyalty_referral_visits;
ALTER TABLE "loyalty_referrals" DROP CONSTRAINT IF EXISTS "loyalty_referrals_status_check";
--> statement-breakpoint
ALTER TABLE "loyalty_referrals" ADD CONSTRAINT "loyalty_referrals_status_check" CHECK ("status" in ('pending','held','awarded','rejected'));
--> statement-breakpoint
-- How the friend's code arrived: 'link' (opened an invite link), 'typed' (typed at sign-up), 'social' (Google or
-- Facebook sign-up after an invite link), 'account' (added on their account afterwards).
ALTER TABLE "loyalty_referrals" ADD COLUMN IF NOT EXISTS "source" varchar(12) DEFAULT 'typed' NOT NULL;
--> statement-breakpoint
-- Why a referral waits for a person (monthly limit, order sent to the referrer's own phone).
ALTER TABLE "loyalty_referrals" ADD COLUMN IF NOT EXISTS "held_reason" varchar(60);
--> statement-breakpoint
ALTER TABLE "loyalty_referrals" ADD COLUMN IF NOT EXISTS "decided_by" uuid;
--> statement-breakpoint
ALTER TABLE "loyalty_referrals" ADD COLUMN IF NOT EXISTS "decided_at" timestamp with time zone;
--> statement-breakpoint
-- Invite link opens, one row per code and browser (visitor_hash = sha256 of a random id the link sets; no IP, no
-- personal data). opens counts every open; how = the button the referrer shared with.
CREATE TABLE IF NOT EXISTS "loyalty_referral_visits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(12) NOT NULL,
  "visitor_hash" char(64) NOT NULL,
  "how" varchar(12) DEFAULT 'link' NOT NULL,
  "opens" integer DEFAULT 1 NOT NULL,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "loyalty_referral_visits_opens_check" CHECK ("opens" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_referral_visits_code_visitor_uq" ON "loyalty_referral_visits" ("code", "visitor_hash");
--> statement-breakpoint
-- Referrals held BEFORE this release were left 'pending' with a fraud signal. The qualifying rule no longer needs
-- "exactly the first delivery", so a pending row would now pay itself at the friend's next delivery and skip the
-- check it was held for. They become 'held', with the order a release pays on (the signal's order, else the
-- friend's first delivered order). details may be stored as a JSON-encoded string, so it is decoded either way.
WITH signals AS (
  -- Only the two referral hold signals (our own writes), fenced before any JSON is decoded.
  SELECT s.signal_type, (s.details #>> '{}') AS details_text, s.created_at
    FROM "loyalty_fraud_signals" s
   WHERE s.signal_type IN ('REFERRAL_MONTHLY_CAP', 'REFERRAL_ORDER_TO_REFERRER_PHONE')
     AND left(s.details #>> '{}', 1) = '{'
  OFFSET 0
), held AS (
  SELECT DISTINCT ON (d.referral_id) d.referral_id, d.reason, d.order_id
    FROM (
      SELECT (sg.details_text::jsonb ->> 'referralId') AS referral_id,
             CASE sg.signal_type WHEN 'REFERRAL_MONTHLY_CAP' THEN 'MONTHLY_LIMIT' ELSE 'ORDER_TO_REFERRER_PHONE' END AS reason,
             (sg.details_text::jsonb ->> 'orderId') AS order_id, sg.created_at
        FROM signals sg
    ) d
   WHERE d.referral_id ~ '^[0-9a-f-]{36}$'
   ORDER BY d.referral_id, d.created_at DESC
)
UPDATE "loyalty_referrals" r
   SET "status" = 'held', "held_reason" = h.reason, "updated_at" = now(),
       "qualifying_order_id" = COALESCE(
         CASE WHEN h.order_id ~ '^[0-9a-f-]{36}$' THEN h.order_id::uuid END,
         (SELECT o.id FROM "orders" o WHERE o.user_id = r.referee_user_id AND o.status IN ('delivered','completed')
           ORDER BY o.created_at LIMIT 1))
  FROM held h
 WHERE r.id = h.referral_id::uuid AND r.status = 'pending';
