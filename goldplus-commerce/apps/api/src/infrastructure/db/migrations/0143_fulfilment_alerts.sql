-- Fulfilment alerts (0143). Who gets told, on a phone, the moment an order is paid.
--
-- A closed key/value registry in the same discipline as payments_ops_config: a
-- key outside the code's registry cannot be written, and every value ships
-- UNSET, which means the alert is off. Nothing here was invented by a developer.
--
-- Deliberately NOT business_info: that table is the shop's PUBLIC contact
-- details, and an internal alert recipient is not a fact about the shop that
-- customers should ever read.
--
-- Rollback: DROP TABLE fulfilment_alert_config;
CREATE TABLE IF NOT EXISTS "fulfilment_alert_config" (
  "config_key" text PRIMARY KEY,
  "config_value" text NOT NULL,
  "updated_by" uuid,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
