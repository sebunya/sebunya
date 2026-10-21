-- 0200: gift card occasions (owner brief 2026-10-21).
--
-- 1. More occasions a buyer can choose: Anniversary, Valentine's Day, Mother's Day, Father's Day, Easter, Eid,
--    Christmas and New Year join the six (A gift for you, Birthday, Thank you, With love, Congratulations, Season's
--    greetings). The check widens; no existing value changes.
-- 2. gift_card_occasion_settings: ONE row an owner edits on Admin > Gift cards: Eid dates once announced, and
--    time-boxed adjustments that bring an occasion forward or stop featuring it. It changes prominence only; every
--    occasion stays selectable. Read when the buy page is opened, so a window starting or ending needs no deploy.
--
-- Additive. Rollback: drop the table and restore the six-value check (only if no purchase uses a new occasion).

ALTER TABLE "gift_card_purchases" DROP CONSTRAINT IF EXISTS "gift_card_purchases_theme_chk";
ALTER TABLE "gift_card_purchases" ADD CONSTRAINT "gift_card_purchases_theme_chk" CHECK ("theme" in (
  'gold','birthday','thanks','celebrate','love','anniversary',
  'valentine','mothers_day','fathers_day','easter','eid','christmas','new_year','festive'));

CREATE TABLE IF NOT EXISTS "gift_card_occasion_settings" (
  "id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
  "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "gift_card_occasion_settings_one_row" CHECK ("id" = 1)
);
INSERT INTO "gift_card_occasion_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;
