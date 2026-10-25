-- 0209 (2026-10-25): photos on customer reviews (gap analysis #10, second half).
-- A buyer rating a delivered order may add up to three photos. Each goes through the same pipeline as a gift card
-- photo (0201): re-encoded square JPEG of at most 1080 px, metadata stripped, size-capped, so the column and the
-- checks are the same. A photo is uploaded first (unattached), then attached to the review in the same submission;
-- an upload nothing attached within two days is deleted. Photos are shown only with a PUBLISHED review and go when
-- the review is deleted. Rollback: DROP TABLE IF EXISTS review_photos;
CREATE TABLE IF NOT EXISTS review_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid REFERENCES reviews(id) ON DELETE CASCADE,
  image bytea NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  uploader_key varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  attached_at timestamptz,
  CONSTRAINT review_photos_size_chk CHECK (octet_length(image) <= 1500000 AND width BETWEEN 200 AND 1080 AND height BETWEEN 200 AND 1080)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS review_photos_review_idx ON review_photos (review_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS review_photos_created_idx ON review_photos (created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS review_photos_uploader_idx ON review_photos (uploader_key, created_at) WHERE uploader_key IS NOT NULL;
