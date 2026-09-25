-- 0156 — Attribution module (docs/measurement/ATTRIBUTION.md).
--
-- Landing touches have been recorded in measurement.touchpoint since 0141, but
-- nothing ever tied a touch to the order it led to: the only join was made
-- inside the nightly batch, and the legacy attribution_touchpoints table (0013)
-- has no live writer at all. This adds:
--   * measurement.order_touch_link    — which recorded visits belong to an order;
--   * measurement.order_source_report — "How did you hear about us?" answers and
--                                       WhatsApp reference codes (insert-only evidence);
--   * measurement.whatsapp_ref        — which visitor each click-to-chat code was issued to;
--   * measurement.order_channel_credit — each order's channel credit under each model
--                                       (derived, recomputable).
--
-- ADDITIVE ONLY: new tables and indexes. No existing row is changed; no INSERTs.
--
-- Rollback:
--   DROP TABLE IF EXISTS measurement.order_channel_credit, measurement.order_source_report,
--     measurement.whatsapp_ref, measurement.order_touch_link;
CREATE TABLE IF NOT EXISTS measurement.order_touch_link (
  order_id    uuid NOT NULL REFERENCES orders(id),
  touch_id    uuid NOT NULL REFERENCES measurement.touchpoint(touch_id),
  link_method text NOT NULL CHECK (link_method IN ('visitor', 'whatsapp_ref')),
  linked_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, touch_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS order_touch_link_touch_idx ON measurement.order_touch_link (touch_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS measurement.whatsapp_ref (
  code            text PRIMARY KEY CHECK (code ~ '^GP-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$'),
  environment     text NOT NULL,
  anonymous_id    text NOT NULL,
  client_event_id uuid NOT NULL,
  issued_at       timestamptz NOT NULL,
  page_path       text,
  traffic_class   text NOT NULL DEFAULT 'customer',
  recorded_at     timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS whatsapp_ref_visitor_idx ON measurement.whatsapp_ref (anonymous_id, issued_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS measurement.order_source_report (
  report_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES orders(id),
  reported_by  text NOT NULL CHECK (reported_by IN ('customer', 'admin')),
  answer       text,
  whatsapp_ref text,
  note         text,
  actor_id     uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_source_report_has_content CHECK (answer IS NOT NULL OR whatsapp_ref IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS order_source_report_order_idx ON measurement.order_source_report (order_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS measurement.order_channel_credit (
  order_id      uuid NOT NULL REFERENCES orders(id),
  model         text NOT NULL CHECK (model IN ('last_click', 'first_touch', 'linear', 'time_decay', 'position_based', 'self_reported')),
  channel       text NOT NULL,
  detail        text NOT NULL DEFAULT '',
  weight        numeric NOT NULL CHECK (weight > 0 AND weight <= 1.000001),
  credited_ugx  bigint NOT NULL,
  basis         text NOT NULL CHECK (basis IN ('observed', 'declared')),
  model_version text NOT NULL,
  computed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, model, channel, detail)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS order_channel_credit_model_idx ON measurement.order_channel_credit (model, order_id);
