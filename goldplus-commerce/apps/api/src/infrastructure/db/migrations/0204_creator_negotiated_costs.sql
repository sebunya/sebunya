-- 0204 (2026-10-23): creator costs agreed outside a contract record.
-- The derived marketing costs (0203) count creator commissions and contract flat fees. The owner pays some
-- creators per negotiation (a one-off post, a month of stories, a product sent as payment) with no contract row;
-- those were invisible to the channel report and the marketing mix dataset. One row per agreement: an amount in
-- shillings spread evenly over its days. Rows are never deleted, only ended (deleted_at), so a cost that was once
-- in a report can be explained later.
-- Rollback: DROP TABLE IF EXISTS creator_negotiated_costs;
CREATE TABLE IF NOT EXISTS creator_negotiated_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  creator_id uuid NOT NULL REFERENCES creators(id),
  label varchar(120) NOT NULL,
  amount_ugx bigint NOT NULL CHECK (amount_ugx > 0),
  start_date date NOT NULL,
  end_date date NOT NULL CHECK (end_date >= start_date),
  note varchar(300),
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  deleted_by uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS creator_negotiated_costs_span_idx ON creator_negotiated_costs (start_date, end_date) WHERE deleted_at IS NULL;
