-- 0192: upcountry shipping is by TAXI, by BUS, or a special arrangement — never a ferry, and each destination
-- differs (owner, 2026-10-16). A rate card now says which: 'taxi' (a matatu from the taxi park to a stage, often the
-- same day, the conductor is paid on collection), 'bus' (a bus company's parcel office), or 'special' (we arrange it
-- personally and confirm the fee by phone; no price is quoted). handover_point names the stage or office the
-- customer collects from. Existing cards are 'bus', which is what they were entered as. Additive; rollback: DROP COLUMN.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE delivery_bus_rate_card
  ADD COLUMN IF NOT EXISTS carrier_kind varchar(12) NOT NULL DEFAULT 'bus',
  ADD COLUMN IF NOT EXISTS handover_point varchar(160);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE delivery_bus_rate_card ADD CONSTRAINT delivery_bus_rate_card_kind_check CHECK (carrier_kind in ('taxi','bus','special'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
