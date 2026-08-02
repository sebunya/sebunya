-- Commerce Analytics: saved views and alert rules.
--
-- WHY THESE TWO TABLES
-- The analytics surface so far is stateless: every operator re-enters the same
-- period and filters on every visit, and there is no way to say "tell me when
-- payment failure crosses 20%" without a human watching the page. Both are
-- operator configuration, so both are persisted, owned and audited rather than
-- kept in local storage where nobody can govern them.
--
-- OWNERSHIP IS A REAL COLUMN, NOT A CONVENTION
-- `owner_id` records the admin who created the row. A PRIVATE view is readable
-- only by its owner; a SHARED view is readable by anyone holding analytics.read.
-- The scope is stored explicitly rather than inferred, because "shared" is a
-- deliberate decision an operator makes and an auditor must be able to see.
--
-- ALERT RULES DO NOT DELIVER ANYTHING
-- A rule stores a metric, comparison, threshold, minimum sample, window and
-- severity. Evaluation produces an internal analytics action only. There is
-- deliberately no destination, channel, recipient or provider column: this
-- table cannot be turned into an outbound message path by configuration alone,
-- and adding one would require a new migration and a new review.
--
-- MINIMUM SAMPLE IS MANDATORY, NOT OPTIONAL
-- `minimum_sample` is NOT NULL with a positive CHECK so a rule cannot be
-- created that fires on one low-volume event because a percentage looked
-- extreme. The same floor the catalogue applies to displayed rates applies to
-- anything that can raise an alert.
--
-- METRIC KEYS ARE VALIDATED IN THE APPLICATION, NOT BY A DATABASE ENUM
-- The canonical catalogue lives in packages/shared/src/analytics. A Postgres
-- enum would duplicate it and drift; the use case rejects unknown keys against
-- the catalogue and the tests prove it.

CREATE TABLE IF NOT EXISTS analytics_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name varchar(120) NOT NULL,
  description varchar(500),
  -- PRIVATE: owner only. SHARED: any holder of analytics.read.
  scope varchar(16) NOT NULL DEFAULT 'PRIVATE',
  -- Window definition. Either a rolling day count or an explicit day pair;
  -- both are stored so the operator's intent survives, and the resolver
  -- prefers explicit days when present.
  period_days integer,
  start_day varchar(10),
  end_day varchar(10),
  -- Catalogue metric keys the view shows, in display order.
  metric_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analytics_saved_views_scope_check
    CHECK (scope IN ('PRIVATE', 'SHARED')),
  CONSTRAINT analytics_saved_views_period_check
    CHECK (period_days IS NULL OR (period_days >= 1 AND period_days <= 366)),
  -- A view must define its window one way or the other, never neither.
  CONSTRAINT analytics_saved_views_window_check
    CHECK (period_days IS NOT NULL OR (start_day IS NOT NULL AND end_day IS NOT NULL))
);

-- One operator cannot own two views with the same name: renaming is how you
-- replace one, and silent duplicates make "open my saved view" ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS analytics_saved_views_owner_name_idx
  ON analytics_saved_views (owner_id, lower(name));
CREATE INDEX IF NOT EXISTS analytics_saved_views_scope_idx
  ON analytics_saved_views (scope);

CREATE TABLE IF NOT EXISTS analytics_alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name varchar(120) NOT NULL,
  metric_key varchar(80) NOT NULL,
  comparison varchar(16) NOT NULL,
  threshold double precision NOT NULL,
  minimum_sample integer NOT NULL,
  evaluation_days integer NOT NULL DEFAULT 7,
  severity varchar(16) NOT NULL DEFAULT 'MEDIUM',
  enabled boolean NOT NULL DEFAULT true,
  -- Suppresses re-firing for this many minutes after a fire, so one sustained
  -- condition produces one action rather than one per evaluation.
  cooldown_minutes integer NOT NULL DEFAULT 720,
  last_evaluated_at timestamptz,
  last_fired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analytics_alert_rules_comparison_check
    CHECK (comparison IN ('ABOVE', 'BELOW')),
  CONSTRAINT analytics_alert_rules_minimum_sample_check
    CHECK (minimum_sample >= 1),
  CONSTRAINT analytics_alert_rules_evaluation_days_check
    CHECK (evaluation_days >= 1 AND evaluation_days <= 366),
  CONSTRAINT analytics_alert_rules_cooldown_check
    CHECK (cooldown_minutes >= 0),
  CONSTRAINT analytics_alert_rules_severity_check
    CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW'))
);

CREATE UNIQUE INDEX IF NOT EXISTS analytics_alert_rules_owner_name_idx
  ON analytics_alert_rules (owner_id, lower(name));
-- The evaluation sweep reads enabled rules only.
CREATE INDEX IF NOT EXISTS analytics_alert_rules_enabled_idx
  ON analytics_alert_rules (enabled, metric_key);
