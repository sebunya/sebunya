-- U5 §16 — flash sales with separate allocation and reservation.
--
-- WHY
-- A flash sale is a promotion (extends U1) with a separately allocated unit pool.
-- Allocation is decremented through a reservation, never directly, so a sale
-- cannot consume inventory promised to dealers/pre-orders. Exactly-N allocation
-- under 1000-way concurrency is enforced by a CONDITIONAL decrement on
-- units_reserved; PostgreSQL is the durable truth (Redis is a high-rate front
-- reconciled back here). Per-customer limits are enforced at reservation.
--
-- LOCK RISK: additive (new tables + indexes). Safe online.

CREATE TABLE flash_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(160) NOT NULL,
  promotion_id uuid REFERENCES promotion_definitions(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reveal_at timestamptz,
  allocation_type varchar(24) NOT NULL DEFAULT 'fixed_units',
  per_customer_limit integer,
  per_order_limit integer,
  queue_capacity integer,
  status varchar(12) NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT flash_sales_status_chk CHECK (status IN ('draft','scheduled','live','sold_out','ended','cancelled')),
  CONSTRAINT flash_sales_allocation_chk CHECK (allocation_type IN ('unlimited','fixed_units','percentage_of_stock')),
  CONSTRAINT flash_sales_window_chk CHECK (ends_at > starts_at)
);
CREATE INDEX flash_sales_status_idx ON flash_sales (status, starts_at);

CREATE TABLE flash_sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flash_sale_id uuid NOT NULL REFERENCES flash_sales(id),
  product_id uuid NOT NULL REFERENCES products(id),
  flash_price_ugx bigint NOT NULL,
  original_price_ugx bigint NOT NULL,
  units_allocated integer NOT NULL,
  units_sold integer NOT NULL DEFAULT 0,
  units_reserved integer NOT NULL DEFAULT 0,
  CONSTRAINT flash_sale_items_counts_chk CHECK (units_sold >= 0 AND units_reserved >= 0 AND units_sold + units_reserved <= units_allocated)
);
CREATE UNIQUE INDEX flash_sale_items_sale_product_idx ON flash_sale_items (flash_sale_id, product_id);

CREATE TABLE flash_sale_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flash_sale_item_id uuid NOT NULL REFERENCES flash_sale_items(id),
  customer_identity_hash varchar(64) NOT NULL,
  reservation_token varchar(80) NOT NULL,
  idempotency_key varchar(120) NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  status varchar(12) NOT NULL DEFAULT 'reserved',
  reserved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  CONSTRAINT flash_sale_reservations_status_chk CHECK (status IN ('reserved','confirmed','released','expired')),
  CONSTRAINT flash_sale_reservations_qty_chk CHECK (quantity > 0)
);
CREATE UNIQUE INDEX flash_sale_reservations_token_idx ON flash_sale_reservations (reservation_token);
CREATE UNIQUE INDEX flash_sale_reservations_idempotency_idx ON flash_sale_reservations (idempotency_key);
CREATE INDEX flash_sale_reservations_item_customer_idx ON flash_sale_reservations (flash_sale_item_id, customer_identity_hash, status);
CREATE INDEX flash_sale_reservations_expiry_idx ON flash_sale_reservations (status, expires_at);
