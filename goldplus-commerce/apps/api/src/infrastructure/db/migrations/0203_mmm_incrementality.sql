-- 0203: marketing mix modelling inputs, owned-channel holdouts, cross-device identity, GA4 reconciliation (2026-10-23).
-- Additive: new tables in the measurement schema and one settings table. No existing row is read differently.
-- Rollback (comments only; roll the code back first):
--   DROP TABLE measurement.reconciliation, measurement.holdout_outcome, measurement.holdout_assignment,
--     measurement.control_series, measurement.mmm_daily, measurement.config; restore the order_touch_link CHECK to ('visitor','whatsapp_ref').
CREATE SCHEMA IF NOT EXISTS measurement;
--> statement-breakpoint
-- Closed-registry settings (domain/measurement/MeasurementConfig.ts), the payments_ops_config pattern.
CREATE TABLE IF NOT EXISTS measurement.config (
  config_key varchar(64) PRIMARY KEY,
  config_value text NOT NULL,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- The holdout salt is generated once per database so an arm can never be predicted from a customer id alone.
INSERT INTO measurement.config (config_key, config_value) VALUES ('holdout_salt', gen_random_uuid()::text) ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Cross-device identity already lives in customer_identity_links (0155, signal STABLE_ANONYMOUS_ID, key fp:<id>).
-- Attribution now links an order to touches of EVERY browser the customer was seen in; those links say so.
ALTER TABLE measurement.order_touch_link DROP CONSTRAINT IF EXISTS order_touch_link_link_method_check;
--> statement-breakpoint
ALTER TABLE measurement.order_touch_link ADD CONSTRAINT order_touch_link_link_method_check CHECK (link_method IN ('visitor','whatsapp_ref','stitched'));
--> statement-breakpoint
-- One row per Kampala day and channel: what was spent, what arrived, what was sold. Rebuilt nightly for the last
-- 400 days from media_cost_facts, measurement.touchpoint and orders; exported as daily.csv for ops/mmm.
CREATE TABLE IF NOT EXISTS measurement.mmm_daily (
  day date NOT NULL,
  channel varchar(40) NOT NULL,
  spend_minor bigint NOT NULL DEFAULT 0,
  impressions bigint,
  clicks bigint,
  sessions integer NOT NULL DEFAULT 0,
  orders integer NOT NULL DEFAULT 0,
  revenue_minor bigint NOT NULL DEFAULT 0,
  built_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (day, channel)
);
--> statement-breakpoint
-- Things that move sales and are not marketing. source 'calendar' (holidays, school terms), 'measured'
-- (stock-outs, price index, delivery fee: written nightly for that day), 'manual' (typed in: mobile-money outages).
CREATE TABLE IF NOT EXISTS measurement.control_series (
  day date NOT NULL,
  control_key varchar(40) NOT NULL,
  value numeric(14,6) NOT NULL,
  source varchar(16) NOT NULL,
  note varchar(200),
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (day, control_key)
);
--> statement-breakpoint
-- Who was treated and who was held, per programme and monthly wave. subject_ref is the thing the message was
-- about (order id, user id); customer_key is how outcomes are joined (user:<id> or phone:<sha256>).
CREATE TABLE IF NOT EXISTS measurement.holdout_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  programme varchar(40) NOT NULL,
  wave_key varchar(16) NOT NULL,
  subject_ref varchar(120) NOT NULL,
  customer_key varchar(80) NOT NULL,
  arm varchar(8) NOT NULL CHECK (arm in ('treat','hold')),
  channel varchar(16),
  assigned_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT holdout_assignment_uq UNIQUE (programme, wave_key, subject_ref)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS holdout_assignment_wave_idx ON measurement.holdout_assignment (programme, wave_key, arm);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS measurement.holdout_outcome (
  programme varchar(40) NOT NULL,
  wave_key varchar(16) NOT NULL,
  arm varchar(8) NOT NULL,
  window_days integer NOT NULL,
  subjects integer NOT NULL,
  buyers integer NOT NULL,
  orders integer NOT NULL,
  revenue_minor bigint NOT NULL,
  computed_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (programme, wave_key, arm, window_days)
);
--> statement-breakpoint
-- GA4 purchases against the shop's own online orders, per day; status from the tolerance in measurement.config.
CREATE TABLE IF NOT EXISTS measurement.reconciliation (
  day date NOT NULL,
  source varchar(16) NOT NULL,
  external_orders integer,
  external_revenue_minor bigint,
  shop_orders integer NOT NULL,
  shop_revenue_minor bigint NOT NULL,
  delta_pct numeric(8,2),
  status varchar(12) NOT NULL,
  message varchar(300),
  computed_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (day, source)
);
