-- 0129 — one OPEN abandonment per cart, not one row per (cart, status).
--
-- cart_abandonments_open_cart_uq was declared on (cart_id, status). Its name
-- says what was meant — at most one OPEN classification per cart — but as
-- written it also forbids a cart from ever reaching EXPIRED twice. A cart that
-- was abandoned, expired, and then re-classified as OPEN could never be expired
-- again: the OPEN -> EXPIRED update collided with its own earlier EXPIRED row.
-- Because expireOverdue is one statement, that single collision failed the
-- WHOLE hourly abandonment scan. In production it failed 227 consecutive times
-- from 2026-09-02 13:30; no OPEN abandonment has closed since, and every run
-- left a failed job in Redis.
--
-- The partial unique index expresses the real rule. Idempotent: safe to re-run.
DROP INDEX IF EXISTS "cart_abandonments_open_cart_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cart_abandonments_open_cart_uq" ON "cart_abandonments" ("cart_id") WHERE "status" = 'OPEN';
