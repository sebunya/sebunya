-- 0208 (2026-10-25): questions and answers on product pages (gap analysis #14).
-- A shopper asks on the product page (name, question, optional phone or email); the question lands on the
-- Care Desk as a follow-up task; staff answer it from Admin > Platform modules; the answer goes back to the
-- asker by SMS or email and is published under the product for every later shopper, where it is also what
-- staff would say on WhatsApp, so the same question is not asked ten times.
-- One row per question. asker_identity_hash is the hashed visit token (as review votes), never the raw token,
-- and limits one visitor to a few questions a day. Rollback: DROP TABLE IF EXISTS product_questions;
CREATE TABLE IF NOT EXISTS product_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  asker_identity_hash varchar(64) NOT NULL,
  asker_name varchar(80) NOT NULL,
  asker_phone varchar(32),
  asker_email varchar(254),
  question varchar(500) NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'pending',
  answer text,
  answered_by uuid,
  answered_at timestamptz,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_questions_status_chk CHECK (status IN ('pending','answered','rejected'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_questions_product_status_idx ON product_questions (product_id, status, answered_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_questions_asker_day_idx ON product_questions (asker_identity_hash, created_at);
