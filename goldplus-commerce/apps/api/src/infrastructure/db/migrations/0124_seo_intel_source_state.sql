-- Source-state reconciliation (0124).
--
-- Incremental materialisation needs a durable answer to "what changed since
-- the last successful run?". Two small tables provide it. Nothing here is a
-- queue: no row is claimed, drained or acknowledged, and deleting the contents
-- degrades the system to a full rebuild rather than losing work.
--
-- MIGRATION_REQUIRED=true. This could not reuse existing schema: seo_intel_runs
-- records what a run DID, not the source boundary it read from, and there was
-- nowhere to keep a per-source cursor or a per-entity state digest.
--
-- LOCK RISK: additive only (2 new tables). Safe online.

-- ── Per-source cursors ──────────────────────────────────────────────────────

-- The cursor is (cursor_at, cursor_id), never a timestamp alone. Several rows
-- routinely share a millisecond, and a `> timestamp` scan would skip every row
-- after the first at that instant — a silent, permanent data loss that no test
-- of a single-row change would ever catch.
--
-- cursor_at is NULLABLE on purpose: sources such as categories have no
-- timestamp column at all and are reconciled by state hash instead. A NULL
-- here means "this source has no cursor", which is different from "this source
-- has never run" (no row at all).
CREATE TABLE seo_intel_source_cursors (
  source_key text PRIMARY KEY,
  cursor_at timestamptz,
  cursor_id text,
  -- The source boundary the cursor was committed at, so a materialisation can
  -- be traced back to the exact state it reasoned from.
  snapshot_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Per-entity source state ─────────────────────────────────────────────────

-- What we last observed for each source row. Two jobs:
--   1. change detection where no cursor exists (categories);
--   2. deletion detection everywhere, by diffing this inventory against what
--      the source currently holds — neither products nor categories has a
--      deleted_at column, so this is the ONLY evidence a row has disappeared.
--
-- Without it, a deleted product's derived intelligence would live forever.
CREATE TABLE seo_intel_source_state (
  source_key text NOT NULL,
  entity_id text NOT NULL,
  state_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_key, entity_id)
);

CREATE INDEX seo_intel_source_state_key_idx ON seo_intel_source_state (source_key);
