CREATE TABLE IF NOT EXISTS survey_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key varchar(80) NOT NULL, status varchar(30) NOT NULL DEFAULT 'DRAFT', version integer NOT NULL DEFAULT 1, current_version_id uuid NOT NULL, created_by uuid NOT NULL, approved_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT survey_definitions_status_chk CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','ACTIVE','PAUSED','CLOSED','REJECTED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS survey_definitions_key_idx ON survey_definitions(key);
CREATE INDEX IF NOT EXISTS survey_definitions_status_idx ON survey_definitions(status, updated_at);

CREATE TABLE IF NOT EXISTS survey_versions (
  id uuid PRIMARY KEY, definition_id uuid NOT NULL REFERENCES survey_definitions(id), version_number integer NOT NULL, title varchar(160) NOT NULL, description text NOT NULL, purpose_key varchar(100) NOT NULL, questions jsonb NOT NULL, audience jsonb NOT NULL, content_digest varchar(64) NOT NULL, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT survey_versions_questions_array_chk CHECK (jsonb_typeof(questions) = 'array'), CONSTRAINT survey_versions_audience_object_chk CHECK (jsonb_typeof(audience) = 'object')
);
CREATE UNIQUE INDEX IF NOT EXISTS survey_versions_definition_version_idx ON survey_versions(definition_id, version_number);
CREATE UNIQUE INDEX IF NOT EXISTS survey_versions_digest_idx ON survey_versions(definition_id, content_digest);
CREATE TABLE IF NOT EXISTS survey_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), definition_id uuid NOT NULL REFERENCES survey_definitions(id), version_id uuid NOT NULL REFERENCES survey_versions(id), participant_ref_hash varchar(64) NOT NULL, consent_evidence jsonb NOT NULL, answers jsonb NOT NULL DEFAULT '{}'::jsonb, status varchar(20) NOT NULL DEFAULT 'IN_PROGRESS', version integer NOT NULL DEFAULT 1, started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  CONSTRAINT survey_responses_status_chk CHECK (status IN ('IN_PROGRESS','COMPLETED')), CONSTRAINT survey_responses_consent_object_chk CHECK (jsonb_typeof(consent_evidence) = 'object'), CONSTRAINT survey_responses_answers_object_chk CHECK (jsonb_typeof(answers) = 'object')
);
CREATE UNIQUE INDEX IF NOT EXISTS survey_responses_definition_participant_idx ON survey_responses(definition_id, participant_ref_hash);
CREATE INDEX IF NOT EXISTS survey_responses_status_idx ON survey_responses(definition_id, status);

CREATE TABLE IF NOT EXISTS survey_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), definition_id uuid NOT NULL REFERENCES survey_definitions(id), action varchar(40) NOT NULL, actor_id uuid NOT NULL, reason text NOT NULL, evidence jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT survey_events_evidence_object_chk CHECK (jsonb_typeof(evidence) = 'object')
);
CREATE INDEX IF NOT EXISTS survey_events_definition_idx ON survey_events(definition_id, created_at);
