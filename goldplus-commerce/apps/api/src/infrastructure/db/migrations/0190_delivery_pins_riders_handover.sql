-- 0190: pins on orders, riders, and handover facts (address system spec Phase B, as corrected by the review board).
--
-- A WhatsApp location pin is a front door. It lives here, with a purge date, never in the assistant archive or the
-- audit log (ConversationArchive redacts coordinates since 0189). It is attached to an order only after the customer
-- confirms "deliver here", and written to a saved address only after a second explicit tap.
-- Riders get an identity so a location from a rider's phone is a handover, not a customer pin; the handover's point
-- and "hard to find" land on the delivery attempt and feed the capture.
--
-- Additive. Rollback: DROP TABLE delivery_order_pin, whatsapp_pending_location, delivery_riders; DROP the columns
-- below. Older code never reads them.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS delivery_order_pin (
  order_id uuid PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  lat numeric(9,6) NOT NULL,
  lng numeric(9,6) NOT NULL,
  accuracy_m integer,
  source varchar(24) NOT NULL CHECK (source IN ('whatsapp','device','map_link','rider','saved_address')),
  source_ref varchar(160),                       -- the WhatsApp message id the pin came in on
  captured_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,                      -- the customer tapped "Yes, deliver here"
  saved_to_address boolean NOT NULL DEFAULT false,
  purge_after timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS delivery_order_pin_purge_idx ON delivery_order_pin (purge_after);
--> statement-breakpoint
-- A location that could not be attached yet (several open orders, or awaiting "deliver here?"): kept a day, by message id.
CREATE TABLE IF NOT EXISTS whatsapp_pending_location (
  wamid varchar(160) PRIMARY KEY,
  phone_e164 varchar(20) NOT NULL,
  lat numeric(9,6) NOT NULL,
  lng numeric(9,6) NOT NULL,
  forwarded boolean NOT NULL DEFAULT false,
  candidate_order_ids uuid[] NOT NULL DEFAULT '{}',
  rider_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS whatsapp_pending_location_phone_idx ON whatsapp_pending_location (phone_e164, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS delivery_riders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(120) NOT NULL,
  phone_e164 varchar(20) NOT NULL UNIQUE,         -- worker contact: masked in admin, never in exports or audit rows
  active boolean NOT NULL DEFAULT true,
  added_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE fulfilment_dispatches ADD COLUMN IF NOT EXISTS rider_id uuid REFERENCES delivery_riders(id);
--> statement-breakpoint
ALTER TABLE fulfilment_deliveries
  ADD COLUMN IF NOT EXISTS handover_lat numeric(9,6),
  ADD COLUMN IF NOT EXISTS handover_lng numeric(9,6),
  ADD COLUMN IF NOT EXISTS handover_accuracy_m integer,
  ADD COLUMN IF NOT EXISTS find_difficulty varchar(8),
  ADD COLUMN IF NOT EXISTS recorded_via varchar(20);
--> statement-breakpoint
ALTER TABLE delivery_quote_capture ADD COLUMN IF NOT EXISTS point_source varchar(24);
