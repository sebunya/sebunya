-- 0212 (2026-10-31): photos as proof of delivery. Until now a delivery attempt's proof was a free-text reference
-- and, from a rider's WhatsApp, where they stood; a disputed delivery had no picture. Staff (or a rider through
-- them) may add up to three photos to a delivery attempt: the parcel at the door, the customer holding it, a signed
-- note. Same pipeline as review photos (0209): re-encoded JPEG of at most 1080 px, metadata stripped, size-capped.
-- Staff-only: never shown to shoppers. Kept with the delivery record. Rollback: DROP TABLE IF EXISTS delivery_proof_photos;
CREATE TABLE IF NOT EXISTS delivery_proof_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES fulfilment_deliveries(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id),
  image bytea NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_proof_photos_size_chk CHECK (octet_length(image) <= 1500000 AND width BETWEEN 200 AND 1080 AND height BETWEEN 200 AND 1080)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS delivery_proof_photos_delivery_idx ON delivery_proof_photos (delivery_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS delivery_proof_photos_order_idx ON delivery_proof_photos (order_id);
