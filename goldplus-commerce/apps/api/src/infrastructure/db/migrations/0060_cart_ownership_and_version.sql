-- Cart ownership, versioning and expiry.
--
-- FINDING — no object-level authorization on any cart route
-- Every cart route took a `cartId` straight from the request and acted on it:
--
--   POST /commerce/cart/add     -> add items to any cart
--   POST /commerce/cart/update  -> change quantities in any cart
--   POST /commerce/cart/remove  -> empty any cart
--   GET  /commerce/carts/:id    -> read any cart's contents
--
-- The id is a v4 UUID, so it is not guessable — but the design rested entirely on
-- that secrecy, and the value travels where a secret must not: it is the browser's
-- `goldplus_cart_id` cookie, and on the read route it is a URL PATH SEGMENT, so it
-- lands in access logs, proxy logs, browser history and Referer headers. An
-- unguessable identifier in a URL is not an authorization boundary.
--
-- The row itself also could not answer "whose cart is this?". `user_id`,
-- `session_id` and `anonymous_id` all existed and none was ever populated by the
-- cart routes, so even a correct check had nothing to check against.
--
-- CHANGE
--   owner_kind  USER | GUEST      — which kind of principal owns this cart
--   owner_id    the verified user id, or the signed guest principal id
--   version     monotonic, for optimistic concurrency
--   expires_at  bounded lifetime, so an abandoned cart is reclaimable
--
-- WHY A VERSION
-- Cart writes were read-modify-write with no concurrency control: the repository
-- deleted every item row and reinserted the whole basket. Two tabs updating one cart
-- therefore raced, and the loser's change vanished silently — including a REMOVE
-- being undone by a concurrent UPDATE, which puts an item the customer deleted back
-- into the order. A version compared in the WHERE clause makes the loser fail loudly
-- so it can re-read and retry.
--
-- WHY owner_kind IS NULLABLE
-- Existing carts predate ownership and cannot be attributed retroactively — there is
-- no record of who created them. They are left unowned rather than being guessed at,
-- and the API treats an unowned cart as claimable by the first credential that
-- presents it, which is the same access the caller already had. Backfilling a guessed
-- owner would be worse than admitting the gap: it would look like an authorization
-- decision that nobody actually made.
--
-- Additive and idempotent.
-- Rollback:
--   ALTER TABLE "carts" DROP COLUMN IF EXISTS "owner_kind";
--   ALTER TABLE "carts" DROP COLUMN IF EXISTS "owner_id";
--   ALTER TABLE "carts" DROP COLUMN IF EXISTS "version";
--   ALTER TABLE "carts" DROP COLUMN IF EXISTS "expires_at";
--   ALTER TABLE "carts" DROP COLUMN IF EXISTS "updated_at";

ALTER TABLE "carts"
  ADD COLUMN IF NOT EXISTS "owner_kind" varchar(8);
--> statement-breakpoint
ALTER TABLE "carts"
  ADD COLUMN IF NOT EXISTS "owner_id" varchar(128);
--> statement-breakpoint
ALTER TABLE "carts"
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "carts"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE "carts"
  ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'carts_owner_kind_known') THEN
    ALTER TABLE "carts"
      ADD CONSTRAINT "carts_owner_kind_known" CHECK (
        "owner_kind" IS NULL OR "owner_kind" IN ('USER', 'GUEST')
      );
  END IF;
END
$$;
--> statement-breakpoint
-- An owned cart must name its owner. A row with a kind and no id, or an id and no
-- kind, is not a weaker authorization record — it is an unanswerable one, and the
-- API would have to either refuse it or ignore the ownership entirely.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'carts_owner_complete') THEN
    ALTER TABLE "carts"
      ADD CONSTRAINT "carts_owner_complete" CHECK (
        ("owner_kind" IS NULL AND "owner_id" IS NULL)
        OR ("owner_kind" IS NOT NULL AND "owner_id" IS NOT NULL)
      );
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "carts"
  DROP CONSTRAINT IF EXISTS "carts_version_positive";
--> statement-breakpoint
ALTER TABLE "carts"
  ADD CONSTRAINT "carts_version_positive" CHECK ("version" >= 1);
--> statement-breakpoint
-- Answers "which carts does this principal own", which is what lets a signed-in
-- customer's carts be found without scanning.
CREATE INDEX IF NOT EXISTS "carts_owner_idx" ON "carts" ("owner_kind", "owner_id");
--> statement-breakpoint
-- Supports the expiry sweep without a full scan. Partial, because a cart with no
-- expiry is never a candidate.
CREATE INDEX IF NOT EXISTS "carts_expires_at_idx"
  ON "carts" ("expires_at")
  WHERE "expires_at" IS NOT NULL;
--> statement-breakpoint
-- Quantity bounds belong in the database as well as the request schema. Validation
-- in a route protects that route; a constraint protects the column from every writer,
-- including a future admin tool, a migration and a repair script.
ALTER TABLE "cart_items"
  DROP CONSTRAINT IF EXISTS "cart_items_quantity_bounded";
--> statement-breakpoint
DO $$
DECLARE
  offending integer;
BEGIN
  SELECT count(*) INTO offending FROM "cart_items" WHERE "quantity" < 1 OR "quantity" > 999;
  IF offending > 0 THEN
    -- NOT VALID rather than a refusal to deploy. Existing out-of-range rows are a
    -- data question about real baskets, and a migration is not entitled to settle it
    -- by deleting them or by blocking the release. New writes are constrained
    -- immediately; the existing rows are reported for a human to resolve.
    RAISE WARNING 'CART_ITEMS_QUANTITY_OUT_OF_RANGE: % existing row(s) violate 1..999; constraint added NOT VALID', offending;
    ALTER TABLE "cart_items"
      ADD CONSTRAINT "cart_items_quantity_bounded" CHECK ("quantity" >= 1 AND "quantity" <= 999) NOT VALID;
  ELSE
    ALTER TABLE "cart_items"
      ADD CONSTRAINT "cart_items_quantity_bounded" CHECK ("quantity" >= 1 AND "quantity" <= 999);
  END IF;
END
$$;
--> statement-breakpoint
-- One row per (cart, product). The repository's delete-then-reinsert hid the absence
-- of this: nothing stopped two rows for the same product, and a partial failure
-- mid-reinsert could leave duplicates that silently double a line.
CREATE UNIQUE INDEX IF NOT EXISTS "cart_items_cart_product_idx"
  ON "cart_items" ("cart_id", "product_id");
