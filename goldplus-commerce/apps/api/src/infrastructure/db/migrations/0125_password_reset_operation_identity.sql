-- Password reset: operation identity and token supersession (B+, M1 EXPAND).
--
-- A reset OPERATION is what the customer started. A reset TOKEN is one
-- credential attempt belonging to it. Until now the token WAS the only
-- identity, so a delivery retry had nowhere to hang: the provider link cannot
-- be rebuilt (only a SHA-256 hash is stored), and issuing a replacement token
-- had no way to say "this is the same reset the customer asked for".
--
-- MODEL T, not a new operations table. Verified first: nothing deletes these
-- rows. There is no purge job, no retention sweep, no scheduler and no DELETE
-- anywhere in the repository — the sole removal path is ON DELETE CASCADE from
-- users, which destroys the account and therefore the operation legitimately.
-- The root row is durable, so it can safely BE the operation.
--
-- operation_id  the root token's own id, shared by every later attempt of the
--               same operation. Nullable for the rolling-deploy window, so old
--               application instances writing legacy rows stay valid.
-- superseded_at set when a token is retired by rotation. Distinct from
--               consumed_at (customer used it) and from expiry (time passed):
--               three different endings that must stay tellable apart.
--
-- No lineage column. Rotation order is already derivable from created_at, and
-- attempt counting lives on the outbox event, so superseded_by_token_id and a
-- generation counter would both be storage without an invariant behind them.
--
-- Operation expiry needs no column either: it derives as
--   root.created_at + OPERATION_TTL
-- which is immutable by construction, so a rotation CANNOT extend an
-- operation's life. That property is structural rather than enforced.
ALTER TABLE "password_reset_tokens" ADD COLUMN IF NOT EXISTS "operation_id" uuid;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD COLUMN IF NOT EXISTS "superseded_at" timestamp with time zone;--> statement-breakpoint

-- Backfill: every historical token is its own single-attempt operation, which
-- is exactly what it was.
UPDATE "password_reset_tokens" SET "operation_id" = "id" WHERE "operation_id" IS NULL;--> statement-breakpoint

-- THE concurrency backstop: at most one unconsumed, unsuperseded token per
-- operation. Two workers racing to rotate cannot both win, because the second
-- insert violates this index rather than relying on the application having
-- locked correctly. Note the precise claim — this bounds CURRENT tokens, not
-- "live" ones: an expired-but-unsuperseded token still occupies the slot, and
-- the rotation path supersedes before inserting, so that is the intended
-- ordering rather than an obstacle.
CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_one_current_token_per_operation"
  ON "password_reset_tokens" ("operation_id")
  WHERE "consumed_at" IS NULL AND "superseded_at" IS NULL AND "operation_id" IS NOT NULL;--> statement-breakpoint

-- Retry workers claim by operation; this is the access path for that lookup.
CREATE INDEX IF NOT EXISTS "password_reset_tokens_operation_idx"
  ON "password_reset_tokens" ("operation_id", "created_at");
