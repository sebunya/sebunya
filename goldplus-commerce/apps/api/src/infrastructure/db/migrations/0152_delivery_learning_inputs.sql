-- 0152: the delivery learning loop gets the inputs it was missing
-- (owner-approved 2026-09-24; docs/delivery/CONTRACT.md #3 and #10).
--
-- The nightly calibration could never fit the hour factor or the detour factor,
-- and an hour window could never be earned:
--   * scopes() had no hours, and every observation's hour of week was NULL;
--   * every observation's straight-line distance was NULL, so no detour fit had
--     a usable row;
--   * the window percentiles were computed and thrown away, and the quote read
--     observedMinutes as a hard-coded NULL.
--
-- Additive and backward compatible: two NULLABLE capture columns (old rows stay
-- NULL and are simply not usable for those two fits, exactly as before) and one
-- new table the nightly job replaces wholesale. Old code ignores all three.
--
-- Rollback: ALTER TABLE delivery_quote_capture DROP COLUMN eat_hour_of_week,
--           DROP COLUMN straight_line_km; DROP TABLE delivery_window_percentile;
ALTER TABLE "delivery_quote_capture" ADD COLUMN IF NOT EXISTS "eat_hour_of_week" smallint;
--> statement-breakpoint
ALTER TABLE "delivery_quote_capture" ADD COLUMN IF NOT EXISTS "straight_line_km" numeric(8, 2);

--> statement-breakpoint
-- Per-area observed delivery minutes (p10/p90), derived nightly from real
-- deliveries only. No row = no hour window for that area (the day-level promise).
CREATE TABLE IF NOT EXISTS "delivery_window_percentile" (
  "scope_key" varchar(160) PRIMARY KEY,
  "p10_minutes" numeric(8, 2) NOT NULL,
  "p90_minutes" numeric(8, 2) NOT NULL,
  "sample_size" integer NOT NULL,
  "computed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "delivery_window_percentile_order_chk" CHECK ("p10_minutes" > 0 AND "p90_minutes" >= "p10_minutes"),
  CONSTRAINT "delivery_window_percentile_sample_chk" CHECK ("sample_size" > 0)
);
