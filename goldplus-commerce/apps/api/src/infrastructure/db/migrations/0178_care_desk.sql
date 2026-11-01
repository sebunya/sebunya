-- 0178: the Care Desk (owner, 2026-10-13: shop attendants and the care team on top of every customer
-- issue without anything technical; Goldie escalates by SMS, email and WhatsApp when stuck and urgent).
--
-- care_tasks: what a person must do (call back, follow up, approve an order change, a bulk lead, an
-- urgent customer). Opened by Goldie or by staff, closed by staff. care_team_members: who gets alerts,
-- on which channels, and when they are on duty. Conversations gain the customer's rating and the
-- next-best action Goldie was given.
--
-- Additive and reversible. Rollback:
--   DROP TABLE IF EXISTS care_tasks; DROP TABLE IF EXISTS care_team_members;
--   ALTER TABLE assistant_conversations DROP COLUMN IF EXISTS csat, DROP COLUMN IF EXISTS csat_comment, DROP COLUMN IF EXISTS next_action;

CREATE TABLE IF NOT EXISTS care_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind varchar(20) NOT NULL,
  priority varchar(10) DEFAULT 'normal' NOT NULL,
  status varchar(12) DEFAULT 'open' NOT NULL,
  title varchar(200) NOT NULL,
  detail text,
  customer_name varchar(120),
  customer_phone varchar(32),
  customer_email varchar(200),
  order_number varchar(40),
  conversation_id uuid REFERENCES assistant_conversations(id) ON DELETE SET NULL,
  channel varchar(20),
  -- An order change Goldie prepared for a person to carry out: { type, orderNumber, details }.
  proposed_action jsonb,
  due_at timestamptz,
  assigned_to uuid,
  opened_by varchar(40) DEFAULT 'goldie' NOT NULL,
  resolved_by uuid,
  resolution text,
  alerted_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS care_tasks_open_idx ON care_tasks (status, priority, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS care_tasks_conversation_idx ON care_tasks (conversation_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS care_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(80) NOT NULL,
  role_label varchar(60),
  phone varchar(32),
  email varchar(200),
  alert_sms boolean DEFAULT true NOT NULL,
  alert_email boolean DEFAULT true NOT NULL,
  alert_whatsapp boolean DEFAULT false NOT NULL,
  -- Kampala time, e.g. { "days": [1,2,3,4,5,6], "from": "08:00", "to": "19:00" }; null = always on duty.
  on_duty jsonb,
  active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE assistant_conversations ADD COLUMN IF NOT EXISTS csat smallint;
--> statement-breakpoint
ALTER TABLE assistant_conversations ADD COLUMN IF NOT EXISTS csat_comment text;
--> statement-breakpoint
ALTER TABLE assistant_conversations ADD COLUMN IF NOT EXISTS next_action varchar(40);
