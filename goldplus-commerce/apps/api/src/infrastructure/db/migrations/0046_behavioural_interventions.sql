CREATE TABLE IF NOT EXISTS behavioural_intervention_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key varchar(80) NOT NULL, status varchar(30) NOT NULL DEFAULT 'DRAFT', version integer NOT NULL DEFAULT 1, current_version_id uuid NOT NULL, created_by uuid NOT NULL, approved_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT behavioural_intervention_definitions_status_chk CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','ACTIVE','PAUSED','COMPLETED','REJECTED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS behavioural_intervention_definitions_key_idx ON behavioural_intervention_definitions(key);
CREATE INDEX IF NOT EXISTS behavioural_intervention_definitions_status_idx ON behavioural_intervention_definitions(status, updated_at);

CREATE TABLE IF NOT EXISTS behavioural_intervention_versions (
  id uuid PRIMARY KEY, definition_id uuid NOT NULL REFERENCES behavioural_intervention_definitions(id), version_number integer NOT NULL, name varchar(160) NOT NULL, target_behaviour varchar(40) NOT NULL, hypothesis text NOT NULL, primary_metric varchar(120) NOT NULL, audience jsonb NOT NULL, channel varchar(20) NOT NULL, placement varchar(40) NOT NULL, content jsonb NOT NULL, suppression jsonb NOT NULL, experiment_id uuid NOT NULL REFERENCES experiments(id), experiment_variant_key varchar(40) NOT NULL, content_digest varchar(64) NOT NULL, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT behavioural_intervention_versions_target_chk CHECK (target_behaviour IN ('PRODUCT_DISCOVERY','CHECKOUT_COMPLETION','PRODUCT_EDUCATION','FEEDBACK_COMPLETION')),
  CONSTRAINT behavioural_intervention_versions_channel_chk CHECK (channel = 'ON_SITE'),
  CONSTRAINT behavioural_intervention_versions_audience_object_chk CHECK (jsonb_typeof(audience) = 'object'),
  CONSTRAINT behavioural_intervention_versions_content_object_chk CHECK (jsonb_typeof(content) = 'object'),
  CONSTRAINT behavioural_intervention_versions_suppression_object_chk CHECK (jsonb_typeof(suppression) = 'object')
);
CREATE UNIQUE INDEX IF NOT EXISTS behavioural_intervention_versions_definition_version_idx ON behavioural_intervention_versions(definition_id, version_number);
CREATE UNIQUE INDEX IF NOT EXISTS behavioural_intervention_versions_digest_idx ON behavioural_intervention_versions(definition_id, content_digest);
CREATE INDEX IF NOT EXISTS behavioural_intervention_versions_experiment_idx ON behavioural_intervention_versions(experiment_id);

CREATE TABLE IF NOT EXISTS behavioural_intervention_exposures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), definition_id uuid NOT NULL REFERENCES behavioural_intervention_definitions(id), version_id uuid NOT NULL REFERENCES behavioural_intervention_versions(id), experiment_id uuid NOT NULL REFERENCES experiments(id), participant_ref_hash varchar(64) NOT NULL, delivery_key varchar(160) NOT NULL, eligibility_evidence jsonb NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT behavioural_intervention_exposures_evidence_object_chk CHECK (jsonb_typeof(eligibility_evidence) = 'object')
);
CREATE UNIQUE INDEX IF NOT EXISTS behavioural_intervention_exposures_delivery_idx ON behavioural_intervention_exposures(definition_id, delivery_key);
CREATE INDEX IF NOT EXISTS behavioural_intervention_exposures_participant_idx ON behavioural_intervention_exposures(definition_id, participant_ref_hash, occurred_at);

CREATE TABLE IF NOT EXISTS behavioural_intervention_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), exposure_id uuid NOT NULL REFERENCES behavioural_intervention_exposures(id), definition_id uuid NOT NULL REFERENCES behavioural_intervention_definitions(id), participant_ref_hash varchar(64) NOT NULL, outcome_key varchar(160) NOT NULL, outcome varchar(30) NOT NULL, source varchar(30) NOT NULL, evidence jsonb NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT behavioural_intervention_outcomes_outcome_chk CHECK (outcome IN ('ENGAGED','DISMISSED','TARGET_ACHIEVED')),
  CONSTRAINT behavioural_intervention_outcomes_source_chk CHECK (source IN ('CUSTOMER_ACTION','SERVER_MEASUREMENT')),
  CONSTRAINT behavioural_intervention_outcomes_evidence_object_chk CHECK (jsonb_typeof(evidence) = 'object')
);
CREATE UNIQUE INDEX IF NOT EXISTS behavioural_intervention_outcomes_key_idx ON behavioural_intervention_outcomes(definition_id, outcome_key);
CREATE INDEX IF NOT EXISTS behavioural_intervention_outcomes_exposure_idx ON behavioural_intervention_outcomes(exposure_id, occurred_at);

CREATE TABLE IF NOT EXISTS behavioural_intervention_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), definition_id uuid NOT NULL REFERENCES behavioural_intervention_definitions(id), action varchar(40) NOT NULL, actor_id uuid NOT NULL, reason text NOT NULL, evidence jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT behavioural_intervention_events_evidence_object_chk CHECK (jsonb_typeof(evidence) = 'object')
);
CREATE INDEX IF NOT EXISTS behavioural_intervention_events_definition_idx ON behavioural_intervention_events(definition_id, created_at);
