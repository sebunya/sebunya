-- U3 §14 — product reviews, ratings, verified purchase.
--
-- WHY
-- Reviews are the primary trust signal against counterfeits and the precondition
-- for AggregateRating structured data. Verification is computed at submission
-- (order line resolves to a delivered order for the same identity) and stored,
-- never trusted from input. The aggregate is maintained transactionally with
-- publish/unpublish, never computed on read.
--
-- LOCK RISK: additive (four new tables + indexes). Safe online.

CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  order_item_id uuid REFERENCES order_items(id),
  customer_identity_hash varchar(64) NOT NULL,
  rating smallint NOT NULL,
  title varchar(140),
  body text,
  is_verified_purchase boolean NOT NULL DEFAULT false,
  status varchar(12) NOT NULL DEFAULT 'pending',
  moderated_by uuid,
  moderated_at timestamptz,
  rejection_reason varchar(120),
  flag_reason varchar(120),
  helpful_count integer NOT NULL DEFAULT 0,
  language varchar(8) NOT NULL DEFAULT 'en',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviews_rating_chk CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT reviews_status_chk CHECK (status IN ('pending','published','rejected','flagged'))
);

CREATE INDEX reviews_product_status_created_idx ON reviews (product_id, status, created_at);
-- One review per verified order line.
CREATE UNIQUE INDEX reviews_order_item_uq ON reviews (order_item_id) WHERE order_item_id IS NOT NULL;
-- One review per identity per product (verified or not).
CREATE UNIQUE INDEX reviews_identity_product_uq ON reviews (product_id, customer_identity_hash);

CREATE TABLE review_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES reviews(id),
  storage_url varchar(500) NOT NULL,
  media_type varchar(24) NOT NULL,
  display_order integer NOT NULL DEFAULT 0
);
CREATE INDEX review_media_review_idx ON review_media (review_id, display_order);

CREATE TABLE review_votes (
  review_id uuid NOT NULL REFERENCES reviews(id),
  voter_identity_hash varchar(64) NOT NULL,
  vote varchar(12) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, voter_identity_hash),
  CONSTRAINT review_votes_vote_chk CHECK (vote IN ('helpful','not_helpful'))
);

CREATE TABLE product_rating_aggregate (
  product_id uuid PRIMARY KEY REFERENCES products(id),
  rating_count integer NOT NULL DEFAULT 0,
  rating_sum integer NOT NULL DEFAULT 0,
  rating_average numeric(3,2),
  distribution jsonb NOT NULL DEFAULT '{}',
  last_recomputed_at timestamptz
);
