-- 0179: Goldie's answer memory (owner, 2026-10-13: keep model use low so the shop does not depend
-- on it). A paid answer to a general shopping question is remembered under a normalised key; the
-- next customer who asks the same thing gets it at no model cost, after the prices and stock it
-- mentions are re-checked live (any change and the model is asked again). The team can pin, edit
-- or retire answers; two poor ratings retire one automatically. Messages served from memory carry
-- the entry id, so a rating reaches the answer that earned it.
--
-- Additive and reversible. Rollback:
--   ALTER TABLE assistant_messages DROP COLUMN IF EXISTS cache_id;
--   DROP TABLE IF EXISTS assistant_answer_memory;

CREATE TABLE IF NOT EXISTS assistant_answer_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_key varchar(64) NOT NULL,
  question text NOT NULL,
  answer text NOT NULL,
  intent varchar(20),
  -- The products the answer names, as they were: [{ slug, price_ugx, availability }].
  products jsonb DEFAULT '[]'::jsonb NOT NULL,
  pinned boolean DEFAULT false NOT NULL,
  edited boolean DEFAULT false NOT NULL,
  retired boolean DEFAULT false NOT NULL,
  asks integer DEFAULT 1 NOT NULL,
  served integer DEFAULT 0 NOT NULL,
  poor_ratings integer DEFAULT 0 NOT NULL,
  stale_misses integer DEFAULT 0 NOT NULL,
  expires_at timestamptz,
  last_served_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS assistant_answer_memory_key_uq ON assistant_answer_memory (question_key);
--> statement-breakpoint
ALTER TABLE assistant_messages ADD COLUMN IF NOT EXISTS cache_id uuid;
