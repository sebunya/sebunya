-- U4 §15 — creator platform: CRM, attribution, commission, payout.
--
-- WHY
-- Built for Uganda: MoMo/Airtel payouts, withholding tax, COD-gated commission.
-- Identity is peppered hashes only; raw phone/email/address are never persisted
-- in fraud evidence. Creator coupon codes extend U1's coupon_codes. Mobile-money
-- disbursement is a NO-SEND port; withholding rates are effective-dated config.
--
-- LOCK RISK: additive (new tables + indexes). Safe online.

CREATE TABLE creators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle varchar(80) NOT NULL,
  legal_name varchar(160),
  phone_hash varchar(64),
  email_hash varchar(64),
  whatsapp_number_hash varchar(64),
  primary_platform varchar(40),
  tier varchar(12),
  niche_tags text[] NOT NULL DEFAULT '{}',
  languages text[] NOT NULL DEFAULT '{}',
  location_district varchar(80),
  status varchar(16) NOT NULL DEFAULT 'prospect',
  owner_admin_id uuid,
  source varchar(80),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT creators_status_chk CHECK (status IN ('prospect','contacted','negotiating','active','paused','blocked'))
);
CREATE UNIQUE INDEX creators_handle_idx ON creators (handle);
CREATE INDEX creators_phone_hash_idx ON creators (phone_hash);
CREATE INDEX creators_status_idx ON creators (status);

CREATE TABLE creator_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id),
  campaign_id uuid,
  contract_type varchar(20) NOT NULL,
  flat_fee_ugx bigint,
  commission_rate_bps integer,
  commission_cap_ugx bigint,
  usage_rights_scope varchar(16),
  usage_rights_expiry date,
  start_date date,
  end_date date,
  status varchar(16) NOT NULL DEFAULT 'draft',
  signed_at timestamptz,
  document_url varchar(500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX creator_contracts_creator_idx ON creator_contracts (creator_id, status);

CREATE TABLE creator_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id),
  campaign_id uuid,
  short_code varchar(20) NOT NULL,
  destination_url varchar(500) NOT NULL,
  utm_params jsonb NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX creator_links_short_code_idx ON creator_links (short_code);

CREATE TABLE creator_link_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES creator_links(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  ip_hash varchar(64),
  user_agent_hash varchar(64),
  referrer varchar(300),
  country varchar(2),
  device_type varchar(20),
  anonymous_id varchar(80),
  is_suspected_bot boolean NOT NULL DEFAULT false
);
CREATE INDEX creator_link_clicks_link_occurred_idx ON creator_link_clicks (link_id, occurred_at);

CREATE TABLE creator_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  creator_id uuid NOT NULL REFERENCES creators(id),
  mechanism varchar(8) NOT NULL,
  confidence varchar(8) NOT NULL,
  attributed_revenue_ugx bigint NOT NULL DEFAULT 0,
  is_primary boolean NOT NULL DEFAULT false,
  attributed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT creator_attributions_mechanism_chk CHECK (mechanism IN ('code','link','survey')),
  CONSTRAINT creator_attributions_confidence_chk CHECK (confidence IN ('high','medium','low'))
);
CREATE INDEX creator_attributions_creator_idx ON creator_attributions (creator_id, attributed_at);
CREATE UNIQUE INDEX creator_attributions_order_creator_mech_idx ON creator_attributions (order_id, creator_id, mechanism);
-- Exactly one PRIMARY attribution per order (no double-counted revenue).
CREATE UNIQUE INDEX creator_attributions_order_primary_idx ON creator_attributions (order_id) WHERE is_primary;

CREATE TABLE creator_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  contract_id uuid REFERENCES creator_contracts(id),
  gross_revenue_ugx bigint NOT NULL,
  commissionable_revenue_ugx bigint NOT NULL,
  commission_rate_bps integer NOT NULL,
  commission_amount_ugx bigint NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'pending',
  hold_until timestamptz,
  reversed_reason varchar(160),
  payout_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT creator_commissions_status_chk CHECK (status IN ('pending','approved','held','reversed','paid'))
);
-- One commission per (order, creator).
CREATE UNIQUE INDEX creator_commissions_order_creator_idx ON creator_commissions (order_id, creator_id);
CREATE INDEX creator_commissions_status_idx ON creator_commissions (status, hold_until);

CREATE TABLE creator_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  gross_amount_ugx bigint NOT NULL,
  withholding_tax_ugx bigint NOT NULL,
  net_amount_ugx bigint NOT NULL,
  withholding_rate_bps integer NOT NULL,
  method varchar(16),
  destination_masked varchar(40),
  status varchar(12) NOT NULL DEFAULT 'draft',
  created_by uuid NOT NULL,
  approved_by uuid,
  idempotency_key varchar(120) NOT NULL,
  initiated_at timestamptz,
  settled_at timestamptz,
  provider_reference varchar(160),
  failure_reason varchar(200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT creator_payouts_status_chk CHECK (status IN ('draft','approved','processing','settled','failed','cancelled')),
  -- Maker/checker: the approver must differ from the creator of the payout run.
  CONSTRAINT creator_payouts_maker_checker_chk CHECK (approved_by IS NULL OR approved_by <> created_by),
  -- gross - withholding = net, always.
  CONSTRAINT creator_payouts_net_chk CHECK (net_amount_ugx = gross_amount_ugx - withholding_tax_ugx)
);
CREATE UNIQUE INDEX creator_payouts_idempotency_idx ON creator_payouts (idempotency_key);
CREATE INDEX creator_payouts_creator_period_idx ON creator_payouts (creator_id, period_start);

CREATE TABLE creator_content_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id),
  deliverable_id uuid,
  asset_type varchar(24) NOT NULL,
  storage_url varchar(500) NOT NULL,
  thumbnail_url varchar(500),
  platform_published_url varchar(500),
  rights_scope varchar(16),
  rights_expiry date,
  approved_for_ads boolean NOT NULL DEFAULT false,
  performance_metrics jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX creator_content_assets_creator_idx ON creator_content_assets (creator_id);
