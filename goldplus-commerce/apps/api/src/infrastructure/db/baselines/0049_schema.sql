--
-- PostgreSQL database dump
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: canonical_consent_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.canonical_consent_state AS ENUM (
    'unknown',
    'not_requested',
    'requested_support_assisted',
    'pending_verification',
    'granted',
    'withdrawn',
    'expired',
    'superseded',
    'blocked_by_policy',
    'service_only'
);


--
-- Name: consent_actor_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.consent_actor_type AS ENUM (
    'customer',
    'support_operator',
    'admin',
    'provider_callback',
    'system_policy',
    'migration_dry_run',
    'test_fixture'
);


--
-- Name: consent_identity_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.consent_identity_level AS ENUM (
    'anonymous',
    'checkout_contact_only',
    'support_verified_contact',
    'verified_account',
    'provider_callback_verified',
    'admin_operator_confirmed'
);


--
-- Name: consent_legacy_mapping_outcome; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.consent_legacy_mapping_outcome AS ENUM (
    'unknown',
    'requested_support_assisted',
    'not_applicable'
);


--
-- Name: reject_consent_audit_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_consent_audit_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'consent audit records are append-only';
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.addresses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    label character varying(50) NOT NULL,
    recipient_name character varying(100) NOT NULL,
    phone character varying(20) NOT NULL,
    district character varying(100) NOT NULL,
    area_details text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: attributes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attributes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category_id uuid NOT NULL,
    slug character varying(60) NOT NULL,
    name character varying(100) NOT NULL,
    unit character varying(20),
    is_required boolean DEFAULT false NOT NULL,
    display_order integer DEFAULT 0 NOT NULL
);


--
-- Name: attribution_touchpoints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attribution_touchpoints (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fp_client_id character varying(255),
    user_id uuid,
    order_id uuid,
    event_id character varying(255) NOT NULL,
    event_name character varying(100) NOT NULL,
    has_hashed_email integer DEFAULT 0 NOT NULL,
    has_hashed_phone integer DEFAULT 0 NOT NULL,
    has_fbp integer DEFAULT 0 NOT NULL,
    has_fbc integer DEFAULT 0 NOT NULL,
    has_gclid integer DEFAULT 0 NOT NULL,
    has_ttclid integer DEFAULT 0 NOT NULL,
    has_li_fat_id integer DEFAULT 0 NOT NULL,
    has_ip_address integer DEFAULT 0 NOT NULL,
    has_user_agent integer DEFAULT 0 NOT NULL,
    match_score real DEFAULT 0 NOT NULL,
    routed_destinations jsonb,
    blocked_destinations jsonb,
    event_time timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id uuid,
    action character varying(100) NOT NULL,
    entity character varying(50) NOT NULL,
    entity_id uuid NOT NULL,
    previous_state jsonb,
    new_state jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: automation_action_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_action_executions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    execution_id uuid NOT NULL,
    action_index integer NOT NULL,
    action_family character varying(32) NOT NULL,
    idempotency_key character varying(260) NOT NULL,
    status character varying(20) DEFAULT 'PLANNED'::character varying NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_retry_at timestamp with time zone,
    last_error text,
    outbox_event_id uuid,
    dead_lettered_at timestamp with time zone,
    replayed_at timestamp with time zone,
    replay_actor uuid,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: automation_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    definition_id uuid NOT NULL,
    version_id uuid NOT NULL,
    status character varying(16) DEFAULT 'PENDING'::character varying NOT NULL,
    approver_id uuid,
    decided_at timestamp with time zone,
    expires_at timestamp with time zone,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: automation_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(160) NOT NULL,
    description text,
    status character varying(24) DEFAULT 'DRAFT'::character varying NOT NULL,
    current_version integer DEFAULT 0 NOT NULL,
    next_run_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: automation_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    definition_id uuid,
    version_id uuid,
    execution_id uuid,
    event_type character varying(40) NOT NULL,
    actor_id uuid,
    from_state character varying(24),
    to_state character varying(24),
    reason text,
    correlation_id character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: automation_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_executions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    definition_id uuid NOT NULL,
    version_id uuid NOT NULL,
    version_number integer NOT NULL,
    trigger_execution_key character varying(240) NOT NULL,
    trigger_family character varying(32) NOT NULL,
    trigger_event_id character varying(128),
    subject_id character varying(128),
    window_key character varying(40) NOT NULL,
    status character varying(20) DEFAULT 'PLANNED'::character varying NOT NULL,
    planned_count integer DEFAULT 0 NOT NULL,
    ineligible_count integer DEFAULT 0 NOT NULL,
    evidence jsonb,
    lease_owner character varying(64),
    lease_expires_at timestamp with time zone,
    attempt integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone,
    error text,
    planned_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: automation_frequency_cap_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_frequency_cap_reservations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    execution_id uuid NOT NULL,
    definition_id uuid NOT NULL,
    version_id uuid NOT NULL,
    subject_scope character varying(140) NOT NULL,
    window_key character varying(40) NOT NULL,
    limit_snapshot integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: automation_suppressions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_suppressions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    execution_id uuid NOT NULL,
    action_execution_id uuid,
    subject_id character varying(128),
    reason character varying(40) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: automation_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    definition_id uuid NOT NULL,
    version_number integer NOT NULL,
    config jsonb NOT NULL,
    requires_approval boolean DEFAULT false NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: behavioural_intervention_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.behavioural_intervention_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key character varying(80) NOT NULL,
    status character varying(30) DEFAULT 'DRAFT'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    current_version_id uuid NOT NULL,
    created_by uuid NOT NULL,
    approved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT behavioural_intervention_definitions_status_chk CHECK (((status)::text = ANY ((ARRAY['DRAFT'::character varying, 'PENDING_APPROVAL'::character varying, 'APPROVED'::character varying, 'ACTIVE'::character varying, 'PAUSED'::character varying, 'COMPLETED'::character varying, 'REJECTED'::character varying])::text[])))
);


--
-- Name: behavioural_intervention_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.behavioural_intervention_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    definition_id uuid NOT NULL,
    action character varying(40) NOT NULL,
    actor_id uuid NOT NULL,
    reason text NOT NULL,
    evidence jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT behavioural_intervention_events_evidence_object_chk CHECK ((jsonb_typeof(evidence) = 'object'::text))
);


--
-- Name: behavioural_intervention_exposures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.behavioural_intervention_exposures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    definition_id uuid NOT NULL,
    version_id uuid NOT NULL,
    experiment_id uuid NOT NULL,
    participant_ref_hash character varying(64) NOT NULL,
    delivery_key character varying(160) NOT NULL,
    eligibility_evidence jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT behavioural_intervention_exposures_evidence_object_chk CHECK ((jsonb_typeof(eligibility_evidence) = 'object'::text))
);


--
-- Name: behavioural_intervention_outcomes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.behavioural_intervention_outcomes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    exposure_id uuid NOT NULL,
    definition_id uuid NOT NULL,
    participant_ref_hash character varying(64) NOT NULL,
    outcome_key character varying(160) NOT NULL,
    outcome character varying(30) NOT NULL,
    source character varying(30) NOT NULL,
    evidence jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT behavioural_intervention_outcomes_evidence_object_chk CHECK ((jsonb_typeof(evidence) = 'object'::text)),
    CONSTRAINT behavioural_intervention_outcomes_outcome_chk CHECK (((outcome)::text = ANY ((ARRAY['ENGAGED'::character varying, 'DISMISSED'::character varying, 'TARGET_ACHIEVED'::character varying])::text[]))),
    CONSTRAINT behavioural_intervention_outcomes_source_chk CHECK (((source)::text = ANY ((ARRAY['CUSTOMER_ACTION'::character varying, 'SERVER_MEASUREMENT'::character varying])::text[])))
);


--
-- Name: behavioural_intervention_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.behavioural_intervention_versions (
    id uuid NOT NULL,
    definition_id uuid NOT NULL,
    version_number integer NOT NULL,
    name character varying(160) NOT NULL,
    target_behaviour character varying(40) NOT NULL,
    hypothesis text NOT NULL,
    primary_metric character varying(120) NOT NULL,
    audience jsonb NOT NULL,
    channel character varying(20) NOT NULL,
    placement character varying(40) NOT NULL,
    content jsonb NOT NULL,
    suppression jsonb NOT NULL,
    experiment_id uuid NOT NULL,
    experiment_variant_key character varying(40) NOT NULL,
    content_digest character varying(64) NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT behavioural_intervention_versions_audience_object_chk CHECK ((jsonb_typeof(audience) = 'object'::text)),
    CONSTRAINT behavioural_intervention_versions_channel_chk CHECK (((channel)::text = 'ON_SITE'::text)),
    CONSTRAINT behavioural_intervention_versions_content_object_chk CHECK ((jsonb_typeof(content) = 'object'::text)),
    CONSTRAINT behavioural_intervention_versions_suppression_object_chk CHECK ((jsonb_typeof(suppression) = 'object'::text)),
    CONSTRAINT behavioural_intervention_versions_target_chk CHECK (((target_behaviour)::text = ANY ((ARRAY['PRODUCT_DISCOVERY'::character varying, 'CHECKOUT_COMPLETION'::character varying, 'PRODUCT_EDUCATION'::character varying, 'FEEDBACK_COMPLETION'::character varying])::text[])))
);


--
-- Name: campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    objective character varying(50) NOT NULL,
    channel character varying(50) NOT NULL,
    status character varying(30) DEFAULT 'DRAFT'::character varying NOT NULL,
    readiness_score integer DEFAULT 0 NOT NULL,
    target_url character varying(500)
);


--
-- Name: cart_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cart_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cart_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity integer NOT NULL
);


--
-- Name: carts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.carts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    session_id character varying(255),
    anonymous_id character varying(160)
);


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    slug character varying(255) NOT NULL,
    is_other boolean DEFAULT false NOT NULL
);


--
-- Name: channel_suppressions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.channel_suppressions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_identity_ref character varying(255),
    endpoint_ref character varying(255) NOT NULL,
    channel_key character varying(50) NOT NULL,
    purpose_key character varying(100),
    scope character varying(50) NOT NULL,
    reason text NOT NULL,
    source_surface character varying(100) NOT NULL,
    provider_callback_ref character varying(255),
    suppression_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    effective_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone,
    superseded_by uuid
);


--
-- Name: consent_channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consent_channels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel_key character varying(50) NOT NULL,
    policy_version character varying(50) NOT NULL,
    verification_requirement character varying(80) NOT NULL,
    suppression_scope character varying(50) NOT NULL,
    owner character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    effective_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone,
    superseded_by uuid
);


--
-- Name: consent_copy_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consent_copy_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    copy_version_id character varying(100) NOT NULL,
    purpose_key character varying(100) NOT NULL,
    channel_key character varying(50) NOT NULL,
    locale character varying(20) NOT NULL,
    content_hash character varying(64) NOT NULL,
    policy_version character varying(50) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    effective_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone,
    superseded_by uuid
);


--
-- Name: consent_current_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consent_current_state (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fp_client_id character varying(255),
    user_id uuid,
    analytics_granted boolean DEFAULT false NOT NULL,
    advertising_granted boolean DEFAULT false NOT NULL,
    personalization_granted boolean DEFAULT false NOT NULL,
    last_grant_type character varying(30) DEFAULT 'unknown'::character varying NOT NULL,
    last_notice_version character varying(20) DEFAULT 'v1.0'::character varying NOT NULL,
    last_consent_record_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone
);


--
-- Name: consent_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consent_events (
    consent_event_id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type character varying(100) NOT NULL,
    customer_identity_ref character varying(255) NOT NULL,
    endpoint_ref character varying(255),
    purpose_key character varying(100) NOT NULL,
    channel_key character varying(50) NOT NULL,
    state public.canonical_consent_state NOT NULL,
    source_surface character varying(100) NOT NULL,
    actor_type public.consent_actor_type NOT NULL,
    actor_id character varying(255),
    copy_version_id character varying(100),
    previous_state public.canonical_consent_state,
    new_state public.canonical_consent_state NOT NULL,
    reason text NOT NULL,
    provider_callback_ref character varying(255),
    support_ticket_ref character varying(255),
    correlation_id character varying(255) NOT NULL,
    retention_policy character varying(100) NOT NULL,
    integrity_hash character varying(64),
    tamper_evidence_ref character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    effective_at timestamp with time zone NOT NULL,
    CONSTRAINT consent_events_tamper_evidence_chk CHECK (((integrity_hash IS NOT NULL) OR (tamper_evidence_ref IS NOT NULL)))
);


--
-- Name: consent_policy_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consent_policy_blocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_identity_ref character varying(255),
    cohort_ref character varying(255),
    purpose_key character varying(100),
    channel_key character varying(50),
    policy_block_reason text NOT NULL,
    policy_version character varying(50) NOT NULL,
    actor_type public.consent_actor_type NOT NULL,
    actor_id character varying(255),
    correlation_id character varying(255) NOT NULL,
    integrity_hash character varying(64),
    tamper_evidence_ref character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    effective_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone,
    superseded_by uuid,
    CONSTRAINT consent_policy_blocks_scope_chk CHECK (((customer_identity_ref IS NOT NULL) OR (cohort_ref IS NOT NULL))),
    CONSTRAINT consent_policy_blocks_tamper_evidence_chk CHECK (((integrity_hash IS NOT NULL) OR (tamper_evidence_ref IS NOT NULL)))
);


--
-- Name: consent_purposes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consent_purposes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purpose_key character varying(100) NOT NULL,
    policy_version character varying(50) NOT NULL,
    classification character varying(50) NOT NULL,
    owner character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    effective_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone,
    superseded_by uuid
);


--
-- Name: consent_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consent_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fp_client_id character varying(255),
    user_id uuid,
    purposes jsonb NOT NULL,
    grant_type character varying(30) NOT NULL,
    capture_surface character varying(50) NOT NULL,
    notice_version character varying(20) NOT NULL,
    consent_language character varying(10) NOT NULL,
    ip_address character varying(64),
    user_agent text,
    is_withdrawal boolean DEFAULT false NOT NULL,
    withdrawn_purposes jsonb,
    captured_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: consent_source_surfaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consent_source_surfaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_surface character varying(100) NOT NULL,
    policy_version character varying(50) NOT NULL,
    actor_class character varying(50) NOT NULL,
    verification_floor public.consent_identity_level NOT NULL,
    authority_class character varying(50) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    effective_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone,
    superseded_by uuid
);


--
-- Name: controlled_activation_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.controlled_activation_approvals (
    id text NOT NULL,
    activation_request_id text NOT NULL,
    approver_admin_id text NOT NULL,
    approval_status text NOT NULL,
    approval_note text NOT NULL,
    approved_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: controlled_activation_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.controlled_activation_audit_log (
    id text NOT NULL,
    activation_request_id text NOT NULL,
    actor_admin_id text NOT NULL,
    action text NOT NULL,
    safe_payload text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: controlled_activation_canary_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.controlled_activation_canary_plans (
    id text NOT NULL,
    execution_plan_id text NOT NULL,
    scope_summary text NOT NULL,
    max_audience_size integer NOT NULL,
    percentage_cap integer NOT NULL,
    included_segments jsonb NOT NULL,
    excluded_segments jsonb NOT NULL,
    risk_level text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: controlled_activation_canary_runbooks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.controlled_activation_canary_runbooks (
    id character varying(36) NOT NULL,
    candidate_id character varying(36) NOT NULL,
    canary_scope_summary text NOT NULL,
    percentage_cap integer NOT NULL,
    max_audience_size integer NOT NULL,
    included_segments jsonb NOT NULL,
    excluded_segments jsonb NOT NULL,
    start_criteria text NOT NULL,
    pause_criteria text NOT NULL,
    rollback_criteria text NOT NULL,
    success_criteria text NOT NULL,
    failure_criteria text NOT NULL,
    monitoring_cadence text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: controlled_activation_destination_previews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.controlled_activation_destination_previews (
    id text NOT NULL,
    dry_run_id text NOT NULL,
    destination text NOT NULL,
    event_type text NOT NULL,
    consent_status text NOT NULL,
    routing_decision text NOT NULL,
    status text NOT NULL,
    redacted_payload jsonb,
    blocked_reason text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: controlled_activation_dry_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.controlled_activation_dry_runs (
    id text NOT NULL,
    execution_plan_id text NOT NULL,
    activation_request_id text NOT NULL,
    started_by_admin_id text NOT NULL,
    status text NOT NULL,
    started_at timestamp without time zone DEFAULT now() NOT NULL,
    completed_at timestamp without time zone,
    summary text,
    blocker_count integer DEFAULT 0 NOT NULL,
    warning_count integer DEFAULT 0 NOT NULL,
    redacted_evidence_ref text
);


--
-- Name: controlled_activation_evidence_packs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.controlled_activation_evidence_packs (
    id text NOT NULL,
    dry_run_id text NOT NULL,
    activation_request_id text NOT NULL,
    summary text NOT NULL,
    gate_summary text NOT NULL,
    payload_preview_summary text NOT NULL,
    consent_summary text NOT NULL,
    canary_summary text NOT NULL,
    rollback_summary text NOT NULL,
    monitoring_summary text NOT NULL,
    redacted_by text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: controlled_activation_execution_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.controlled_activation_execution_plans (
    id text NOT NULL,
    activation_request_id text NOT NULL,
    created_by_admin_id text NOT NULL,
    status text NOT NULL,
    activation_scope text NOT NULL,
    environment text NOT NULL,
    requested_window_start timestamp without time zone,
    requested_window_end timestamp without time zone,
    canary_scope_summary text,
    rollback_plan_summary text,
    monitoring_owner text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: controlled_activation_gate_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.controlled_activation_gate_results (
    gate_id text NOT NULL,
    activation_request_id text NOT NULL,
    category text NOT NULL,
    name text NOT NULL,
    status text NOT NULL,
    severity text NOT NULL,
    evidence_summary text NOT NULL,
    safe_reference_id text,
    checked_at timestamp without time zone NOT NULL,
    blocker_reason text,
    recommendation text
);


--
-- Name: controlled_activation_incident_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.controlled_activation_incident_plans (
    id character varying(36) NOT NULL,
    candidate_id character varying(36) NOT NULL,
    incident_owner character varying(255) NOT NULL,
    escalation_path text NOT NULL,
    rollback_owner character varying(255) NOT NULL,
    pause_criteria text NOT NULL,
    rollback_criteria text NOT NULL,
    communication_plan text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: controlled_activation_live_readiness_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.controlled_activation_live_readiness_checks (
    id character varying(36) NOT NULL,
    candidate_id character varying(36) NOT NULL,
    gate_id character varying(100) NOT NULL,
    status character varying(50) NOT NULL,
    severity character varying(20) NOT NULL,
    evidence_summary text NOT NULL,
    blocker_reason text,
    checked_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: controlled_activation_live_review_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.controlled_activation_live_review_candidates (
    id character varying(36) NOT NULL,
    activation_request_id character varying(36) NOT NULL,
    execution_plan_id character varying(36) NOT NULL,
    dry_run_id character varying(36) NOT NULL,
    evidence_pack_id character varying(36) NOT NULL,
    created_by_admin_id character varying(255) NOT NULL,
    status character varying(50) NOT NULL,
    environment character varying(50) NOT NULL,
    activation_window_start timestamp without time zone NOT NULL,
    activation_window_end timestamp without time zone NOT NULL,
    canary_scope_summary text NOT NULL,
    monitoring_owner character varying(255) NOT NULL,
    incident_owner character varying(255) NOT NULL,
    rollback_owner character varying(255) NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: controlled_activation_operator_checklists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.controlled_activation_operator_checklists (
    id character varying(36) NOT NULL,
    candidate_id character varying(36) NOT NULL,
    operator_admin_id character varying(255) NOT NULL,
    checklist_status character varying(50) NOT NULL,
    items jsonb NOT NULL,
    acknowledged_at timestamp without time zone
);


--
-- Name: controlled_activation_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.controlled_activation_requests (
    id text NOT NULL,
    requested_by_admin_id text NOT NULL,
    requested_at timestamp without time zone NOT NULL,
    activation_name text NOT NULL,
    activation_scope text NOT NULL,
    environment text NOT NULL,
    requested_window_start timestamp without time zone,
    requested_window_end timestamp without time zone,
    status text NOT NULL,
    reason text NOT NULL,
    canary_scope text,
    rollback_plan_summary text,
    monitoring_owner text,
    stakeholder_approver text,
    risk_level text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: controlled_activation_stakeholder_live_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.controlled_activation_stakeholder_live_approvals (
    id character varying(36) NOT NULL,
    candidate_id character varying(36) NOT NULL,
    approver_admin_id character varying(255) NOT NULL,
    approval_status character varying(50) NOT NULL,
    approval_note text NOT NULL,
    approved_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: controlled_live_canaries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.controlled_live_canaries (
    id text NOT NULL,
    dry_run_id text NOT NULL,
    activation_request_id text NOT NULL,
    status text NOT NULL,
    canary_cap integer NOT NULL,
    destination_allowlist jsonb NOT NULL,
    rollback_plan text NOT NULL,
    monitoring_owner text NOT NULL,
    rollback_reason text,
    rollback_owner text,
    started_at timestamp without time zone,
    completed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: controlled_live_canary_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.controlled_live_canary_audit_logs (
    id text NOT NULL,
    canary_id text NOT NULL,
    action text NOT NULL,
    actor_admin_id text NOT NULL,
    reason text,
    "timestamp" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: controlled_live_canary_delivery_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.controlled_live_canary_delivery_attempts (
    id text NOT NULL,
    canary_id text NOT NULL,
    destination text NOT NULL,
    status text NOT NULL,
    redacted_payload_summary text NOT NULL,
    redacted_response_summary text NOT NULL,
    attempted_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: controlled_live_canary_evidence_packs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.controlled_live_canary_evidence_packs (
    id text NOT NULL,
    canary_id text NOT NULL,
    eligibility_summary text NOT NULL,
    delivery_attempt_summary text NOT NULL,
    consent_summary text NOT NULL,
    destination_summary text NOT NULL,
    rollback_summary text NOT NULL,
    monitoring_summary text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_consent_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_consent_states (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_identity_ref character varying(255) NOT NULL,
    endpoint_ref character varying(255) NOT NULL,
    purpose_key character varying(100) NOT NULL,
    channel_key character varying(50) NOT NULL,
    identity_verification_level public.consent_identity_level NOT NULL,
    state public.canonical_consent_state DEFAULT 'unknown'::public.canonical_consent_state NOT NULL,
    source_surface character varying(100) NOT NULL,
    copy_version_id character varying(100),
    last_consent_event_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    effective_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone,
    superseded_by uuid,
    CONSTRAINT customer_consent_states_no_anonymous_grant_chk CHECK (((state <> 'granted'::public.canonical_consent_state) OR (identity_verification_level <> 'anonymous'::public.consent_identity_level))),
    CONSTRAINT customer_consent_states_no_checkout_marketing_grant_chk CHECK (((state <> 'granted'::public.canonical_consent_state) OR ((purpose_key)::text <> 'marketing_offers_campaigns'::text) OR (identity_verification_level <> 'checkout_contact_only'::public.consent_identity_level)))
);


--
-- Name: customer_feature_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_feature_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    canonical_customer_id uuid NOT NULL,
    source_version integer NOT NULL,
    features jsonb NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_identity_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_identity_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    canonical_customer_id uuid NOT NULL,
    signal_type character varying(40) NOT NULL,
    identifier_key character varying(128) NOT NULL,
    confidence character varying(16) NOT NULL,
    status character varying(16) DEFAULT 'ACTIVE'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_lifecycle_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_lifecycle_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    canonical_customer_id uuid NOT NULL,
    stage character varying(20) NOT NULL,
    policy_version integer NOT NULL,
    source_version integer NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_preferences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    channels jsonb NOT NULL,
    topics jsonb NOT NULL,
    interests jsonb NOT NULL,
    intent jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_profiles (
    canonical_customer_id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_version integer DEFAULT 1 NOT NULL,
    source_version integer DEFAULT 0 NOT NULL,
    account_user_id uuid,
    identity_confidence character varying(16) DEFAULT 'LOW'::character varying NOT NULL,
    first_seen timestamp with time zone,
    last_seen timestamp with time zone,
    primary_lifecycle_stage character varying(20) DEFAULT 'UNKNOWN'::character varying NOT NULL,
    value_flags jsonb DEFAULT '[]'::jsonb NOT NULL,
    risk_flags jsonb DEFAULT '[]'::jsonb NOT NULL,
    consent_eligible boolean,
    communication_preferences jsonb,
    stale_after_hours integer DEFAULT 24 NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dealer_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dealer_applications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_name character varying(255) NOT NULL,
    contact_name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    phone character varying(50) NOT NULL,
    tin_number character varying(50) NOT NULL,
    location character varying(512) NOT NULL,
    experience text,
    status character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    anonymous_id character varying(160),
    browser_id character varying(160),
    session_id character varying(160),
    attribution_id uuid
);


--
-- Name: decision_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.decision_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    insight_id uuid NOT NULL,
    assigned_to uuid,
    assigned_team character varying(64),
    assigned_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: decision_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.decision_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    insight_id uuid NOT NULL,
    event_type character varying(40) NOT NULL,
    actor_id uuid,
    from_status character varying(16),
    to_status character varying(16),
    reason text,
    correlation_id character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: decision_evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.decision_evidence (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    insight_id uuid NOT NULL,
    metric character varying(40) NOT NULL,
    baseline double precision NOT NULL,
    current_value double precision NOT NULL,
    delta double precision NOT NULL,
    current_window_days integer NOT NULL,
    comparison_window_days integer NOT NULL,
    sample_size integer NOT NULL,
    freshest_at timestamp with time zone,
    source_type character varying(48) NOT NULL,
    source_ref character varying(128) NOT NULL,
    source_version integer NOT NULL,
    policy_version integer NOT NULL,
    calculation_version integer NOT NULL,
    generated_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: decision_insights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.decision_insights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    idempotency_key character varying(240) NOT NULL,
    category character varying(20) NOT NULL,
    signal_type character varying(48) NOT NULL,
    subject character varying(120) NOT NULL,
    subject_ref character varying(128),
    window_key character varying(40) NOT NULL,
    severity character varying(12) NOT NULL,
    confidence character varying(24) NOT NULL,
    status character varying(16) DEFAULT 'OPEN'::character varying NOT NULL,
    recommendation character varying(40) NOT NULL,
    title character varying(200) NOT NULL,
    summary text NOT NULL,
    score double precision NOT NULL,
    current_value double precision NOT NULL,
    baseline_value double precision NOT NULL,
    delta double precision NOT NULL,
    sample_size integer NOT NULL,
    freshest_at timestamp with time zone,
    policy_version integer NOT NULL,
    calculation_version integer NOT NULL,
    source_version integer NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    assigned_to uuid,
    assigned_team character varying(64),
    resolution_code character varying(32),
    generated_at timestamp with time zone NOT NULL,
    acknowledged_at timestamp with time zone,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: decision_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.decision_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    signal_type character varying(48) NOT NULL,
    category character varying(20) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    config jsonb NOT NULL,
    policy_version integer NOT NULL,
    calculation_version integer NOT NULL,
    effective_date character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: decision_recommendations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.decision_recommendations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    insight_id uuid NOT NULL,
    recommendation_type character varying(40) NOT NULL,
    handoff_state character varying(24),
    detail jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: delivery_zones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_zones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    district character varying(100) NOT NULL,
    fee_ugx integer NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: experiment_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.experiment_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    experiment_id uuid NOT NULL,
    subject_hash character varying(64) NOT NULL,
    variant_key character varying(40) NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: experiment_exposures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.experiment_exposures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    assignment_id uuid NOT NULL,
    experiment_id uuid NOT NULL,
    exposure_key character varying(160) NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: experiment_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.experiment_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    experiment_id uuid NOT NULL,
    key character varying(40) NOT NULL,
    name character varying(120) NOT NULL,
    weight_basis_points integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT experiment_variant_weight_check CHECK (((weight_basis_points > 0) AND (weight_basis_points < 10000)))
);


--
-- Name: experiments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.experiments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key character varying(80) NOT NULL,
    name character varying(160) NOT NULL,
    hypothesis text NOT NULL,
    primary_metric character varying(120) NOT NULL,
    status character varying(20) DEFAULT 'DRAFT'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fake_product_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fake_product_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reporter_name character varying(255),
    reporter_contact character varying(255),
    location_found character varying(255) NOT NULL,
    product_description text NOT NULL,
    hologram_code character varying(100),
    evidence_urls jsonb DEFAULT '[]'::jsonb,
    status character varying(50) DEFAULT 'new'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: first_party_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.first_party_identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fp_client_id character varying(255),
    user_id uuid,
    gclid character varying(512),
    wbraid character varying(512),
    gbraid character varying(512),
    fbc character varying(512),
    fbp character varying(512),
    ttclid character varying(512),
    twclid character varying(512),
    li_fat_id character varying(512),
    epik character varying(512),
    hashed_email character varying(64),
    hashed_phone character varying(64),
    ip_address character varying(64),
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fraud_case_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fraud_case_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    case_id uuid NOT NULL,
    action character varying(40) NOT NULL,
    actor_id uuid,
    reason text NOT NULL,
    evidence jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fraud_case_events_action_check CHECK (((action)::text = ANY ((ARRAY['SIGNAL_RECORDED'::character varying, 'ASSIGNED'::character varying, 'REVIEWED'::character varying, 'ALLOWED'::character varying, 'HELD'::character varying, 'DECLINED'::character varying])::text[]))),
    CONSTRAINT fraud_case_events_evidence_check CHECK ((jsonb_typeof(evidence) = 'object'::text)),
    CONSTRAINT fraud_case_events_reason_check CHECK ((length(TRIM(BOTH FROM reason)) > 0))
);


--
-- Name: fraud_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fraud_cases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reference_key character varying(160) NOT NULL,
    source_type character varying(20) NOT NULL,
    source_ref character varying(160) NOT NULL,
    subject_ref_hash character varying(64),
    status character varying(20) DEFAULT 'OPEN'::character varying NOT NULL,
    priority character varying(20) DEFAULT 'LOW'::character varying NOT NULL,
    assigned_to uuid,
    version integer DEFAULT 1 NOT NULL,
    final_decision character varying(20),
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fraud_cases_decision_check CHECK (((final_decision IS NULL) OR ((final_decision)::text = ANY ((ARRAY['ALLOW'::character varying, 'HOLD'::character varying, 'DECLINE'::character varying])::text[])))),
    CONSTRAINT fraud_cases_priority_check CHECK (((priority)::text = ANY ((ARRAY['LOW'::character varying, 'MEDIUM'::character varying, 'HIGH'::character varying, 'CRITICAL'::character varying])::text[]))),
    CONSTRAINT fraud_cases_resolution_check CHECK (((((status)::text = 'RESOLVED'::text) AND (resolved_at IS NOT NULL) AND (final_decision IS NOT NULL)) OR (((status)::text <> 'RESOLVED'::text) AND (resolved_at IS NULL) AND (final_decision IS NULL)))),
    CONSTRAINT fraud_cases_source_type_check CHECK (((source_type)::text = ANY ((ARRAY['CHECKOUT'::character varying, 'ORDER'::character varying, 'PAYMENT'::character varying, 'IDENTITY'::character varying])::text[]))),
    CONSTRAINT fraud_cases_status_check CHECK (((status)::text = ANY ((ARRAY['OPEN'::character varying, 'IN_REVIEW'::character varying, 'RESOLVED'::character varying])::text[]))),
    CONSTRAINT fraud_cases_subject_hash_check CHECK (((subject_ref_hash IS NULL) OR ((subject_ref_hash)::text ~ '^[a-f0-9]{64}$'::text))),
    CONSTRAINT fraud_cases_version_check CHECK ((version > 0))
);


--
-- Name: fraud_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fraud_signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    case_id uuid NOT NULL,
    signal_key character varying(160) NOT NULL,
    signal_type character varying(80) NOT NULL,
    severity character varying(20) NOT NULL,
    reason_code character varying(80) NOT NULL,
    evidence jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fraud_signals_evidence_check CHECK ((jsonb_typeof(evidence) = 'object'::text)),
    CONSTRAINT fraud_signals_severity_check CHECK (((severity)::text = ANY ((ARRAY['LOW'::character varying, 'MEDIUM'::character varying, 'HIGH'::character varying, 'CRITICAL'::character varying])::text[])))
);


--
-- Name: fulfilment_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fulfilment_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fulfilment_task_id uuid NOT NULL,
    order_id uuid NOT NULL,
    attempt integer NOT NULL,
    outcome character varying(30) NOT NULL,
    delivered_at timestamp with time zone,
    recipient_name_masked character varying(60),
    recipient_confirmation character varying(120),
    proof_reference character varying(120),
    failed_reason text,
    rescheduled_for timestamp with time zone,
    delivered_quantity integer DEFAULT 0 NOT NULL,
    returned_quantity integer DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fulfilment_dispatches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fulfilment_dispatches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fulfilment_task_id uuid NOT NULL,
    order_id uuid NOT NULL,
    dispatch_reference character varying(80) NOT NULL,
    method character varying(20) NOT NULL,
    carrier_name character varying(120),
    rider_name character varying(120),
    contact_masked character varying(40),
    payment_policy character varying(20) NOT NULL,
    tracking_status character varying(20) DEFAULT 'DISPATCHED'::character varying NOT NULL,
    stock_consumed boolean DEFAULT false NOT NULL,
    dispatch_time timestamp with time zone NOT NULL,
    estimated_delivery_at timestamp with time zone,
    notes text,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fulfilment_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fulfilment_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fulfilment_task_id uuid NOT NULL,
    order_item_id uuid NOT NULL,
    product_id uuid NOT NULL,
    sku character varying(50) NOT NULL,
    ordered_quantity integer NOT NULL,
    reserved_quantity integer DEFAULT 0 NOT NULL,
    packed_quantity integer DEFAULT 0 NOT NULL,
    backordered_quantity integer DEFAULT 0 NOT NULL,
    cancelled_quantity integer DEFAULT 0 NOT NULL,
    version integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fulfilment_sla_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fulfilment_sla_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    stage character varying(20) NOT NULL,
    policy_version integer NOT NULL,
    idempotency_key character varying(200) NOT NULL,
    team_id uuid,
    assignee_id uuid,
    due_at_snapshot timestamp with time zone NOT NULL,
    priority_snapshot character varying(10) NOT NULL,
    detail text,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fulfilment_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fulfilment_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    order_number character varying(20) NOT NULL,
    status character varying(30) DEFAULT 'NEW'::character varying NOT NULL,
    payment_status character varying(30) NOT NULL,
    payment_method character varying(40),
    customer_name character varying(255) NOT NULL,
    customer_contact_masked character varying(80) NOT NULL,
    delivery_area character varying(255) NOT NULL,
    delivery_summary text NOT NULL,
    total_ugx integer NOT NULL,
    delivery_fee_ugx integer DEFAULT 0 NOT NULL,
    item_count integer NOT NULL,
    items jsonb NOT NULL,
    warnings jsonb,
    assigned_to uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    priority character varying(10) DEFAULT 'normal'::character varying NOT NULL,
    sla_due_at timestamp with time zone NOT NULL,
    assigned_at timestamp with time zone,
    team_id uuid,
    sla_policy_version integer DEFAULT 1 NOT NULL
);


--
-- Name: fulfilment_team_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fulfilment_team_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    user_id uuid NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_lead boolean DEFAULT false NOT NULL
);


--
-- Name: fulfilment_teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fulfilment_teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(120) NOT NULL,
    slug character varying(140) NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: identity_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.identity_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    anonymous_id character varying(160),
    browser_id character varying(160),
    session_id character varying(160),
    cart_id uuid,
    lead_id uuid,
    customer_id uuid,
    email_hash character varying(64),
    phone_hash character varying(64),
    link_type character varying(50) NOT NULL,
    link_confidence integer DEFAULT 0 NOT NULL,
    source_event_id uuid,
    first_linked_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inventory_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_reservations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    requested_quantity integer NOT NULL,
    reserved_quantity integer NOT NULL,
    status character varying(20) DEFAULT 'reserved'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: legacy_preference_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legacy_preference_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mapping_version character varying(50) NOT NULL,
    legacy_system character varying(100) NOT NULL,
    legacy_field character varying(100) NOT NULL,
    legacy_value_class character varying(100) NOT NULL,
    target_purpose_key character varying(100),
    target_channel_key character varying(50),
    mapping_outcome public.consent_legacy_mapping_outcome DEFAULT 'unknown'::public.consent_legacy_mapping_outcome NOT NULL,
    confidence character varying(20) NOT NULL,
    reason text NOT NULL,
    review_status character varying(50) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    effective_at timestamp with time zone NOT NULL,
    superseded_by uuid
);


--
-- Name: loyalty_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: loyalty_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    earn_rate_per_1000_ugx integer DEFAULT 0 NOT NULL,
    expiry_days integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: loyalty_ledger_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_ledger_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    type character varying(20) NOT NULL,
    points integer NOT NULL,
    order_id uuid,
    reason character varying(300) NOT NULL,
    idempotency_key character varying(120) NOT NULL,
    expires_at timestamp with time zone,
    reversed_entry_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT loyalty_ledger_shape_check CHECK (((points <> 0) AND ((((type)::text = 'earn'::text) AND (points > 0) AND (order_id IS NOT NULL) AND (reversed_entry_id IS NULL)) OR (((type)::text = 'redeem'::text) AND (points < 0) AND (reversed_entry_id IS NULL)) OR (((type)::text = 'expiry'::text) AND (points < 0) AND (reversed_entry_id IS NOT NULL)) OR (((type)::text = 'reversal'::text) AND (reversed_entry_id IS NOT NULL)) OR (((type)::text = 'adjustment'::text) AND (reversed_entry_id IS NULL))))),
    CONSTRAINT loyalty_ledger_type_check CHECK (((type)::text = ANY ((ARRAY['earn'::character varying, 'redeem'::character varying, 'reversal'::character varying, 'expiry'::character varying, 'adjustment'::character varying])::text[])))
);


--
-- Name: measurement_admin_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_admin_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    role_id uuid NOT NULL,
    resource character varying(100) NOT NULL,
    action character varying(100) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: measurement_admin_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_admin_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: measurement_api_failures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_api_failures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    api_name character varying(100) NOT NULL,
    endpoint character varying(255) NOT NULL,
    status_code integer,
    error_payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: measurement_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type character varying(100) NOT NULL,
    entity_id character varying(255) NOT NULL,
    action character varying(100) NOT NULL,
    changes jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: measurement_campaign_attribution; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_campaign_attribution (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fp_client_id character varying(255),
    user_id uuid,
    utm_source character varying(255),
    utm_medium character varying(255),
    utm_campaign character varying(255),
    utm_content text,
    utm_term text,
    gclid character varying(255),
    fbclid character varying(255),
    ttclid character varying(255),
    twclid character varying(255),
    li_fat_id character varying(255),
    pinterest_click_id character varying(255),
    snapchat_click_id character varying(255),
    referrer text,
    landing_page text,
    first_touch_timestamp timestamp with time zone,
    last_touch_timestamp timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: measurement_control_tower_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_control_tower_audit_log (
    id text NOT NULL,
    admin_user_id text NOT NULL,
    action text NOT NULL,
    section text,
    safe_reference_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    metadata jsonb
);


--
-- Name: measurement_dashboard_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_dashboard_metrics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    metric_name character varying(100) NOT NULL,
    metric_value real NOT NULL,
    dimensions jsonb,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: measurement_data_quality_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_data_quality_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rule_id uuid NOT NULL,
    event_id character varying(255),
    alert_message text NOT NULL,
    status character varying(50) DEFAULT 'open'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: measurement_data_quality_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_data_quality_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    event_match character varying(100) NOT NULL,
    condition jsonb NOT NULL,
    severity character varying(50) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: measurement_dead_letter_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_dead_letter_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_queue character varying(100) NOT NULL,
    payload jsonb NOT NULL,
    error_reason text NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    is_resolved boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: measurement_destination_delivery_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_destination_delivery_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    destination_id uuid NOT NULL,
    event_id character varying(255) NOT NULL,
    delivery_status character varying(50) NOT NULL,
    status_code integer,
    error_details text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: measurement_destination_routes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_destination_routes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    destination_id uuid NOT NULL,
    event_name character varying(100) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: measurement_destinations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_destinations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    type character varying(50) NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: measurement_gtm_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_gtm_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: measurement_gtm_containers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_gtm_containers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id character varying(100) NOT NULL,
    container_id character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    usage_context jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: measurement_gtm_sync_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_gtm_sync_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    container_id character varying(100) NOT NULL,
    action character varying(100) NOT NULL,
    status character varying(50) NOT NULL,
    details jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: measurement_gtm_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_gtm_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    container_id character varying(100) NOT NULL,
    version_id character varying(100) NOT NULL,
    name character varying(255),
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: measurement_gtm_workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_gtm_workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    container_id character varying(100) NOT NULL,
    workspace_id character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: measurement_incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_incidents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying(255) NOT NULL,
    severity character varying(50) NOT NULL,
    status character varying(50) DEFAULT 'investigating'::character varying NOT NULL,
    description text,
    resolution text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: measurement_paid_social_delivery_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_paid_social_delivery_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    destination_id uuid NOT NULL,
    event_id character varying(255) NOT NULL,
    event_name character varying(100) NOT NULL,
    delivery_status character varying(50) NOT NULL,
    status_code integer,
    error_details text,
    blocked_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: measurement_paid_social_destinations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_paid_social_destinations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    platform character varying(100) NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    credential_status character varying(50) DEFAULT 'unconfigured'::character varying NOT NULL,
    required_consent jsonb NOT NULL,
    allowed_fields jsonb NOT NULL,
    blocked_fields jsonb NOT NULL,
    hashing_rules jsonb NOT NULL,
    deduplication_keys jsonb NOT NULL,
    retry_policy jsonb NOT NULL,
    risk_level character varying(50) DEFAULT 'medium'::character varying NOT NULL,
    owner_role character varying(100),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: measurement_paid_social_event_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_paid_social_event_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    destination_id uuid NOT NULL,
    internal_event_name character varying(100) NOT NULL,
    platform_event_name character varying(100) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: measurement_qa_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_qa_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    test_id uuid NOT NULL,
    release_request_id uuid,
    status character varying(50) NOT NULL,
    actual_result jsonb,
    error_log text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: measurement_qa_tests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_qa_tests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    type character varying(100) NOT NULL,
    payload_template jsonb,
    expected_result jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: measurement_release_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_release_approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    release_request_id uuid NOT NULL,
    role character varying(100) NOT NULL,
    status character varying(50) NOT NULL,
    comments text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: measurement_release_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_release_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    gtm_workspace_id character varying(100),
    diff_payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid,
    version integer DEFAULT 1 NOT NULL,
    status character varying(50) DEFAULT 'draft'::character varying NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    change_reason text
);


--
-- Name: measurement_vendor_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_vendor_registry (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    domain character varying(255),
    privacy_policy_url text,
    data_processing_agreement boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid,
    version integer DEFAULT 1 NOT NULL,
    status character varying(50) DEFAULT 'draft'::character varying NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    change_reason text
);


--
-- Name: module_activation_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.module_activation_approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    module_key character varying(64) NOT NULL,
    approved_by uuid NOT NULL,
    approved_at timestamp with time zone DEFAULT now() NOT NULL,
    reason text NOT NULL,
    approval_reference character varying(255) NOT NULL,
    revoked_by uuid,
    revoked_at timestamp with time zone,
    revocation_reason text,
    trace_id character varying(128),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT module_activation_approvals_reason_not_blank CHECK ((length(btrim(reason)) > 0)),
    CONSTRAINT module_activation_approvals_reference_not_blank CHECK ((length(btrim((approval_reference)::text)) > 0)),
    CONSTRAINT module_activation_approvals_revocation_complete CHECK ((((revoked_at IS NULL) AND (revoked_by IS NULL) AND (revocation_reason IS NULL)) OR ((revoked_at IS NOT NULL) AND (revoked_by IS NOT NULL) AND (length(btrim(COALESCE(revocation_reason, ''::text))) > 0)))),
    CONSTRAINT module_activation_approvals_revoked_after_approved CHECK (((revoked_at IS NULL) OR (revoked_at >= approved_at)))
);


--
-- Name: nba_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nba_candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    decision_id uuid NOT NULL,
    action_type character varying(30) NOT NULL,
    target_ref character varying(128),
    eligible boolean NOT NULL,
    exclusion_reason character varying(40),
    score integer NOT NULL,
    reason_codes jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: nba_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nba_decisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    canonical_customer_id uuid NOT NULL,
    profile_version integer NOT NULL,
    selected_action character varying(30) NOT NULL,
    selected_target_ref character varying(128),
    reason_codes jsonb NOT NULL,
    policy_version integer NOT NULL,
    decision_key character varying(200) NOT NULL,
    activation_state character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notification_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel character varying(20) NOT NULL,
    recipient character varying(255) NOT NULL,
    template character varying(100) NOT NULL,
    status character varying(30) DEFAULT 'PENDING'::character varying NOT NULL,
    provider_code character varying(50),
    provider_message text,
    related_entity character varying(50),
    related_entity_id uuid,
    attempted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    sku character varying(50) NOT NULL,
    product_name character varying(255) NOT NULL,
    quantity integer NOT NULL,
    unit_price integer NOT NULL,
    canonical_unit_price integer DEFAULT 0 NOT NULL,
    base_subtotal integer DEFAULT 0 NOT NULL,
    discount_amount integer DEFAULT 0 NOT NULL,
    final_line_total integer DEFAULT 0 NOT NULL,
    CONSTRAINT order_items_pricing_money_check CHECK (((canonical_unit_price >= 0) AND (base_subtotal >= 0) AND (discount_amount >= 0) AND (final_line_total >= 0)))
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_number character varying(20) NOT NULL,
    buyer_type character varying(20) DEFAULT 'retail'::character varying NOT NULL,
    customer_name character varying(255) NOT NULL,
    customer_phone character varying(20) NOT NULL,
    customer_email character varying(255),
    delivery_area character varying(255) NOT NULL,
    delivery_address character varying(255) NOT NULL,
    status character varying(30) DEFAULT 'received'::character varying NOT NULL,
    payment_status character varying(30) DEFAULT 'unpaid'::character varying NOT NULL,
    subtotal_amount integer NOT NULL,
    delivery_fee integer DEFAULT 0 NOT NULL,
    total_amount integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    anonymous_id character varying(160),
    browser_id character varying(160),
    session_id character varying(160),
    cart_id uuid,
    attribution_id uuid,
    delivery_location jsonb,
    delivery_fee_confirmed boolean DEFAULT false NOT NULL,
    client_order_key character varying(80),
    pricing_quote_id uuid,
    pricing_currency character varying(3) DEFAULT 'UGX'::character varying NOT NULL,
    pricing_base_subtotal integer DEFAULT 0 NOT NULL,
    pricing_discount_total integer DEFAULT 0 NOT NULL,
    pricing_tax_total integer DEFAULT 0 NOT NULL,
    pricing_calculation_version character varying(40) DEFAULT 'legacy-unadjusted-v1'::character varying NOT NULL,
    pricing_snapshot jsonb,
    CONSTRAINT orders_pricing_money_check CHECK ((((pricing_currency)::text = 'UGX'::text) AND (pricing_base_subtotal >= 0) AND (pricing_discount_total >= 0) AND (pricing_tax_total >= 0)))
);


--
-- Name: outbox_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbox_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type character varying(100) NOT NULL,
    payload jsonb NOT NULL,
    is_processed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    attempt_count integer DEFAULT 0 NOT NULL,
    last_error text,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    idempotency_key character varying(255),
    channel character varying(50),
    template character varying(100),
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    related_entity character varying(50),
    related_entity_id uuid,
    dry_run_only boolean DEFAULT true NOT NULL,
    preview_only boolean DEFAULT false NOT NULL,
    no_send_guarantee boolean DEFAULT false NOT NULL,
    suppressed_reason text
);


--
-- Name: packing_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.packing_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fulfilment_task_id uuid NOT NULL,
    status character varying(20) DEFAULT 'NOT_STARTED'::character varying NOT NULL,
    packer_user_id uuid,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    package_count integer,
    package_reference character varying(120),
    packing_notes text,
    exception_reason text,
    idempotency_key character varying(200),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payment_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    merchant_reference character varying(255) NOT NULL,
    order_tracking_id character varying(255),
    amount integer NOT NULL,
    currency character varying(10) DEFAULT 'UGX'::character varying NOT NULL,
    status character varying(30) DEFAULT 'not_started'::character varying NOT NULL,
    redirect_url character varying(512),
    provider character varying(50) DEFAULT 'pesapal'::character varying NOT NULL,
    ipn_received_at timestamp with time zone,
    callback_received_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payment_measurement_reconciliations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_measurement_reconciliations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id character varying(255) NOT NULL,
    payment_reference character varying(255),
    pesapal_tracking_id character varying(255),
    status character varying(50) NOT NULL,
    amount real,
    currency character varying(10),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    idempotency_key character varying(255) NOT NULL,
    provider character varying(50) NOT NULL,
    provider_reference character varying(255),
    amount integer NOT NULL,
    status character varying(30) DEFAULT 'PENDING'::character varying NOT NULL,
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    action character varying(50) NOT NULL,
    resource character varying(50) NOT NULL
);


--
-- Name: pim_import_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pim_import_approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    decision character varying(20) NOT NULL,
    actor_id uuid NOT NULL,
    reason text NOT NULL,
    preview_digest character varying(64) NOT NULL,
    decided_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pim_import_approvals_decision_check CHECK (((decision)::text = ANY ((ARRAY['APPROVED'::character varying, 'REJECTED'::character varying])::text[]))),
    CONSTRAINT pim_import_approvals_reason_check CHECK ((length(TRIM(BOTH FROM reason)) > 0))
);


--
-- Name: pim_import_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pim_import_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    action character varying(40) NOT NULL,
    actor_id uuid NOT NULL,
    reason text NOT NULL,
    evidence jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pim_import_events_evidence_check CHECK ((jsonb_typeof(evidence) = 'object'::text)),
    CONSTRAINT pim_import_events_reason_check CHECK ((length(TRIM(BOTH FROM reason)) > 0))
);


--
-- Name: pim_import_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pim_import_rows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    row_number integer NOT NULL,
    source_data jsonb NOT NULL,
    normalized_data jsonb,
    validation_errors jsonb NOT NULL,
    action character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    target_product_id uuid,
    before_snapshot jsonb,
    after_snapshot jsonb,
    error text,
    CONSTRAINT pim_import_rows_action_check CHECK (((action)::text = ANY ((ARRAY['PENDING'::character varying, 'CREATE'::character varying, 'UPDATE'::character varying, 'SKIP'::character varying])::text[]))),
    CONSTRAINT pim_import_rows_json_check CHECK (((jsonb_typeof(source_data) = 'object'::text) AND (jsonb_typeof(validation_errors) = 'array'::text) AND ((normalized_data IS NULL) OR (jsonb_typeof(normalized_data) = 'object'::text)))),
    CONSTRAINT pim_import_rows_number_check CHECK ((row_number > 0)),
    CONSTRAINT pim_import_rows_status_check CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'VALID'::character varying, 'INVALID'::character varying, 'APPLIED'::character varying, 'FAILED'::character varying, 'ROLLED_BACK'::character varying])::text[])))
);


--
-- Name: pim_import_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pim_import_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(160) NOT NULL,
    source_filename character varying(255) NOT NULL,
    source_sha256 character varying(64) NOT NULL,
    mode character varying(20) NOT NULL,
    status character varying(30) DEFAULT 'UPLOADED'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    mapping jsonb,
    total_rows integer NOT NULL,
    valid_rows integer DEFAULT 0 NOT NULL,
    invalid_rows integer DEFAULT 0 NOT NULL,
    create_rows integer DEFAULT 0 NOT NULL,
    update_rows integer DEFAULT 0 NOT NULL,
    applied_rows integer DEFAULT 0 NOT NULL,
    failed_rows integer DEFAULT 0 NOT NULL,
    preview_digest character varying(64),
    created_by uuid NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pim_import_sessions_counts_check CHECK ((((total_rows >= 1) AND (total_rows <= 1000)) AND (valid_rows >= 0) AND (invalid_rows >= 0) AND (create_rows >= 0) AND (update_rows >= 0) AND (applied_rows >= 0) AND (failed_rows >= 0))),
    CONSTRAINT pim_import_sessions_hash_check CHECK ((((source_sha256)::text ~ '^[a-f0-9]{64}$'::text) AND ((preview_digest IS NULL) OR ((preview_digest)::text ~ '^[a-f0-9]{64}$'::text)))),
    CONSTRAINT pim_import_sessions_mode_check CHECK (((mode)::text = ANY ((ARRAY['CREATE_ONLY'::character varying, 'UPSERT'::character varying])::text[]))),
    CONSTRAINT pim_import_sessions_status_check CHECK (((status)::text = ANY ((ARRAY['UPLOADED'::character varying, 'MAPPED'::character varying, 'READY_FOR_APPROVAL'::character varying, 'APPROVED'::character varying, 'APPLYING'::character varying, 'APPLIED'::character varying, 'PARTIALLY_APPLIED'::character varying, 'FAILED'::character varying, 'ROLLED_BACK'::character varying, 'ROLLBACK_PARTIAL'::character varying, 'REJECTED'::character varying])::text[])))
);


--
-- Name: preference_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.preference_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    before_state jsonb,
    after_state jsonb NOT NULL,
    source character varying(50) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pricing_adjustments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_adjustments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    quote_id uuid NOT NULL,
    quote_line_id uuid,
    promotion_definition_id uuid NOT NULL,
    promotion_version_id uuid NOT NULL,
    benefit_type character varying(30) NOT NULL,
    amount_ugx integer NOT NULL,
    application_order integer NOT NULL,
    explanation text NOT NULL,
    CONSTRAINT pricing_adjustments_amount_check CHECK (((amount_ugx >= 0) AND (application_order >= 0))),
    CONSTRAINT pricing_adjustments_benefit_check CHECK (((benefit_type)::text = ANY ((ARRAY['PERCENTAGE_OFF'::character varying, 'FIXED_AMOUNT_OFF'::character varying, 'FIXED_PRICE'::character varying, 'FREE_SHIPPING'::character varying])::text[])))
);


--
-- Name: pricing_experiment_associations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_experiment_associations (
    promotion_version_id uuid NOT NULL,
    experiment_id uuid NOT NULL,
    variant_key character varying(40) NOT NULL
);


--
-- Name: pricing_quote_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_quote_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    quote_id uuid NOT NULL,
    product_id uuid NOT NULL,
    sku character varying(50) NOT NULL,
    product_name character varying(255) NOT NULL,
    quantity integer NOT NULL,
    canonical_unit_price_ugx integer NOT NULL,
    base_subtotal_ugx integer NOT NULL,
    discount_ugx integer DEFAULT 0 NOT NULL,
    final_subtotal_ugx integer NOT NULL,
    CONSTRAINT pricing_quote_lines_money_check CHECK (((quantity > 0) AND (canonical_unit_price_ugx > 0) AND (base_subtotal_ugx >= 0) AND (discount_ugx >= 0) AND (final_subtotal_ugx >= 0)))
);


--
-- Name: pricing_quotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_quotes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    currency character varying(3) DEFAULT 'UGX'::character varying NOT NULL,
    customer_scope_hash character varying(64),
    coupon_reference character varying(64),
    base_subtotal_ugx integer NOT NULL,
    discount_total_ugx integer DEFAULT 0 NOT NULL,
    shipping_ugx integer DEFAULT 0 NOT NULL,
    tax_ugx integer DEFAULT 0 NOT NULL,
    final_total_ugx integer NOT NULL,
    calculation_version character varying(40) NOT NULL,
    experiment_evidence jsonb NOT NULL,
    decision_trace jsonb NOT NULL,
    evaluated_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT pricing_quotes_currency_check CHECK (((currency)::text = 'UGX'::text)),
    CONSTRAINT pricing_quotes_expiry_check CHECK ((expires_at > evaluated_at)),
    CONSTRAINT pricing_quotes_money_check CHECK (((base_subtotal_ugx >= 0) AND (discount_total_ugx >= 0) AND (shipping_ugx >= 0) AND (tax_ugx >= 0) AND (final_total_ugx >= 0)))
);


--
-- Name: product_attribute_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_attribute_values (
    product_id uuid NOT NULL,
    attribute_id uuid NOT NULL,
    value character varying(255) NOT NULL,
    is_verified boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_compatibility_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_compatibility_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    target_product_id uuid NOT NULL,
    verdict character varying(20) NOT NULL,
    note character varying(300),
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_feed_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_feed_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    feed_id uuid NOT NULL,
    product_id uuid NOT NULL,
    eligibility_status character varying(30) NOT NULL,
    exclusion_reason text
);


--
-- Name: product_feeds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_feeds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    feed_type character varying(50) NOT NULL,
    status character varying(30) DEFAULT 'DRAFT'::character varying NOT NULL,
    last_generated_at timestamp with time zone
);


--
-- Name: product_finder_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_finder_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    anonymous_id character varying(160),
    status character varying(50) DEFAULT 'FINDER_STARTED'::character varying NOT NULL,
    answers jsonb DEFAULT '{}'::jsonb NOT NULL,
    recommendations jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    url text NOT NULL,
    alt_text character varying(255),
    display_order integer DEFAULT 0 NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_prices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    retail_price integer NOT NULL,
    dealer_price integer,
    cost_price integer
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sku character varying(50) NOT NULL,
    model_number character varying(50) NOT NULL,
    name character varying(255) NOT NULL,
    slug character varying(255) NOT NULL,
    category_id uuid NOT NULL,
    category_name character varying(100),
    subcategory character varying(100),
    short_description character varying(500) DEFAULT ''::character varying NOT NULL,
    long_description character varying(5000) DEFAULT ''::character varying NOT NULL,
    price_ugx integer DEFAULT 0 NOT NULL,
    compare_at_price_ugx integer,
    stock_status character varying(30) DEFAULT 'in_stock'::character varying NOT NULL,
    image_url character varying(1000),
    features jsonb DEFAULT '[]'::jsonb NOT NULL,
    warranty_period character varying(100) DEFAULT '1 Year'::character varying NOT NULL,
    verification_eligible boolean DEFAULT true NOT NULL,
    active boolean DEFAULT true NOT NULL,
    specifications jsonb DEFAULT '{}'::jsonb NOT NULL,
    approval_status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    is_feed_eligible boolean DEFAULT false NOT NULL,
    is_pre_order_enabled boolean DEFAULT false NOT NULL,
    has_retail_price boolean DEFAULT false NOT NULL,
    has_image boolean DEFAULT false NOT NULL,
    stock_quantity integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reserved_quantity integer DEFAULT 0 NOT NULL,
    reorder_point integer DEFAULT 0 NOT NULL
);


--
-- Name: promotion_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotion_approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version_id uuid NOT NULL,
    decision character varying(20) NOT NULL,
    actor_id uuid NOT NULL,
    reason text NOT NULL,
    decided_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT promotion_approvals_decision_check CHECK (((decision)::text = ANY ((ARRAY['APPROVED'::character varying, 'REJECTED'::character varying])::text[]))),
    CONSTRAINT promotion_approvals_reason_check CHECK ((length(TRIM(BOTH FROM reason)) > 0))
);


--
-- Name: promotion_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotion_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key character varying(80) NOT NULL,
    name character varying(160) NOT NULL,
    description text NOT NULL,
    status character varying(30) DEFAULT 'DRAFT'::character varying NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    active_version_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT promotion_definitions_revision_check CHECK ((revision > 0)),
    CONSTRAINT promotion_definitions_status_check CHECK (((status)::text = ANY ((ARRAY['DRAFT'::character varying, 'READY_FOR_REVIEW'::character varying, 'APPROVED'::character varying, 'ACTIVE'::character varying, 'PAUSED'::character varying, 'EXPIRED'::character varying, 'REJECTED'::character varying, 'ARCHIVED'::character varying])::text[])))
);


--
-- Name: promotion_redemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotion_redemptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reservation_id uuid NOT NULL,
    order_id uuid NOT NULL,
    redeemed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: promotion_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotion_reservations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    quote_id uuid NOT NULL,
    promotion_version_id uuid NOT NULL,
    customer_scope_hash character varying(64),
    coupon_reference_hash character varying(64),
    idempotency_key character varying(160) NOT NULL,
    status character varying(20) DEFAULT 'RESERVED'::character varying NOT NULL,
    reserved_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    released_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT promotion_reservations_expiry_check CHECK ((expires_at > reserved_at)),
    CONSTRAINT promotion_reservations_status_check CHECK (((status)::text = ANY ((ARRAY['RESERVED'::character varying, 'REDEEMED'::character varying, 'RELEASED'::character varying, 'EXPIRED'::character varying, 'CANCELLED'::character varying])::text[])))
);


--
-- Name: promotion_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotion_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    definition_id uuid NOT NULL,
    version_number integer NOT NULL,
    status character varying(30) DEFAULT 'DRAFT'::character varying NOT NULL,
    conditions jsonb NOT NULL,
    benefits jsonb NOT NULL,
    exclusions jsonb NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    global_limit integer,
    per_customer_limit integer,
    per_coupon_limit integer,
    reservation_ttl_seconds integer DEFAULT 900 NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    stackable boolean DEFAULT false NOT NULL,
    coupon_code character varying(40),
    price_floor_ugx integer DEFAULT 0 NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    submitted_at timestamp with time zone,
    approved_at timestamp with time zone,
    approved_by uuid,
    CONSTRAINT promotion_versions_limits_check CHECK ((((global_limit IS NULL) OR (global_limit > 0)) AND ((per_customer_limit IS NULL) OR (per_customer_limit > 0)) AND ((per_coupon_limit IS NULL) OR (per_coupon_limit > 0)))),
    CONSTRAINT promotion_versions_policy_check CHECK (((version_number > 0) AND ((reservation_ttl_seconds >= 60) AND (reservation_ttl_seconds <= 86400)) AND ((priority >= 0) AND (priority <= 10000)) AND (price_floor_ugx >= 0))),
    CONSTRAINT promotion_versions_status_check CHECK (((status)::text = ANY ((ARRAY['DRAFT'::character varying, 'READY_FOR_REVIEW'::character varying, 'APPROVED'::character varying, 'ACTIVE'::character varying, 'PAUSED'::character varying, 'EXPIRED'::character varying, 'REJECTED'::character varying, 'ARCHIVED'::character varying])::text[]))),
    CONSTRAINT promotion_versions_window_check CHECK ((ends_at > starts_at))
);


--
-- Name: provider_unsubscribe_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_unsubscribe_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_key character varying(100) NOT NULL,
    provider_event_ref character varying(255) NOT NULL,
    provider_callback_ref character varying(255) NOT NULL,
    endpoint_ref character varying(255) NOT NULL,
    channel_key character varying(50) NOT NULL,
    purpose_key character varying(100),
    scope character varying(50) NOT NULL,
    authenticity_verified boolean NOT NULL,
    freshness_verified boolean NOT NULL,
    provider_occurred_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    correlation_id character varying(255) NOT NULL,
    integrity_hash character varying(64),
    tamper_evidence_ref character varying(255),
    normalized_evidence jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT provider_unsubscribe_events_tamper_evidence_chk CHECK (((integrity_hash IS NOT NULL) OR (tamper_evidence_ref IS NOT NULL)))
);


--
-- Name: purchase_measurement_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_measurement_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id character varying(255) NOT NULL,
    payment_reference character varying(255),
    event_id character varying(255) NOT NULL,
    idempotency_key character varying(255) NOT NULL,
    payload_summary jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: quote_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quote_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    phone character varying(50) NOT NULL,
    product_name character varying(255) NOT NULL,
    quantity character varying(50) NOT NULL,
    message text,
    status character varying(50) DEFAULT 'new'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    anonymous_id character varying(160),
    browser_id character varying(160),
    session_id character varying(160),
    cart_id uuid,
    attribution_id uuid
);


--
-- Name: recommendation_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recommendation_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type character varying(80) NOT NULL,
    anonymous_id character varying(160),
    customer_id uuid,
    session_id character varying(160),
    product_id uuid,
    category_id uuid,
    search_query text,
    placement character varying(80),
    recommendation_product_id uuid,
    source character varying(160),
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    rule_id uuid,
    attribution_id uuid,
    cart_id uuid,
    browser_id character varying(160),
    lead_id uuid,
    impression_id uuid,
    rail_render_id uuid,
    reason_code character varying(80),
    applied_rule_ids jsonb,
    source_product_id uuid,
    page_path character varying(255),
    referrer character varying(500),
    utm_source character varying(100),
    utm_medium character varying(100),
    utm_campaign character varying(150),
    utm_content character varying(150),
    utm_term character varying(150),
    device_type character varying(50),
    browser_family character varying(80),
    os_family character varying(80),
    screen_width integer,
    screen_height integer,
    viewport_width integer,
    viewport_height integer,
    language character varying(30),
    timezone character varying(80),
    location_source character varying(50),
    district character varying(120),
    town character varying(120),
    gps_geohash character varying(16),
    gps_accuracy_meters integer
);


--
-- Name: recommendation_materialized_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recommendation_materialized_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    placement character varying(80) NOT NULL,
    context_key character varying(255) NOT NULL,
    items jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: recommendation_rule_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recommendation_rule_audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rule_id uuid,
    action character varying(80) NOT NULL,
    before jsonb,
    after jsonb,
    performed_by uuid,
    performed_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: recommendation_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recommendation_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    type character varying(80) NOT NULL,
    status character varying(50) DEFAULT 'DRAFT'::character varying NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    placement character varying(80) NOT NULL,
    target_type character varying(80) NOT NULL,
    target_value character varying(255),
    conditions jsonb DEFAULT '{}'::jsonb NOT NULL,
    action jsonb DEFAULT '{}'::jsonb NOT NULL,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: release_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.release_decisions (
    id character varying(36) NOT NULL,
    run_id character varying(36) NOT NULL,
    status character varying(50) NOT NULL,
    recorded_by uuid NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: release_readiness_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.release_readiness_audit_log (
    id character varying(36) NOT NULL,
    admin_user_id uuid NOT NULL,
    action character varying(100) NOT NULL,
    resource_type character varying(100),
    resource_id character varying(100),
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: release_readiness_gate_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.release_readiness_gate_results (
    id character varying(36) NOT NULL,
    run_id character varying(36) NOT NULL,
    gate_id character varying(100) NOT NULL,
    category character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    status character varying(50) NOT NULL,
    severity character varying(50) NOT NULL,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    source character varying(255) NOT NULL,
    recommendation text,
    safe_reference_id character varying(255),
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    acknowledged_at timestamp with time zone,
    acknowledged_by uuid,
    acknowledgement_reason text
);


--
-- Name: release_readiness_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.release_readiness_runs (
    id character varying(36) NOT NULL,
    status character varying(50) NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    triggered_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(50) NOT NULL
);


--
-- Name: search_demand_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.search_demand_signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    query character varying(120) NOT NULL,
    search_count integer DEFAULT 0 NOT NULL,
    zero_result_count integer DEFAULT 0 NOT NULL,
    last_result_count integer DEFAULT 0 NOT NULL,
    status character varying(20) DEFAULT 'open'::character varying NOT NULL,
    first_searched_at timestamp with time zone DEFAULT now() NOT NULL,
    last_searched_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: search_product_insights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.search_product_insights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    query character varying(120) NOT NULL,
    product_id uuid NOT NULL,
    impression_count integer DEFAULT 0 NOT NULL,
    click_count integer DEFAULT 0 NOT NULL,
    conversion_count integer DEFAULT 0 NOT NULL,
    rank_sum integer DEFAULT 0 NOT NULL,
    last_rank integer NOT NULL,
    first_observed_at timestamp with time zone DEFAULT now() NOT NULL,
    last_observed_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT search_product_insight_integrity CHECK (((impression_count >= 0) AND (click_count >= 0) AND (conversion_count >= 0) AND (click_count <= impression_count) AND (conversion_count <= click_count) AND ((last_rank >= 1) AND (last_rank <= 50)) AND (rank_sum >= impression_count)))
);


--
-- Name: support_assisted_preference_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_assisted_preference_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_identity_ref character varying(255) NOT NULL,
    endpoint_ref character varying(255),
    purpose_key character varying(100) NOT NULL,
    channel_key character varying(50) NOT NULL,
    requested_state public.canonical_consent_state NOT NULL,
    identity_verification_level public.consent_identity_level NOT NULL,
    verification_status character varying(50) NOT NULL,
    support_ticket_ref character varying(255) NOT NULL,
    actor_type public.consent_actor_type NOT NULL,
    actor_id character varying(255) NOT NULL,
    script_copy_version_id character varying(100) NOT NULL,
    correlation_id character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    superseded_by uuid,
    CONSTRAINT support_assisted_requests_no_direct_grant_chk CHECK ((requested_state <> 'granted'::public.canonical_consent_state))
);


--
-- Name: support_issues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_issues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid,
    subject character varying(255) NOT NULL,
    description text NOT NULL,
    status character varying(50) DEFAULT 'open'::character varying NOT NULL,
    priority character varying(50) DEFAULT 'medium'::character varying NOT NULL,
    type character varying(50) NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_to character varying(120),
    updated_at timestamp with time zone
);


--
-- Name: survey_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.survey_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key character varying(80) NOT NULL,
    status character varying(30) DEFAULT 'DRAFT'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    current_version_id uuid NOT NULL,
    created_by uuid NOT NULL,
    approved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT survey_definitions_status_chk CHECK (((status)::text = ANY ((ARRAY['DRAFT'::character varying, 'PENDING_APPROVAL'::character varying, 'APPROVED'::character varying, 'ACTIVE'::character varying, 'PAUSED'::character varying, 'CLOSED'::character varying, 'REJECTED'::character varying])::text[])))
);


--
-- Name: survey_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.survey_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    definition_id uuid NOT NULL,
    action character varying(40) NOT NULL,
    actor_id uuid NOT NULL,
    reason text NOT NULL,
    evidence jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT survey_events_evidence_object_chk CHECK ((jsonb_typeof(evidence) = 'object'::text))
);


--
-- Name: survey_responses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.survey_responses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    definition_id uuid NOT NULL,
    version_id uuid NOT NULL,
    participant_ref_hash character varying(64) NOT NULL,
    consent_evidence jsonb NOT NULL,
    answers jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(20) DEFAULT 'IN_PROGRESS'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT survey_responses_answers_object_chk CHECK ((jsonb_typeof(answers) = 'object'::text)),
    CONSTRAINT survey_responses_consent_object_chk CHECK ((jsonb_typeof(consent_evidence) = 'object'::text)),
    CONSTRAINT survey_responses_status_chk CHECK (((status)::text = ANY ((ARRAY['IN_PROGRESS'::character varying, 'COMPLETED'::character varying])::text[])))
);


--
-- Name: survey_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.survey_versions (
    id uuid NOT NULL,
    definition_id uuid NOT NULL,
    version_number integer NOT NULL,
    title character varying(160) NOT NULL,
    description text NOT NULL,
    purpose_key character varying(100) NOT NULL,
    questions jsonb NOT NULL,
    audience jsonb NOT NULL,
    content_digest character varying(64) NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT survey_versions_audience_object_chk CHECK ((jsonb_typeof(audience) = 'object'::text)),
    CONSTRAINT survey_versions_questions_array_chk CHECK ((jsonb_typeof(questions) = 'array'::text))
);


--
-- Name: telemetry_dlq; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_dlq (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    original_outbox_event_id uuid NOT NULL,
    event_name character varying(100) NOT NULL,
    event_id character varying(255) NOT NULL,
    payload jsonb NOT NULL,
    total_attempts integer NOT NULL,
    failed_reason text NOT NULL,
    failed_at timestamp with time zone DEFAULT now() NOT NULL,
    is_resolved boolean DEFAULT false NOT NULL,
    resolved_at timestamp with time zone,
    resolved_note text
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    user_id uuid NOT NULL,
    role_id uuid NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255) NOT NULL,
    phone character varying(20),
    password_hash character varying(255) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: utm_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.utm_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    utm_source character varying(100) NOT NULL,
    utm_medium character varying(100) NOT NULL,
    utm_campaign character varying(100) NOT NULL,
    utm_content character varying(100),
    utm_term character varying(100),
    short_url character varying(100)
);


--
-- Name: verification_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verification_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(50) NOT NULL,
    product_id uuid,
    is_successful boolean NOT NULL,
    ip_address character varying(100),
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: verification_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verification_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    code character varying(50) NOT NULL,
    is_used boolean DEFAULT false NOT NULL,
    used_at timestamp with time zone
);


--
-- Name: wishlists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wishlists (
    user_id uuid NOT NULL,
    product_id uuid NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: zero_party_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zero_party_signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fp_client_id character varying(255),
    user_id uuid,
    session_id character varying(255),
    signal_type character varying(50) NOT NULL,
    payload jsonb NOT NULL,
    page_location text,
    product_id character varying(255),
    source_component character varying(100),
    captured_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: addresses addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT addresses_pkey PRIMARY KEY (id);


--
-- Name: attributes attributes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attributes
    ADD CONSTRAINT attributes_pkey PRIMARY KEY (id);


--
-- Name: attribution_touchpoints attribution_touchpoints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attribution_touchpoints
    ADD CONSTRAINT attribution_touchpoints_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: automation_action_executions automation_action_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_action_executions
    ADD CONSTRAINT automation_action_executions_pkey PRIMARY KEY (id);


--
-- Name: automation_approvals automation_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_approvals
    ADD CONSTRAINT automation_approvals_pkey PRIMARY KEY (id);


--
-- Name: automation_definitions automation_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_definitions
    ADD CONSTRAINT automation_definitions_pkey PRIMARY KEY (id);


--
-- Name: automation_events automation_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_events
    ADD CONSTRAINT automation_events_pkey PRIMARY KEY (id);


--
-- Name: automation_executions automation_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_executions
    ADD CONSTRAINT automation_executions_pkey PRIMARY KEY (id);


--
-- Name: automation_frequency_cap_reservations automation_frequency_cap_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_frequency_cap_reservations
    ADD CONSTRAINT automation_frequency_cap_reservations_pkey PRIMARY KEY (id);


--
-- Name: automation_suppressions automation_suppressions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_suppressions
    ADD CONSTRAINT automation_suppressions_pkey PRIMARY KEY (id);


--
-- Name: automation_versions automation_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_versions
    ADD CONSTRAINT automation_versions_pkey PRIMARY KEY (id);


--
-- Name: behavioural_intervention_definitions behavioural_intervention_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.behavioural_intervention_definitions
    ADD CONSTRAINT behavioural_intervention_definitions_pkey PRIMARY KEY (id);


--
-- Name: behavioural_intervention_events behavioural_intervention_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.behavioural_intervention_events
    ADD CONSTRAINT behavioural_intervention_events_pkey PRIMARY KEY (id);


--
-- Name: behavioural_intervention_exposures behavioural_intervention_exposures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.behavioural_intervention_exposures
    ADD CONSTRAINT behavioural_intervention_exposures_pkey PRIMARY KEY (id);


--
-- Name: behavioural_intervention_outcomes behavioural_intervention_outcomes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.behavioural_intervention_outcomes
    ADD CONSTRAINT behavioural_intervention_outcomes_pkey PRIMARY KEY (id);


--
-- Name: behavioural_intervention_versions behavioural_intervention_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.behavioural_intervention_versions
    ADD CONSTRAINT behavioural_intervention_versions_pkey PRIMARY KEY (id);


--
-- Name: campaigns campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id);


--
-- Name: cart_items cart_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_pkey PRIMARY KEY (id);


--
-- Name: carts carts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carts
    ADD CONSTRAINT carts_pkey PRIMARY KEY (id);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: categories categories_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_slug_unique UNIQUE (slug);


--
-- Name: channel_suppressions channel_suppressions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_suppressions
    ADD CONSTRAINT channel_suppressions_pkey PRIMARY KEY (id);


--
-- Name: consent_channels consent_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_channels
    ADD CONSTRAINT consent_channels_pkey PRIMARY KEY (id);


--
-- Name: consent_copy_versions consent_copy_versions_copy_version_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_copy_versions
    ADD CONSTRAINT consent_copy_versions_copy_version_id_unique UNIQUE (copy_version_id);


--
-- Name: consent_copy_versions consent_copy_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_copy_versions
    ADD CONSTRAINT consent_copy_versions_pkey PRIMARY KEY (id);


--
-- Name: consent_current_state consent_current_state_fp_client_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_current_state
    ADD CONSTRAINT consent_current_state_fp_client_id_unique UNIQUE (fp_client_id);


--
-- Name: consent_current_state consent_current_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_current_state
    ADD CONSTRAINT consent_current_state_pkey PRIMARY KEY (id);


--
-- Name: consent_current_state consent_current_state_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_current_state
    ADD CONSTRAINT consent_current_state_user_id_unique UNIQUE (user_id);


--
-- Name: consent_events consent_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_events
    ADD CONSTRAINT consent_events_pkey PRIMARY KEY (consent_event_id);


--
-- Name: consent_policy_blocks consent_policy_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_policy_blocks
    ADD CONSTRAINT consent_policy_blocks_pkey PRIMARY KEY (id);


--
-- Name: consent_purposes consent_purposes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_purposes
    ADD CONSTRAINT consent_purposes_pkey PRIMARY KEY (id);


--
-- Name: consent_records consent_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_pkey PRIMARY KEY (id);


--
-- Name: consent_source_surfaces consent_source_surfaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_source_surfaces
    ADD CONSTRAINT consent_source_surfaces_pkey PRIMARY KEY (id);


--
-- Name: controlled_activation_approvals controlled_activation_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_approvals
    ADD CONSTRAINT controlled_activation_approvals_pkey PRIMARY KEY (id);


--
-- Name: controlled_activation_audit_log controlled_activation_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_audit_log
    ADD CONSTRAINT controlled_activation_audit_log_pkey PRIMARY KEY (id);


--
-- Name: controlled_activation_canary_plans controlled_activation_canary_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_canary_plans
    ADD CONSTRAINT controlled_activation_canary_plans_pkey PRIMARY KEY (id);


--
-- Name: controlled_activation_canary_runbooks controlled_activation_canary_runbooks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_canary_runbooks
    ADD CONSTRAINT controlled_activation_canary_runbooks_pkey PRIMARY KEY (id);


--
-- Name: controlled_activation_destination_previews controlled_activation_destination_previews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_destination_previews
    ADD CONSTRAINT controlled_activation_destination_previews_pkey PRIMARY KEY (id);


--
-- Name: controlled_activation_dry_runs controlled_activation_dry_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_dry_runs
    ADD CONSTRAINT controlled_activation_dry_runs_pkey PRIMARY KEY (id);


--
-- Name: controlled_activation_evidence_packs controlled_activation_evidence_packs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_evidence_packs
    ADD CONSTRAINT controlled_activation_evidence_packs_pkey PRIMARY KEY (id);


--
-- Name: controlled_activation_execution_plans controlled_activation_execution_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_execution_plans
    ADD CONSTRAINT controlled_activation_execution_plans_pkey PRIMARY KEY (id);


--
-- Name: controlled_activation_gate_results controlled_activation_gate_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_gate_results
    ADD CONSTRAINT controlled_activation_gate_results_pkey PRIMARY KEY (gate_id);


--
-- Name: controlled_activation_incident_plans controlled_activation_incident_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_incident_plans
    ADD CONSTRAINT controlled_activation_incident_plans_pkey PRIMARY KEY (id);


--
-- Name: controlled_activation_live_readiness_checks controlled_activation_live_readiness_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_live_readiness_checks
    ADD CONSTRAINT controlled_activation_live_readiness_checks_pkey PRIMARY KEY (id);


--
-- Name: controlled_activation_live_review_candidates controlled_activation_live_review_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_live_review_candidates
    ADD CONSTRAINT controlled_activation_live_review_candidates_pkey PRIMARY KEY (id);


--
-- Name: controlled_activation_operator_checklists controlled_activation_operator_checklists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_operator_checklists
    ADD CONSTRAINT controlled_activation_operator_checklists_pkey PRIMARY KEY (id);


--
-- Name: controlled_activation_requests controlled_activation_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_requests
    ADD CONSTRAINT controlled_activation_requests_pkey PRIMARY KEY (id);


--
-- Name: controlled_activation_stakeholder_live_approvals controlled_activation_stakeholder_live_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_stakeholder_live_approvals
    ADD CONSTRAINT controlled_activation_stakeholder_live_approvals_pkey PRIMARY KEY (id);


--
-- Name: controlled_live_canaries controlled_live_canaries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_live_canaries
    ADD CONSTRAINT controlled_live_canaries_pkey PRIMARY KEY (id);


--
-- Name: controlled_live_canary_audit_logs controlled_live_canary_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_live_canary_audit_logs
    ADD CONSTRAINT controlled_live_canary_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: controlled_live_canary_delivery_attempts controlled_live_canary_delivery_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_live_canary_delivery_attempts
    ADD CONSTRAINT controlled_live_canary_delivery_attempts_pkey PRIMARY KEY (id);


--
-- Name: controlled_live_canary_evidence_packs controlled_live_canary_evidence_packs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_live_canary_evidence_packs
    ADD CONSTRAINT controlled_live_canary_evidence_packs_pkey PRIMARY KEY (id);


--
-- Name: customer_consent_states customer_consent_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_consent_states
    ADD CONSTRAINT customer_consent_states_pkey PRIMARY KEY (id);


--
-- Name: customer_feature_snapshots customer_feature_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_feature_snapshots
    ADD CONSTRAINT customer_feature_snapshots_pkey PRIMARY KEY (id);


--
-- Name: customer_identity_links customer_identity_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_identity_links
    ADD CONSTRAINT customer_identity_links_pkey PRIMARY KEY (id);


--
-- Name: customer_lifecycle_snapshots customer_lifecycle_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_lifecycle_snapshots
    ADD CONSTRAINT customer_lifecycle_snapshots_pkey PRIMARY KEY (id);


--
-- Name: customer_preferences customer_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_preferences
    ADD CONSTRAINT customer_preferences_pkey PRIMARY KEY (id);


--
-- Name: customer_preferences customer_preferences_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_preferences
    ADD CONSTRAINT customer_preferences_user_id_unique UNIQUE (user_id);


--
-- Name: customer_profiles customer_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_profiles
    ADD CONSTRAINT customer_profiles_pkey PRIMARY KEY (canonical_customer_id);


--
-- Name: dealer_applications dealer_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dealer_applications
    ADD CONSTRAINT dealer_applications_pkey PRIMARY KEY (id);


--
-- Name: decision_assignments decision_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_assignments
    ADD CONSTRAINT decision_assignments_pkey PRIMARY KEY (id);


--
-- Name: decision_events decision_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_events
    ADD CONSTRAINT decision_events_pkey PRIMARY KEY (id);


--
-- Name: decision_evidence decision_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_evidence
    ADD CONSTRAINT decision_evidence_pkey PRIMARY KEY (id);


--
-- Name: decision_insights decision_insights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_insights
    ADD CONSTRAINT decision_insights_pkey PRIMARY KEY (id);


--
-- Name: decision_policies decision_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_policies
    ADD CONSTRAINT decision_policies_pkey PRIMARY KEY (id);


--
-- Name: decision_recommendations decision_recommendations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_recommendations
    ADD CONSTRAINT decision_recommendations_pkey PRIMARY KEY (id);


--
-- Name: delivery_zones delivery_zones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_zones
    ADD CONSTRAINT delivery_zones_pkey PRIMARY KEY (id);


--
-- Name: experiment_assignments experiment_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiment_assignments
    ADD CONSTRAINT experiment_assignments_pkey PRIMARY KEY (id);


--
-- Name: experiment_exposures experiment_exposures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiment_exposures
    ADD CONSTRAINT experiment_exposures_pkey PRIMARY KEY (id);


--
-- Name: experiment_variants experiment_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiment_variants
    ADD CONSTRAINT experiment_variants_pkey PRIMARY KEY (id);


--
-- Name: experiments experiments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiments
    ADD CONSTRAINT experiments_pkey PRIMARY KEY (id);


--
-- Name: fake_product_reports fake_product_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fake_product_reports
    ADD CONSTRAINT fake_product_reports_pkey PRIMARY KEY (id);


--
-- Name: first_party_identities first_party_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.first_party_identities
    ADD CONSTRAINT first_party_identities_pkey PRIMARY KEY (id);


--
-- Name: fraud_case_events fraud_case_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_case_events
    ADD CONSTRAINT fraud_case_events_pkey PRIMARY KEY (id);


--
-- Name: fraud_cases fraud_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_cases
    ADD CONSTRAINT fraud_cases_pkey PRIMARY KEY (id);


--
-- Name: fraud_signals fraud_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_signals
    ADD CONSTRAINT fraud_signals_pkey PRIMARY KEY (id);


--
-- Name: fulfilment_deliveries fulfilment_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fulfilment_deliveries
    ADD CONSTRAINT fulfilment_deliveries_pkey PRIMARY KEY (id);


--
-- Name: fulfilment_dispatches fulfilment_dispatches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fulfilment_dispatches
    ADD CONSTRAINT fulfilment_dispatches_pkey PRIMARY KEY (id);


--
-- Name: fulfilment_lines fulfilment_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fulfilment_lines
    ADD CONSTRAINT fulfilment_lines_pkey PRIMARY KEY (id);


--
-- Name: fulfilment_sla_events fulfilment_sla_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fulfilment_sla_events
    ADD CONSTRAINT fulfilment_sla_events_pkey PRIMARY KEY (id);


--
-- Name: fulfilment_tasks fulfilment_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fulfilment_tasks
    ADD CONSTRAINT fulfilment_tasks_pkey PRIMARY KEY (id);


--
-- Name: fulfilment_team_members fulfilment_team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fulfilment_team_members
    ADD CONSTRAINT fulfilment_team_members_pkey PRIMARY KEY (id);


--
-- Name: fulfilment_teams fulfilment_teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fulfilment_teams
    ADD CONSTRAINT fulfilment_teams_pkey PRIMARY KEY (id);


--
-- Name: identity_links identity_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_links
    ADD CONSTRAINT identity_links_pkey PRIMARY KEY (id);


--
-- Name: inventory_reservations inventory_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_reservations
    ADD CONSTRAINT inventory_reservations_pkey PRIMARY KEY (id);


--
-- Name: legacy_preference_mappings legacy_preference_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legacy_preference_mappings
    ADD CONSTRAINT legacy_preference_mappings_pkey PRIMARY KEY (id);


--
-- Name: loyalty_accounts loyalty_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_accounts
    ADD CONSTRAINT loyalty_accounts_pkey PRIMARY KEY (id);


--
-- Name: loyalty_config loyalty_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_config
    ADD CONSTRAINT loyalty_config_pkey PRIMARY KEY (id);


--
-- Name: loyalty_ledger_entries loyalty_ledger_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_ledger_entries
    ADD CONSTRAINT loyalty_ledger_entries_pkey PRIMARY KEY (id);


--
-- Name: measurement_admin_permissions measurement_admin_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_admin_permissions
    ADD CONSTRAINT measurement_admin_permissions_pkey PRIMARY KEY (id);


--
-- Name: measurement_admin_roles measurement_admin_roles_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_admin_roles
    ADD CONSTRAINT measurement_admin_roles_name_unique UNIQUE (name);


--
-- Name: measurement_admin_roles measurement_admin_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_admin_roles
    ADD CONSTRAINT measurement_admin_roles_pkey PRIMARY KEY (id);


--
-- Name: measurement_api_failures measurement_api_failures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_api_failures
    ADD CONSTRAINT measurement_api_failures_pkey PRIMARY KEY (id);


--
-- Name: measurement_audit_logs measurement_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_audit_logs
    ADD CONSTRAINT measurement_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: measurement_campaign_attribution measurement_campaign_attribution_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_campaign_attribution
    ADD CONSTRAINT measurement_campaign_attribution_pkey PRIMARY KEY (id);


--
-- Name: measurement_control_tower_audit_log measurement_control_tower_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_control_tower_audit_log
    ADD CONSTRAINT measurement_control_tower_audit_log_pkey PRIMARY KEY (id);


--
-- Name: measurement_dashboard_metrics measurement_dashboard_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_dashboard_metrics
    ADD CONSTRAINT measurement_dashboard_metrics_pkey PRIMARY KEY (id);


--
-- Name: measurement_data_quality_alerts measurement_data_quality_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_data_quality_alerts
    ADD CONSTRAINT measurement_data_quality_alerts_pkey PRIMARY KEY (id);


--
-- Name: measurement_data_quality_rules measurement_data_quality_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_data_quality_rules
    ADD CONSTRAINT measurement_data_quality_rules_pkey PRIMARY KEY (id);


--
-- Name: measurement_dead_letter_events measurement_dead_letter_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_dead_letter_events
    ADD CONSTRAINT measurement_dead_letter_events_pkey PRIMARY KEY (id);


--
-- Name: measurement_destination_delivery_logs measurement_destination_delivery_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_destination_delivery_logs
    ADD CONSTRAINT measurement_destination_delivery_logs_pkey PRIMARY KEY (id);


--
-- Name: measurement_destination_routes measurement_destination_routes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_destination_routes
    ADD CONSTRAINT measurement_destination_routes_pkey PRIMARY KEY (id);


--
-- Name: measurement_destinations measurement_destinations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_destinations
    ADD CONSTRAINT measurement_destinations_pkey PRIMARY KEY (id);


--
-- Name: measurement_gtm_accounts measurement_gtm_accounts_account_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_gtm_accounts
    ADD CONSTRAINT measurement_gtm_accounts_account_id_unique UNIQUE (account_id);


--
-- Name: measurement_gtm_accounts measurement_gtm_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_gtm_accounts
    ADD CONSTRAINT measurement_gtm_accounts_pkey PRIMARY KEY (id);


--
-- Name: measurement_gtm_containers measurement_gtm_containers_container_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_gtm_containers
    ADD CONSTRAINT measurement_gtm_containers_container_id_unique UNIQUE (container_id);


--
-- Name: measurement_gtm_containers measurement_gtm_containers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_gtm_containers
    ADD CONSTRAINT measurement_gtm_containers_pkey PRIMARY KEY (id);


--
-- Name: measurement_gtm_sync_logs measurement_gtm_sync_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_gtm_sync_logs
    ADD CONSTRAINT measurement_gtm_sync_logs_pkey PRIMARY KEY (id);


--
-- Name: measurement_gtm_versions measurement_gtm_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_gtm_versions
    ADD CONSTRAINT measurement_gtm_versions_pkey PRIMARY KEY (id);


--
-- Name: measurement_gtm_versions measurement_gtm_versions_version_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_gtm_versions
    ADD CONSTRAINT measurement_gtm_versions_version_id_unique UNIQUE (version_id);


--
-- Name: measurement_gtm_workspaces measurement_gtm_workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_gtm_workspaces
    ADD CONSTRAINT measurement_gtm_workspaces_pkey PRIMARY KEY (id);


--
-- Name: measurement_gtm_workspaces measurement_gtm_workspaces_workspace_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_gtm_workspaces
    ADD CONSTRAINT measurement_gtm_workspaces_workspace_id_unique UNIQUE (workspace_id);


--
-- Name: measurement_incidents measurement_incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_incidents
    ADD CONSTRAINT measurement_incidents_pkey PRIMARY KEY (id);


--
-- Name: measurement_paid_social_delivery_logs measurement_paid_social_delivery_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_paid_social_delivery_logs
    ADD CONSTRAINT measurement_paid_social_delivery_logs_pkey PRIMARY KEY (id);


--
-- Name: measurement_paid_social_destinations measurement_paid_social_destinations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_paid_social_destinations
    ADD CONSTRAINT measurement_paid_social_destinations_pkey PRIMARY KEY (id);


--
-- Name: measurement_paid_social_event_mappings measurement_paid_social_event_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_paid_social_event_mappings
    ADD CONSTRAINT measurement_paid_social_event_mappings_pkey PRIMARY KEY (id);


--
-- Name: measurement_qa_results measurement_qa_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_qa_results
    ADD CONSTRAINT measurement_qa_results_pkey PRIMARY KEY (id);


--
-- Name: measurement_qa_tests measurement_qa_tests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_qa_tests
    ADD CONSTRAINT measurement_qa_tests_pkey PRIMARY KEY (id);


--
-- Name: measurement_release_approvals measurement_release_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_release_approvals
    ADD CONSTRAINT measurement_release_approvals_pkey PRIMARY KEY (id);


--
-- Name: measurement_release_requests measurement_release_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_release_requests
    ADD CONSTRAINT measurement_release_requests_pkey PRIMARY KEY (id);


--
-- Name: measurement_vendor_registry measurement_vendor_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_vendor_registry
    ADD CONSTRAINT measurement_vendor_registry_pkey PRIMARY KEY (id);


--
-- Name: module_activation_approvals module_activation_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.module_activation_approvals
    ADD CONSTRAINT module_activation_approvals_pkey PRIMARY KEY (id);


--
-- Name: nba_candidates nba_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nba_candidates
    ADD CONSTRAINT nba_candidates_pkey PRIMARY KEY (id);


--
-- Name: nba_decisions nba_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nba_decisions
    ADD CONSTRAINT nba_decisions_pkey PRIMARY KEY (id);


--
-- Name: notification_attempts notification_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_attempts
    ADD CONSTRAINT notification_attempts_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: orders orders_order_number_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_order_number_unique UNIQUE (order_number);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: outbox_events outbox_events_idempotency_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_events
    ADD CONSTRAINT outbox_events_idempotency_key_unique UNIQUE (idempotency_key);


--
-- Name: outbox_events outbox_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_events
    ADD CONSTRAINT outbox_events_pkey PRIMARY KEY (id);


--
-- Name: packing_sessions packing_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packing_sessions
    ADD CONSTRAINT packing_sessions_pkey PRIMARY KEY (id);


--
-- Name: payment_attempts payment_attempts_merchant_reference_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_attempts
    ADD CONSTRAINT payment_attempts_merchant_reference_unique UNIQUE (merchant_reference);


--
-- Name: payment_attempts payment_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_attempts
    ADD CONSTRAINT payment_attempts_pkey PRIMARY KEY (id);


--
-- Name: payment_measurement_reconciliations payment_measurement_reconciliations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_measurement_reconciliations
    ADD CONSTRAINT payment_measurement_reconciliations_pkey PRIMARY KEY (id);


--
-- Name: payments payments_idempotency_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_idempotency_key_unique UNIQUE (idempotency_key);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: pim_import_approvals pim_import_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pim_import_approvals
    ADD CONSTRAINT pim_import_approvals_pkey PRIMARY KEY (id);


--
-- Name: pim_import_events pim_import_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pim_import_events
    ADD CONSTRAINT pim_import_events_pkey PRIMARY KEY (id);


--
-- Name: pim_import_rows pim_import_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pim_import_rows
    ADD CONSTRAINT pim_import_rows_pkey PRIMARY KEY (id);


--
-- Name: pim_import_sessions pim_import_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pim_import_sessions
    ADD CONSTRAINT pim_import_sessions_pkey PRIMARY KEY (id);


--
-- Name: preference_audit_log preference_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preference_audit_log
    ADD CONSTRAINT preference_audit_log_pkey PRIMARY KEY (id);


--
-- Name: pricing_adjustments pricing_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_adjustments
    ADD CONSTRAINT pricing_adjustments_pkey PRIMARY KEY (id);


--
-- Name: pricing_quote_lines pricing_quote_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_quote_lines
    ADD CONSTRAINT pricing_quote_lines_pkey PRIMARY KEY (id);


--
-- Name: pricing_quotes pricing_quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_quotes
    ADD CONSTRAINT pricing_quotes_pkey PRIMARY KEY (id);


--
-- Name: product_attribute_values product_attribute_values_product_id_attribute_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_attribute_values
    ADD CONSTRAINT product_attribute_values_product_id_attribute_id_pk PRIMARY KEY (product_id, attribute_id);


--
-- Name: product_compatibility_mappings product_compatibility_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_compatibility_mappings
    ADD CONSTRAINT product_compatibility_mappings_pkey PRIMARY KEY (id);


--
-- Name: product_feed_items product_feed_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_feed_items
    ADD CONSTRAINT product_feed_items_pkey PRIMARY KEY (id);


--
-- Name: product_feeds product_feeds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_feeds
    ADD CONSTRAINT product_feeds_pkey PRIMARY KEY (id);


--
-- Name: product_finder_sessions product_finder_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_finder_sessions
    ADD CONSTRAINT product_finder_sessions_pkey PRIMARY KEY (id);


--
-- Name: product_images product_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_pkey PRIMARY KEY (id);


--
-- Name: product_prices product_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_prices
    ADD CONSTRAINT product_prices_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: products products_sku_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_sku_unique UNIQUE (sku);


--
-- Name: products products_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_slug_unique UNIQUE (slug);


--
-- Name: promotion_approvals promotion_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_approvals
    ADD CONSTRAINT promotion_approvals_pkey PRIMARY KEY (id);


--
-- Name: promotion_definitions promotion_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_definitions
    ADD CONSTRAINT promotion_definitions_pkey PRIMARY KEY (id);


--
-- Name: promotion_redemptions promotion_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_redemptions
    ADD CONSTRAINT promotion_redemptions_pkey PRIMARY KEY (id);


--
-- Name: promotion_reservations promotion_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_reservations
    ADD CONSTRAINT promotion_reservations_pkey PRIMARY KEY (id);


--
-- Name: promotion_versions promotion_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_versions
    ADD CONSTRAINT promotion_versions_pkey PRIMARY KEY (id);


--
-- Name: provider_unsubscribe_events provider_unsubscribe_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_unsubscribe_events
    ADD CONSTRAINT provider_unsubscribe_events_pkey PRIMARY KEY (id);


--
-- Name: purchase_measurement_events purchase_measurement_events_event_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_measurement_events
    ADD CONSTRAINT purchase_measurement_events_event_id_unique UNIQUE (event_id);


--
-- Name: purchase_measurement_events purchase_measurement_events_idempotency_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_measurement_events
    ADD CONSTRAINT purchase_measurement_events_idempotency_key_unique UNIQUE (idempotency_key);


--
-- Name: purchase_measurement_events purchase_measurement_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_measurement_events
    ADD CONSTRAINT purchase_measurement_events_pkey PRIMARY KEY (id);


--
-- Name: quote_requests quote_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_requests
    ADD CONSTRAINT quote_requests_pkey PRIMARY KEY (id);


--
-- Name: recommendation_events recommendation_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_events
    ADD CONSTRAINT recommendation_events_pkey PRIMARY KEY (id);


--
-- Name: recommendation_materialized_cache recommendation_materialized_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_materialized_cache
    ADD CONSTRAINT recommendation_materialized_cache_pkey PRIMARY KEY (id);


--
-- Name: recommendation_rule_audit_logs recommendation_rule_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_rule_audit_logs
    ADD CONSTRAINT recommendation_rule_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: recommendation_rules recommendation_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_rules
    ADD CONSTRAINT recommendation_rules_pkey PRIMARY KEY (id);


--
-- Name: release_decisions release_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_decisions
    ADD CONSTRAINT release_decisions_pkey PRIMARY KEY (id);


--
-- Name: release_readiness_audit_log release_readiness_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_readiness_audit_log
    ADD CONSTRAINT release_readiness_audit_log_pkey PRIMARY KEY (id);


--
-- Name: release_readiness_gate_results release_readiness_gate_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_readiness_gate_results
    ADD CONSTRAINT release_readiness_gate_results_pkey PRIMARY KEY (id);


--
-- Name: release_readiness_runs release_readiness_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_readiness_runs
    ADD CONSTRAINT release_readiness_runs_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_role_id_permission_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_permission_id_pk PRIMARY KEY (role_id, permission_id);


--
-- Name: roles roles_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_unique UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: search_demand_signals search_demand_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_demand_signals
    ADD CONSTRAINT search_demand_signals_pkey PRIMARY KEY (id);


--
-- Name: search_product_insights search_product_insights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_product_insights
    ADD CONSTRAINT search_product_insights_pkey PRIMARY KEY (id);


--
-- Name: support_assisted_preference_requests support_assisted_preference_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_assisted_preference_requests
    ADD CONSTRAINT support_assisted_preference_requests_pkey PRIMARY KEY (id);


--
-- Name: support_issues support_issues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_issues
    ADD CONSTRAINT support_issues_pkey PRIMARY KEY (id);


--
-- Name: survey_definitions survey_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_definitions
    ADD CONSTRAINT survey_definitions_pkey PRIMARY KEY (id);


--
-- Name: survey_events survey_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_events
    ADD CONSTRAINT survey_events_pkey PRIMARY KEY (id);


--
-- Name: survey_responses survey_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_responses
    ADD CONSTRAINT survey_responses_pkey PRIMARY KEY (id);


--
-- Name: survey_versions survey_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_versions
    ADD CONSTRAINT survey_versions_pkey PRIMARY KEY (id);


--
-- Name: telemetry_dlq telemetry_dlq_event_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_dlq
    ADD CONSTRAINT telemetry_dlq_event_id_unique UNIQUE (event_id);


--
-- Name: telemetry_dlq telemetry_dlq_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_dlq
    ADD CONSTRAINT telemetry_dlq_pkey PRIMARY KEY (id);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_phone_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_phone_unique UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: utm_links utm_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.utm_links
    ADD CONSTRAINT utm_links_pkey PRIMARY KEY (id);


--
-- Name: utm_links utm_links_short_url_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.utm_links
    ADD CONSTRAINT utm_links_short_url_unique UNIQUE (short_url);


--
-- Name: verification_attempts verification_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_attempts
    ADD CONSTRAINT verification_attempts_pkey PRIMARY KEY (id);


--
-- Name: verification_codes verification_codes_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_codes
    ADD CONSTRAINT verification_codes_code_unique UNIQUE (code);


--
-- Name: verification_codes verification_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_codes
    ADD CONSTRAINT verification_codes_pkey PRIMARY KEY (id);


--
-- Name: wishlists wishlists_user_id_product_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wishlists
    ADD CONSTRAINT wishlists_user_id_product_id_pk PRIMARY KEY (user_id, product_id);


--
-- Name: zero_party_signals zero_party_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zero_party_signals
    ADD CONSTRAINT zero_party_signals_pkey PRIMARY KEY (id);


--
-- Name: attribution_event_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attribution_event_name_idx ON public.attribution_touchpoints USING btree (event_name);


--
-- Name: attribution_event_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attribution_event_time_idx ON public.attribution_touchpoints USING btree (event_time);


--
-- Name: attribution_fp_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attribution_fp_client_idx ON public.attribution_touchpoints USING btree (fp_client_id);


--
-- Name: attribution_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attribution_order_idx ON public.attribution_touchpoints USING btree (order_id);


--
-- Name: attribution_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attribution_user_idx ON public.attribution_touchpoints USING btree (user_id);


--
-- Name: automation_action_executions_dead_letter_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_action_executions_dead_letter_idx ON public.automation_action_executions USING btree (dead_lettered_at);


--
-- Name: automation_action_executions_execution_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_action_executions_execution_idx ON public.automation_action_executions USING btree (execution_id);


--
-- Name: automation_action_executions_idem_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX automation_action_executions_idem_idx ON public.automation_action_executions USING btree (idempotency_key);


--
-- Name: automation_action_executions_status_retry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_action_executions_status_retry_idx ON public.automation_action_executions USING btree (status, next_retry_at);


--
-- Name: automation_approvals_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_approvals_version_idx ON public.automation_approvals USING btree (version_id);


--
-- Name: automation_definitions_next_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_definitions_next_run_idx ON public.automation_definitions USING btree (next_run_at);


--
-- Name: automation_definitions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_definitions_status_idx ON public.automation_definitions USING btree (status);


--
-- Name: automation_events_definition_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_events_definition_idx ON public.automation_events USING btree (definition_id);


--
-- Name: automation_events_execution_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_events_execution_idx ON public.automation_events USING btree (execution_id);


--
-- Name: automation_executions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_executions_status_idx ON public.automation_executions USING btree (status);


--
-- Name: automation_executions_subject_window_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_executions_subject_window_idx ON public.automation_executions USING btree (subject_id, window_key);


--
-- Name: automation_executions_trigger_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX automation_executions_trigger_key_idx ON public.automation_executions USING btree (trigger_execution_key);


--
-- Name: automation_frequency_cap_reservations_execution_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX automation_frequency_cap_reservations_execution_idx ON public.automation_frequency_cap_reservations USING btree (execution_id);


--
-- Name: automation_frequency_cap_reservations_scope_window_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_frequency_cap_reservations_scope_window_idx ON public.automation_frequency_cap_reservations USING btree (version_id, subject_scope, window_key);


--
-- Name: automation_suppressions_execution_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_suppressions_execution_idx ON public.automation_suppressions USING btree (execution_id);


--
-- Name: automation_suppressions_reason_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_suppressions_reason_idx ON public.automation_suppressions USING btree (reason);


--
-- Name: automation_versions_def_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX automation_versions_def_version_idx ON public.automation_versions USING btree (definition_id, version_number);


--
-- Name: behavioural_intervention_definitions_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX behavioural_intervention_definitions_key_idx ON public.behavioural_intervention_definitions USING btree (key);


--
-- Name: behavioural_intervention_definitions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX behavioural_intervention_definitions_status_idx ON public.behavioural_intervention_definitions USING btree (status, updated_at);


--
-- Name: behavioural_intervention_events_definition_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX behavioural_intervention_events_definition_idx ON public.behavioural_intervention_events USING btree (definition_id, created_at);


--
-- Name: behavioural_intervention_exposures_delivery_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX behavioural_intervention_exposures_delivery_idx ON public.behavioural_intervention_exposures USING btree (definition_id, delivery_key);


--
-- Name: behavioural_intervention_exposures_participant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX behavioural_intervention_exposures_participant_idx ON public.behavioural_intervention_exposures USING btree (definition_id, participant_ref_hash, occurred_at);


--
-- Name: behavioural_intervention_outcomes_exposure_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX behavioural_intervention_outcomes_exposure_idx ON public.behavioural_intervention_outcomes USING btree (exposure_id, occurred_at);


--
-- Name: behavioural_intervention_outcomes_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX behavioural_intervention_outcomes_key_idx ON public.behavioural_intervention_outcomes USING btree (definition_id, outcome_key);


--
-- Name: behavioural_intervention_versions_definition_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX behavioural_intervention_versions_definition_version_idx ON public.behavioural_intervention_versions USING btree (definition_id, version_number);


--
-- Name: behavioural_intervention_versions_digest_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX behavioural_intervention_versions_digest_idx ON public.behavioural_intervention_versions USING btree (definition_id, content_digest);


--
-- Name: behavioural_intervention_versions_experiment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX behavioural_intervention_versions_experiment_idx ON public.behavioural_intervention_versions USING btree (experiment_id);


--
-- Name: campaign_attr_fp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaign_attr_fp_idx ON public.measurement_campaign_attribution USING btree (fp_client_id);


--
-- Name: campaign_attr_src_med_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaign_attr_src_med_idx ON public.measurement_campaign_attribution USING btree (utm_source, utm_medium);


--
-- Name: campaign_attr_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaign_attr_user_idx ON public.measurement_campaign_attribution USING btree (user_id);


--
-- Name: carts_anonymous_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX carts_anonymous_idx ON public.carts USING btree (anonymous_id);


--
-- Name: carts_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX carts_session_idx ON public.carts USING btree (session_id);


--
-- Name: channel_suppressions_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX channel_suppressions_active_idx ON public.channel_suppressions USING btree (endpoint_ref, channel_key, purpose_key, suppression_active);


--
-- Name: channel_suppressions_provider_callback_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX channel_suppressions_provider_callback_idx ON public.channel_suppressions USING btree (provider_callback_ref);


--
-- Name: compat_pair_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX compat_pair_idx ON public.product_compatibility_mappings USING btree (product_id, target_product_id);


--
-- Name: compat_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compat_product_idx ON public.product_compatibility_mappings USING btree (product_id);


--
-- Name: consent_channels_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consent_channels_active_idx ON public.consent_channels USING btree (channel_key, effective_at, expires_at);


--
-- Name: consent_channels_key_version_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX consent_channels_key_version_uidx ON public.consent_channels USING btree (channel_key, policy_version);


--
-- Name: consent_copy_versions_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consent_copy_versions_hash_idx ON public.consent_copy_versions USING btree (content_hash);


--
-- Name: consent_copy_versions_purpose_channel_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consent_copy_versions_purpose_channel_idx ON public.consent_copy_versions USING btree (purpose_key, channel_key);


--
-- Name: consent_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consent_created_at_idx ON public.consent_records USING btree (created_at);


--
-- Name: consent_events_aggregate_audit_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consent_events_aggregate_audit_idx ON public.consent_events USING btree (customer_identity_ref, purpose_key, channel_key, effective_at);


--
-- Name: consent_events_correlation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consent_events_correlation_idx ON public.consent_events USING btree (correlation_id);


--
-- Name: consent_events_provider_callback_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consent_events_provider_callback_idx ON public.consent_events USING btree (provider_callback_ref);


--
-- Name: consent_fp_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consent_fp_client_idx ON public.consent_records USING btree (fp_client_id);


--
-- Name: consent_policy_blocks_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consent_policy_blocks_active_idx ON public.consent_policy_blocks USING btree (customer_identity_ref, purpose_key, channel_key, expires_at);


--
-- Name: consent_policy_blocks_cohort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consent_policy_blocks_cohort_idx ON public.consent_policy_blocks USING btree (cohort_ref, purpose_key);


--
-- Name: consent_purposes_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consent_purposes_active_idx ON public.consent_purposes USING btree (purpose_key, effective_at, expires_at);


--
-- Name: consent_purposes_key_version_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX consent_purposes_key_version_uidx ON public.consent_purposes USING btree (purpose_key, policy_version);


--
-- Name: consent_source_surfaces_authority_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consent_source_surfaces_authority_idx ON public.consent_source_surfaces USING btree (authority_class, verification_floor);


--
-- Name: consent_source_surfaces_source_version_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX consent_source_surfaces_source_version_uidx ON public.consent_source_surfaces USING btree (source_surface, policy_version);


--
-- Name: consent_state_fp_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consent_state_fp_client_idx ON public.consent_current_state USING btree (fp_client_id);


--
-- Name: consent_state_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consent_state_user_idx ON public.consent_current_state USING btree (user_id);


--
-- Name: consent_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consent_user_idx ON public.consent_records USING btree (user_id);


--
-- Name: customer_consent_states_aggregate_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customer_consent_states_aggregate_uidx ON public.customer_consent_states USING btree (customer_identity_ref, endpoint_ref, purpose_key, channel_key);


--
-- Name: customer_consent_states_identity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_consent_states_identity_idx ON public.customer_consent_states USING btree (customer_identity_ref, purpose_key);


--
-- Name: customer_consent_states_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_consent_states_state_idx ON public.customer_consent_states USING btree (state, expires_at);


--
-- Name: customer_feature_snapshots_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customer_feature_snapshots_version_idx ON public.customer_feature_snapshots USING btree (canonical_customer_id, source_version);


--
-- Name: customer_identity_links_canonical_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_identity_links_canonical_idx ON public.customer_identity_links USING btree (canonical_customer_id);


--
-- Name: customer_identity_links_signal_identifier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customer_identity_links_signal_identifier_idx ON public.customer_identity_links USING btree (signal_type, identifier_key);


--
-- Name: customer_lifecycle_snapshots_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customer_lifecycle_snapshots_version_idx ON public.customer_lifecycle_snapshots USING btree (canonical_customer_id, source_version, policy_version);


--
-- Name: customer_profiles_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_profiles_account_idx ON public.customer_profiles USING btree (account_user_id);


--
-- Name: customer_profiles_lifecycle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_profiles_lifecycle_idx ON public.customer_profiles USING btree (primary_lifecycle_stage);


--
-- Name: dash_metric_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dash_metric_time_idx ON public.measurement_dashboard_metrics USING btree (metric_name, "timestamp");


--
-- Name: dealer_applications_anonymous_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dealer_applications_anonymous_idx ON public.dealer_applications USING btree (anonymous_id);


--
-- Name: dealer_applications_attribution_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dealer_applications_attribution_idx ON public.dealer_applications USING btree (attribution_id);


--
-- Name: dealer_applications_browser_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dealer_applications_browser_idx ON public.dealer_applications USING btree (browser_id);


--
-- Name: dealer_applications_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dealer_applications_session_idx ON public.dealer_applications USING btree (session_id);


--
-- Name: decision_assignments_insight_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX decision_assignments_insight_idx ON public.decision_assignments USING btree (insight_id);


--
-- Name: decision_events_insight_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX decision_events_insight_idx ON public.decision_events USING btree (insight_id);


--
-- Name: decision_evidence_insight_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX decision_evidence_insight_idx ON public.decision_evidence USING btree (insight_id);


--
-- Name: decision_insights_assigned_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX decision_insights_assigned_idx ON public.decision_insights USING btree (assigned_to);


--
-- Name: decision_insights_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX decision_insights_category_idx ON public.decision_insights USING btree (category);


--
-- Name: decision_insights_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX decision_insights_key_idx ON public.decision_insights USING btree (idempotency_key);


--
-- Name: decision_insights_severity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX decision_insights_severity_idx ON public.decision_insights USING btree (severity);


--
-- Name: decision_insights_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX decision_insights_status_idx ON public.decision_insights USING btree (status);


--
-- Name: decision_policies_signal_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX decision_policies_signal_version_idx ON public.decision_policies USING btree (signal_type, policy_version);


--
-- Name: decision_recommendations_insight_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX decision_recommendations_insight_idx ON public.decision_recommendations USING btree (insight_id);


--
-- Name: delivery_zones_district_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX delivery_zones_district_idx ON public.delivery_zones USING btree (district);


--
-- Name: dest_log_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dest_log_event_idx ON public.measurement_destination_delivery_logs USING btree (event_id);


--
-- Name: dest_log_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dest_log_status_idx ON public.measurement_destination_delivery_logs USING btree (delivery_status);


--
-- Name: experiment_assignments_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX experiment_assignments_subject_idx ON public.experiment_assignments USING btree (experiment_id, subject_hash);


--
-- Name: experiment_assignments_variant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX experiment_assignments_variant_idx ON public.experiment_assignments USING btree (experiment_id, variant_key);


--
-- Name: experiment_exposures_experiment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX experiment_exposures_experiment_idx ON public.experiment_exposures USING btree (experiment_id, occurred_at);


--
-- Name: experiment_exposures_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX experiment_exposures_key_idx ON public.experiment_exposures USING btree (experiment_id, exposure_key);


--
-- Name: experiment_variants_experiment_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX experiment_variants_experiment_key_idx ON public.experiment_variants USING btree (experiment_id, key);


--
-- Name: experiments_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX experiments_key_idx ON public.experiments USING btree (key);


--
-- Name: experiments_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX experiments_status_idx ON public.experiments USING btree (status);


--
-- Name: fraud_case_events_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fraud_case_events_case_idx ON public.fraud_case_events USING btree (case_id, created_at);


--
-- Name: fraud_cases_assignee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fraud_cases_assignee_idx ON public.fraud_cases USING btree (assigned_to, status);


--
-- Name: fraud_cases_queue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fraud_cases_queue_idx ON public.fraud_cases USING btree (status, priority, created_at);


--
-- Name: fraud_cases_reference_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fraud_cases_reference_idx ON public.fraud_cases USING btree (reference_key);


--
-- Name: fraud_signals_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fraud_signals_case_idx ON public.fraud_signals USING btree (case_id, created_at);


--
-- Name: fraud_signals_case_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fraud_signals_case_key_idx ON public.fraud_signals USING btree (case_id, signal_key);


--
-- Name: fulfilment_deliveries_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fulfilment_deliveries_order_idx ON public.fulfilment_deliveries USING btree (order_id);


--
-- Name: fulfilment_deliveries_outcome_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fulfilment_deliveries_outcome_idx ON public.fulfilment_deliveries USING btree (outcome);


--
-- Name: fulfilment_deliveries_task_attempt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fulfilment_deliveries_task_attempt_idx ON public.fulfilment_deliveries USING btree (fulfilment_task_id, attempt);


--
-- Name: fulfilment_dispatches_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fulfilment_dispatches_order_idx ON public.fulfilment_dispatches USING btree (order_id);


--
-- Name: fulfilment_dispatches_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fulfilment_dispatches_task_idx ON public.fulfilment_dispatches USING btree (fulfilment_task_id);


--
-- Name: fulfilment_lines_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fulfilment_lines_task_idx ON public.fulfilment_lines USING btree (fulfilment_task_id);


--
-- Name: fulfilment_lines_task_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fulfilment_lines_task_item_idx ON public.fulfilment_lines USING btree (fulfilment_task_id, order_item_id);


--
-- Name: fulfilment_sla_events_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fulfilment_sla_events_key_idx ON public.fulfilment_sla_events USING btree (idempotency_key);


--
-- Name: fulfilment_sla_events_stage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fulfilment_sla_events_stage_idx ON public.fulfilment_sla_events USING btree (stage);


--
-- Name: fulfilment_sla_events_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fulfilment_sla_events_task_idx ON public.fulfilment_sla_events USING btree (task_id);


--
-- Name: fulfilment_tasks_assigned_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fulfilment_tasks_assigned_idx ON public.fulfilment_tasks USING btree (assigned_to);


--
-- Name: fulfilment_tasks_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fulfilment_tasks_created_idx ON public.fulfilment_tasks USING btree (created_at);


--
-- Name: fulfilment_tasks_order_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fulfilment_tasks_order_id_idx ON public.fulfilment_tasks USING btree (order_id);


--
-- Name: fulfilment_tasks_sla_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fulfilment_tasks_sla_idx ON public.fulfilment_tasks USING btree (sla_due_at);


--
-- Name: fulfilment_tasks_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fulfilment_tasks_status_idx ON public.fulfilment_tasks USING btree (status);


--
-- Name: fulfilment_tasks_team_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fulfilment_tasks_team_idx ON public.fulfilment_tasks USING btree (team_id);


--
-- Name: fulfilment_team_members_team_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fulfilment_team_members_team_user_idx ON public.fulfilment_team_members USING btree (team_id, user_id);


--
-- Name: fulfilment_team_members_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fulfilment_team_members_user_idx ON public.fulfilment_team_members USING btree (user_id);


--
-- Name: fulfilment_teams_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fulfilment_teams_slug_idx ON public.fulfilment_teams USING btree (slug);


--
-- Name: identity_links_anonymous_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX identity_links_anonymous_idx ON public.identity_links USING btree (anonymous_id);


--
-- Name: identity_links_browser_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX identity_links_browser_idx ON public.identity_links USING btree (browser_id);


--
-- Name: identity_links_cart_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX identity_links_cart_idx ON public.identity_links USING btree (cart_id);


--
-- Name: identity_links_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX identity_links_customer_idx ON public.identity_links USING btree (customer_id);


--
-- Name: identity_links_email_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX identity_links_email_hash_idx ON public.identity_links USING btree (email_hash);


--
-- Name: identity_links_lead_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX identity_links_lead_idx ON public.identity_links USING btree (lead_id);


--
-- Name: identity_links_phone_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX identity_links_phone_hash_idx ON public.identity_links USING btree (phone_hash);


--
-- Name: identity_links_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX identity_links_session_idx ON public.identity_links USING btree (session_id);


--
-- Name: inventory_reservations_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_reservations_order_idx ON public.inventory_reservations USING btree (order_id);


--
-- Name: inventory_reservations_order_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_reservations_order_product_idx ON public.inventory_reservations USING btree (order_id, product_id);


--
-- Name: inventory_reservations_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_reservations_product_idx ON public.inventory_reservations USING btree (product_id);


--
-- Name: inventory_reservations_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_reservations_status_idx ON public.inventory_reservations USING btree (status);


--
-- Name: legacy_preference_mappings_review_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX legacy_preference_mappings_review_idx ON public.legacy_preference_mappings USING btree (review_status, mapping_outcome);


--
-- Name: legacy_preference_mappings_rule_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX legacy_preference_mappings_rule_uidx ON public.legacy_preference_mappings USING btree (mapping_version, legacy_system, legacy_field, legacy_value_class);


--
-- Name: loyalty_accounts_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX loyalty_accounts_user_idx ON public.loyalty_accounts USING btree (user_id);


--
-- Name: loyalty_ledger_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX loyalty_ledger_account_idx ON public.loyalty_ledger_entries USING btree (account_id);


--
-- Name: loyalty_ledger_expiry_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX loyalty_ledger_expiry_source_idx ON public.loyalty_ledger_entries USING btree (reversed_entry_id) WHERE ((type)::text = 'expiry'::text);


--
-- Name: loyalty_ledger_idem_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX loyalty_ledger_idem_idx ON public.loyalty_ledger_entries USING btree (idempotency_key);


--
-- Name: loyalty_ledger_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX loyalty_ledger_order_idx ON public.loyalty_ledger_entries USING btree (order_id);


--
-- Name: loyalty_ledger_reversal_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX loyalty_ledger_reversal_source_idx ON public.loyalty_ledger_entries USING btree (reversed_entry_id) WHERE ((type)::text = 'reversal'::text);


--
-- Name: module_activation_approvals_live_module_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX module_activation_approvals_live_module_idx ON public.module_activation_approvals USING btree (module_key) WHERE (revoked_at IS NULL);


--
-- Name: module_activation_approvals_module_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX module_activation_approvals_module_idx ON public.module_activation_approvals USING btree (module_key, revoked_at);


--
-- Name: nba_candidates_decision_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX nba_candidates_decision_idx ON public.nba_candidates USING btree (decision_id);


--
-- Name: nba_decisions_canonical_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX nba_decisions_canonical_idx ON public.nba_decisions USING btree (canonical_customer_id);


--
-- Name: nba_decisions_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX nba_decisions_key_idx ON public.nba_decisions USING btree (decision_key);


--
-- Name: orders_anonymous_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_anonymous_idx ON public.orders USING btree (anonymous_id);


--
-- Name: orders_attribution_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_attribution_idx ON public.orders USING btree (attribution_id);


--
-- Name: orders_browser_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_browser_idx ON public.orders USING btree (browser_id);


--
-- Name: orders_cart_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_cart_idx ON public.orders USING btree (cart_id);


--
-- Name: orders_client_order_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX orders_client_order_key_idx ON public.orders USING btree (client_order_key);


--
-- Name: orders_number_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_number_idx ON public.orders USING btree (order_number);


--
-- Name: orders_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_session_idx ON public.orders USING btree (session_id);


--
-- Name: outbox_events_event_type_processed_next_attempt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbox_events_event_type_processed_next_attempt_idx ON public.outbox_events USING btree (event_type, is_processed, next_attempt_at);


--
-- Name: outbox_events_is_processed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbox_events_is_processed_idx ON public.outbox_events USING btree (is_processed);


--
-- Name: outbox_events_next_attempt_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbox_events_next_attempt_at_idx ON public.outbox_events USING btree (next_attempt_at);


--
-- Name: packing_sessions_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX packing_sessions_task_idx ON public.packing_sessions USING btree (fulfilment_task_id);


--
-- Name: paid_social_log_dest_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX paid_social_log_dest_status_idx ON public.measurement_paid_social_delivery_logs USING btree (destination_id, delivery_status);


--
-- Name: paid_social_log_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX paid_social_log_event_idx ON public.measurement_paid_social_delivery_logs USING btree (event_id);


--
-- Name: payments_reference_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_reference_idx ON public.payment_attempts USING btree (merchant_reference);


--
-- Name: payments_tracking_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_tracking_idx ON public.payment_attempts USING btree (order_tracking_id);


--
-- Name: pim_import_approvals_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pim_import_approvals_session_idx ON public.pim_import_approvals USING btree (session_id, decided_at);


--
-- Name: pim_import_events_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pim_import_events_session_idx ON public.pim_import_events USING btree (session_id, created_at);


--
-- Name: pim_import_rows_session_row_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pim_import_rows_session_row_idx ON public.pim_import_rows USING btree (session_id, row_number);


--
-- Name: pim_import_rows_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pim_import_rows_status_idx ON public.pim_import_rows USING btree (session_id, status);


--
-- Name: pim_import_sessions_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pim_import_sessions_source_idx ON public.pim_import_sessions USING btree (source_sha256);


--
-- Name: pim_import_sessions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pim_import_sessions_status_idx ON public.pim_import_sessions USING btree (status, created_at);


--
-- Name: pme_idempotency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pme_idempotency_idx ON public.purchase_measurement_events USING btree (idempotency_key);


--
-- Name: pme_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pme_order_idx ON public.purchase_measurement_events USING btree (order_id);


--
-- Name: pmr_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pmr_order_idx ON public.payment_measurement_reconciliations USING btree (order_id);


--
-- Name: pmr_payment_ref_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pmr_payment_ref_idx ON public.payment_measurement_reconciliations USING btree (payment_reference);


--
-- Name: pmr_pesapal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pmr_pesapal_idx ON public.payment_measurement_reconciliations USING btree (pesapal_tracking_id);


--
-- Name: pref_audit_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pref_audit_user_idx ON public.preference_audit_log USING btree (user_id);


--
-- Name: pricing_adjustments_quote_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pricing_adjustments_quote_idx ON public.pricing_adjustments USING btree (quote_id, application_order);


--
-- Name: pricing_experiment_associations_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pricing_experiment_associations_idx ON public.pricing_experiment_associations USING btree (promotion_version_id, experiment_id, variant_key);


--
-- Name: pricing_quote_lines_quote_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pricing_quote_lines_quote_product_idx ON public.pricing_quote_lines USING btree (quote_id, product_id);


--
-- Name: pricing_quotes_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pricing_quotes_expiry_idx ON public.pricing_quotes USING btree (expires_at);


--
-- Name: product_finder_sessions_anonymous_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_finder_sessions_anonymous_idx ON public.product_finder_sessions USING btree (anonymous_id);


--
-- Name: product_finder_sessions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_finder_sessions_user_idx ON public.product_finder_sessions USING btree (user_id);


--
-- Name: promotion_approvals_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX promotion_approvals_version_idx ON public.promotion_approvals USING btree (version_id, decided_at);


--
-- Name: promotion_definitions_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX promotion_definitions_key_idx ON public.promotion_definitions USING btree (key);


--
-- Name: promotion_definitions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX promotion_definitions_status_idx ON public.promotion_definitions USING btree (status);


--
-- Name: promotion_redemptions_order_reservation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX promotion_redemptions_order_reservation_idx ON public.promotion_redemptions USING btree (order_id, reservation_id);


--
-- Name: promotion_redemptions_reservation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX promotion_redemptions_reservation_idx ON public.promotion_redemptions USING btree (reservation_id);


--
-- Name: promotion_reservations_capacity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX promotion_reservations_capacity_idx ON public.promotion_reservations USING btree (promotion_version_id, status, expires_at);


--
-- Name: promotion_reservations_coupon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX promotion_reservations_coupon_idx ON public.promotion_reservations USING btree (promotion_version_id, coupon_reference_hash, status);


--
-- Name: promotion_reservations_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX promotion_reservations_customer_idx ON public.promotion_reservations USING btree (promotion_version_id, customer_scope_hash, status);


--
-- Name: promotion_reservations_idempotency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX promotion_reservations_idempotency_idx ON public.promotion_reservations USING btree (idempotency_key, promotion_version_id);


--
-- Name: promotion_versions_coupon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX promotion_versions_coupon_idx ON public.promotion_versions USING btree (coupon_code);


--
-- Name: promotion_versions_definition_number_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX promotion_versions_definition_number_idx ON public.promotion_versions USING btree (definition_id, version_number);


--
-- Name: promotion_versions_status_window_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX promotion_versions_status_window_idx ON public.promotion_versions USING btree (status, starts_at, ends_at);


--
-- Name: provider_unsubscribe_events_provider_event_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX provider_unsubscribe_events_provider_event_uidx ON public.provider_unsubscribe_events USING btree (provider_key, provider_event_ref);


--
-- Name: provider_unsubscribe_events_suppression_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_unsubscribe_events_suppression_idx ON public.provider_unsubscribe_events USING btree (endpoint_ref, channel_key);


--
-- Name: quote_requests_anonymous_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quote_requests_anonymous_idx ON public.quote_requests USING btree (anonymous_id);


--
-- Name: quote_requests_attribution_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quote_requests_attribution_idx ON public.quote_requests USING btree (attribution_id);


--
-- Name: quote_requests_browser_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quote_requests_browser_idx ON public.quote_requests USING btree (browser_id);


--
-- Name: quote_requests_cart_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quote_requests_cart_idx ON public.quote_requests USING btree (cart_id);


--
-- Name: quote_requests_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quote_requests_session_idx ON public.quote_requests USING btree (session_id);


--
-- Name: rec_cache_placement_context_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rec_cache_placement_context_idx ON public.recommendation_materialized_cache USING btree (placement, context_key);


--
-- Name: recommendation_events_anonymous_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_events_anonymous_created_at_idx ON public.recommendation_events USING btree (anonymous_id, created_at);


--
-- Name: recommendation_events_anonymous_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_events_anonymous_id_idx ON public.recommendation_events USING btree (anonymous_id);


--
-- Name: recommendation_events_attribution_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_events_attribution_idx ON public.recommendation_events USING btree (attribution_id);


--
-- Name: recommendation_events_browser_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_events_browser_idx ON public.recommendation_events USING btree (browser_id);


--
-- Name: recommendation_events_cart_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_events_cart_idx ON public.recommendation_events USING btree (cart_id);


--
-- Name: recommendation_events_category_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_events_category_id_idx ON public.recommendation_events USING btree (category_id);


--
-- Name: recommendation_events_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_events_created_at_idx ON public.recommendation_events USING btree (created_at);


--
-- Name: recommendation_events_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_events_customer_id_idx ON public.recommendation_events USING btree (customer_id);


--
-- Name: recommendation_events_event_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_events_event_type_idx ON public.recommendation_events USING btree (event_type);


--
-- Name: recommendation_events_impression_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_events_impression_idx ON public.recommendation_events USING btree (impression_id);


--
-- Name: recommendation_events_lead_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_events_lead_idx ON public.recommendation_events USING btree (lead_id);


--
-- Name: recommendation_events_placement_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_events_placement_idx ON public.recommendation_events USING btree (placement);


--
-- Name: recommendation_events_product_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_events_product_created_at_idx ON public.recommendation_events USING btree (product_id, created_at);


--
-- Name: recommendation_events_product_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_events_product_id_idx ON public.recommendation_events USING btree (product_id);


--
-- Name: recommendation_events_rail_render_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_events_rail_render_idx ON public.recommendation_events USING btree (rail_render_id);


--
-- Name: recommendation_events_recommendation_product_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_events_recommendation_product_created_at_idx ON public.recommendation_events USING btree (recommendation_product_id, created_at);


--
-- Name: recommendation_events_rule_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_events_rule_idx ON public.recommendation_events USING btree (rule_id);


--
-- Name: recommendation_events_type_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_events_type_created_at_idx ON public.recommendation_events USING btree (event_type, created_at);


--
-- Name: recommendation_events_utm_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_events_utm_source_idx ON public.recommendation_events USING btree (utm_source);


--
-- Name: recommendation_rule_audit_logs_action_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_rule_audit_logs_action_idx ON public.recommendation_rule_audit_logs USING btree (action);


--
-- Name: recommendation_rule_audit_logs_performed_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_rule_audit_logs_performed_at_idx ON public.recommendation_rule_audit_logs USING btree (performed_at);


--
-- Name: recommendation_rule_audit_logs_performed_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_rule_audit_logs_performed_by_idx ON public.recommendation_rule_audit_logs USING btree (performed_by);


--
-- Name: recommendation_rule_audit_logs_rule_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_rule_audit_logs_rule_id_idx ON public.recommendation_rule_audit_logs USING btree (rule_id);


--
-- Name: recommendation_rules_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_rules_created_at_idx ON public.recommendation_rules USING btree (created_at);


--
-- Name: recommendation_rules_ends_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_rules_ends_at_idx ON public.recommendation_rules USING btree (ends_at);


--
-- Name: recommendation_rules_placement_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_rules_placement_idx ON public.recommendation_rules USING btree (placement);


--
-- Name: recommendation_rules_placement_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_rules_placement_status_idx ON public.recommendation_rules USING btree (placement, status);


--
-- Name: recommendation_rules_placement_status_priority_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_rules_placement_status_priority_idx ON public.recommendation_rules USING btree (placement, status, priority);


--
-- Name: recommendation_rules_priority_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_rules_priority_idx ON public.recommendation_rules USING btree (priority);


--
-- Name: recommendation_rules_starts_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_rules_starts_at_idx ON public.recommendation_rules USING btree (starts_at);


--
-- Name: recommendation_rules_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_rules_status_idx ON public.recommendation_rules USING btree (status);


--
-- Name: recommendation_rules_target_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_rules_target_type_idx ON public.recommendation_rules USING btree (target_type);


--
-- Name: recommendation_rules_target_type_value_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_rules_target_type_value_idx ON public.recommendation_rules USING btree (target_type, target_value);


--
-- Name: recommendation_rules_target_value_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_rules_target_value_idx ON public.recommendation_rules USING btree (target_value);


--
-- Name: recommendation_rules_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_rules_type_idx ON public.recommendation_rules USING btree (type);


--
-- Name: search_demand_query_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX search_demand_query_idx ON public.search_demand_signals USING btree (query);


--
-- Name: search_demand_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_demand_status_idx ON public.search_demand_signals USING btree (status);


--
-- Name: search_product_insight_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_product_insight_product_idx ON public.search_product_insights USING btree (product_id);


--
-- Name: search_product_insight_query_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX search_product_insight_query_product_idx ON public.search_product_insights USING btree (query, product_id);


--
-- Name: support_assisted_preference_requests_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_assisted_preference_requests_pending_idx ON public.support_assisted_preference_requests USING btree (customer_identity_ref, verification_status, expires_at);


--
-- Name: support_assisted_preference_requests_ticket_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_assisted_preference_requests_ticket_idx ON public.support_assisted_preference_requests USING btree (support_ticket_ref);


--
-- Name: survey_definitions_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX survey_definitions_key_idx ON public.survey_definitions USING btree (key);


--
-- Name: survey_definitions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX survey_definitions_status_idx ON public.survey_definitions USING btree (status, updated_at);


--
-- Name: survey_events_definition_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX survey_events_definition_idx ON public.survey_events USING btree (definition_id, created_at);


--
-- Name: survey_responses_definition_participant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX survey_responses_definition_participant_idx ON public.survey_responses USING btree (definition_id, participant_ref_hash);


--
-- Name: survey_responses_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX survey_responses_status_idx ON public.survey_responses USING btree (definition_id, status);


--
-- Name: survey_versions_definition_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX survey_versions_definition_version_idx ON public.survey_versions USING btree (definition_id, version_number);


--
-- Name: survey_versions_digest_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX survey_versions_digest_idx ON public.survey_versions USING btree (definition_id, content_digest);


--
-- Name: zero_party_fp_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX zero_party_fp_client_idx ON public.zero_party_signals USING btree (fp_client_id);


--
-- Name: zero_party_signal_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX zero_party_signal_type_idx ON public.zero_party_signals USING btree (signal_type);


--
-- Name: zero_party_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX zero_party_user_idx ON public.zero_party_signals USING btree (user_id);


--
-- Name: consent_events consent_events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER consent_events_append_only BEFORE DELETE OR UPDATE ON public.consent_events FOR EACH ROW EXECUTE FUNCTION public.reject_consent_audit_mutation();


--
-- Name: consent_policy_blocks consent_policy_blocks_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER consent_policy_blocks_append_only BEFORE DELETE OR UPDATE ON public.consent_policy_blocks FOR EACH ROW EXECUTE FUNCTION public.reject_consent_audit_mutation();


--
-- Name: provider_unsubscribe_events provider_unsubscribe_events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER provider_unsubscribe_events_append_only BEFORE DELETE OR UPDATE ON public.provider_unsubscribe_events FOR EACH ROW EXECUTE FUNCTION public.reject_consent_audit_mutation();


--
-- Name: addresses addresses_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT addresses_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: attributes attributes_category_id_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attributes
    ADD CONSTRAINT attributes_category_id_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE;


--
-- Name: automation_action_executions automation_action_executions_execution_id_automation_executions; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_action_executions
    ADD CONSTRAINT automation_action_executions_execution_id_automation_executions FOREIGN KEY (execution_id) REFERENCES public.automation_executions(id);


--
-- Name: automation_approvals automation_approvals_version_id_automation_versions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_approvals
    ADD CONSTRAINT automation_approvals_version_id_automation_versions_id_fk FOREIGN KEY (version_id) REFERENCES public.automation_versions(id);


--
-- Name: automation_frequency_cap_reservations automation_cap_reservation_definition_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_frequency_cap_reservations
    ADD CONSTRAINT automation_cap_reservation_definition_fk FOREIGN KEY (definition_id) REFERENCES public.automation_definitions(id);


--
-- Name: automation_frequency_cap_reservations automation_cap_reservation_execution_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_frequency_cap_reservations
    ADD CONSTRAINT automation_cap_reservation_execution_fk FOREIGN KEY (execution_id) REFERENCES public.automation_executions(id);


--
-- Name: automation_frequency_cap_reservations automation_cap_reservation_version_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_frequency_cap_reservations
    ADD CONSTRAINT automation_cap_reservation_version_fk FOREIGN KEY (version_id) REFERENCES public.automation_versions(id);


--
-- Name: automation_executions automation_executions_version_id_automation_versions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_executions
    ADD CONSTRAINT automation_executions_version_id_automation_versions_id_fk FOREIGN KEY (version_id) REFERENCES public.automation_versions(id);


--
-- Name: automation_suppressions automation_suppressions_execution_id_automation_executions_id_f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_suppressions
    ADD CONSTRAINT automation_suppressions_execution_id_automation_executions_id_f FOREIGN KEY (execution_id) REFERENCES public.automation_executions(id);


--
-- Name: automation_versions automation_versions_definition_id_automation_definitions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_versions
    ADD CONSTRAINT automation_versions_definition_id_automation_definitions_id_fk FOREIGN KEY (definition_id) REFERENCES public.automation_definitions(id);


--
-- Name: behavioural_intervention_events behavioural_intervention_events_definition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.behavioural_intervention_events
    ADD CONSTRAINT behavioural_intervention_events_definition_id_fkey FOREIGN KEY (definition_id) REFERENCES public.behavioural_intervention_definitions(id);


--
-- Name: behavioural_intervention_exposures behavioural_intervention_exposures_definition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.behavioural_intervention_exposures
    ADD CONSTRAINT behavioural_intervention_exposures_definition_id_fkey FOREIGN KEY (definition_id) REFERENCES public.behavioural_intervention_definitions(id);


--
-- Name: behavioural_intervention_exposures behavioural_intervention_exposures_experiment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.behavioural_intervention_exposures
    ADD CONSTRAINT behavioural_intervention_exposures_experiment_id_fkey FOREIGN KEY (experiment_id) REFERENCES public.experiments(id);


--
-- Name: behavioural_intervention_exposures behavioural_intervention_exposures_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.behavioural_intervention_exposures
    ADD CONSTRAINT behavioural_intervention_exposures_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.behavioural_intervention_versions(id);


--
-- Name: behavioural_intervention_outcomes behavioural_intervention_outcomes_definition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.behavioural_intervention_outcomes
    ADD CONSTRAINT behavioural_intervention_outcomes_definition_id_fkey FOREIGN KEY (definition_id) REFERENCES public.behavioural_intervention_definitions(id);


--
-- Name: behavioural_intervention_outcomes behavioural_intervention_outcomes_exposure_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.behavioural_intervention_outcomes
    ADD CONSTRAINT behavioural_intervention_outcomes_exposure_id_fkey FOREIGN KEY (exposure_id) REFERENCES public.behavioural_intervention_exposures(id);


--
-- Name: behavioural_intervention_versions behavioural_intervention_versions_definition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.behavioural_intervention_versions
    ADD CONSTRAINT behavioural_intervention_versions_definition_id_fkey FOREIGN KEY (definition_id) REFERENCES public.behavioural_intervention_definitions(id);


--
-- Name: behavioural_intervention_versions behavioural_intervention_versions_experiment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.behavioural_intervention_versions
    ADD CONSTRAINT behavioural_intervention_versions_experiment_id_fkey FOREIGN KEY (experiment_id) REFERENCES public.experiments(id);


--
-- Name: cart_items cart_items_cart_id_carts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_cart_id_carts_id_fk FOREIGN KEY (cart_id) REFERENCES public.carts(id);


--
-- Name: cart_items cart_items_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: controlled_activation_approvals controlled_activation_approvals_activation_request_id_controlle; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_approvals
    ADD CONSTRAINT controlled_activation_approvals_activation_request_id_controlle FOREIGN KEY (activation_request_id) REFERENCES public.controlled_activation_requests(id);


--
-- Name: controlled_activation_audit_log controlled_activation_audit_log_activation_request_id_controlle; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_audit_log
    ADD CONSTRAINT controlled_activation_audit_log_activation_request_id_controlle FOREIGN KEY (activation_request_id) REFERENCES public.controlled_activation_requests(id);


--
-- Name: controlled_activation_canary_plans controlled_activation_canary_plans_execution_plan_id_controlled; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_canary_plans
    ADD CONSTRAINT controlled_activation_canary_plans_execution_plan_id_controlled FOREIGN KEY (execution_plan_id) REFERENCES public.controlled_activation_execution_plans(id);


--
-- Name: controlled_activation_canary_runbooks controlled_activation_canary_runbooks_candidate_id_controlled_a; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_canary_runbooks
    ADD CONSTRAINT controlled_activation_canary_runbooks_candidate_id_controlled_a FOREIGN KEY (candidate_id) REFERENCES public.controlled_activation_live_review_candidates(id);


--
-- Name: controlled_activation_destination_previews controlled_activation_destination_previews_dry_run_id_controlle; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_destination_previews
    ADD CONSTRAINT controlled_activation_destination_previews_dry_run_id_controlle FOREIGN KEY (dry_run_id) REFERENCES public.controlled_activation_dry_runs(id);


--
-- Name: controlled_activation_dry_runs controlled_activation_dry_runs_activation_request_id_controlled; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_dry_runs
    ADD CONSTRAINT controlled_activation_dry_runs_activation_request_id_controlled FOREIGN KEY (activation_request_id) REFERENCES public.controlled_activation_requests(id);


--
-- Name: controlled_activation_dry_runs controlled_activation_dry_runs_execution_plan_id_controlled_act; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_dry_runs
    ADD CONSTRAINT controlled_activation_dry_runs_execution_plan_id_controlled_act FOREIGN KEY (execution_plan_id) REFERENCES public.controlled_activation_execution_plans(id);


--
-- Name: controlled_activation_evidence_packs controlled_activation_evidence_packs_activation_request_id_cont; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_evidence_packs
    ADD CONSTRAINT controlled_activation_evidence_packs_activation_request_id_cont FOREIGN KEY (activation_request_id) REFERENCES public.controlled_activation_requests(id);


--
-- Name: controlled_activation_evidence_packs controlled_activation_evidence_packs_dry_run_id_controlled_acti; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_evidence_packs
    ADD CONSTRAINT controlled_activation_evidence_packs_dry_run_id_controlled_acti FOREIGN KEY (dry_run_id) REFERENCES public.controlled_activation_dry_runs(id);


--
-- Name: controlled_activation_execution_plans controlled_activation_execution_plans_activation_request_id_con; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_execution_plans
    ADD CONSTRAINT controlled_activation_execution_plans_activation_request_id_con FOREIGN KEY (activation_request_id) REFERENCES public.controlled_activation_requests(id);


--
-- Name: controlled_activation_gate_results controlled_activation_gate_results_activation_request_id_contro; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_gate_results
    ADD CONSTRAINT controlled_activation_gate_results_activation_request_id_contro FOREIGN KEY (activation_request_id) REFERENCES public.controlled_activation_requests(id);


--
-- Name: controlled_activation_incident_plans controlled_activation_incident_plans_candidate_id_controlled_ac; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_incident_plans
    ADD CONSTRAINT controlled_activation_incident_plans_candidate_id_controlled_ac FOREIGN KEY (candidate_id) REFERENCES public.controlled_activation_live_review_candidates(id);


--
-- Name: controlled_activation_live_readiness_checks controlled_activation_live_readiness_checks_candidate_id_contro; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_live_readiness_checks
    ADD CONSTRAINT controlled_activation_live_readiness_checks_candidate_id_contro FOREIGN KEY (candidate_id) REFERENCES public.controlled_activation_live_review_candidates(id);


--
-- Name: controlled_activation_live_review_candidates controlled_activation_live_review_candidates_activation_request; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_live_review_candidates
    ADD CONSTRAINT controlled_activation_live_review_candidates_activation_request FOREIGN KEY (activation_request_id) REFERENCES public.controlled_activation_requests(id);


--
-- Name: controlled_activation_live_review_candidates controlled_activation_live_review_candidates_execution_plan_id_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_live_review_candidates
    ADD CONSTRAINT controlled_activation_live_review_candidates_execution_plan_id_ FOREIGN KEY (execution_plan_id) REFERENCES public.controlled_activation_execution_plans(id);


--
-- Name: controlled_activation_operator_checklists controlled_activation_operator_checklists_candidate_id_controll; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_operator_checklists
    ADD CONSTRAINT controlled_activation_operator_checklists_candidate_id_controll FOREIGN KEY (candidate_id) REFERENCES public.controlled_activation_live_review_candidates(id);


--
-- Name: controlled_activation_stakeholder_live_approvals controlled_activation_stakeholder_live_approvals_candidate_id_c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_activation_stakeholder_live_approvals
    ADD CONSTRAINT controlled_activation_stakeholder_live_approvals_candidate_id_c FOREIGN KEY (candidate_id) REFERENCES public.controlled_activation_live_review_candidates(id);


--
-- Name: controlled_live_canaries controlled_live_canaries_activation_request_id_controlled_activ; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_live_canaries
    ADD CONSTRAINT controlled_live_canaries_activation_request_id_controlled_activ FOREIGN KEY (activation_request_id) REFERENCES public.controlled_activation_requests(id);


--
-- Name: controlled_live_canaries controlled_live_canaries_dry_run_id_controlled_activation_dry_r; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_live_canaries
    ADD CONSTRAINT controlled_live_canaries_dry_run_id_controlled_activation_dry_r FOREIGN KEY (dry_run_id) REFERENCES public.controlled_activation_dry_runs(id);


--
-- Name: controlled_live_canary_audit_logs controlled_live_canary_audit_logs_canary_id_controlled_live_can; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_live_canary_audit_logs
    ADD CONSTRAINT controlled_live_canary_audit_logs_canary_id_controlled_live_can FOREIGN KEY (canary_id) REFERENCES public.controlled_live_canaries(id);


--
-- Name: controlled_live_canary_delivery_attempts controlled_live_canary_delivery_attempts_canary_id_controlled_l; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_live_canary_delivery_attempts
    ADD CONSTRAINT controlled_live_canary_delivery_attempts_canary_id_controlled_l FOREIGN KEY (canary_id) REFERENCES public.controlled_live_canaries(id);


--
-- Name: controlled_live_canary_evidence_packs controlled_live_canary_evidence_packs_canary_id_controlled_live; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_live_canary_evidence_packs
    ADD CONSTRAINT controlled_live_canary_evidence_packs_canary_id_controlled_live FOREIGN KEY (canary_id) REFERENCES public.controlled_live_canaries(id);


--
-- Name: customer_feature_snapshots customer_feature_snapshots_canonical_customer_id_customer_profi; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_feature_snapshots
    ADD CONSTRAINT customer_feature_snapshots_canonical_customer_id_customer_profi FOREIGN KEY (canonical_customer_id) REFERENCES public.customer_profiles(canonical_customer_id);


--
-- Name: customer_identity_links customer_identity_links_canonical_customer_id_customer_profiles; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_identity_links
    ADD CONSTRAINT customer_identity_links_canonical_customer_id_customer_profiles FOREIGN KEY (canonical_customer_id) REFERENCES public.customer_profiles(canonical_customer_id);


--
-- Name: customer_lifecycle_snapshots customer_lifecycle_snapshots_canonical_customer_id_customer_pro; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_lifecycle_snapshots
    ADD CONSTRAINT customer_lifecycle_snapshots_canonical_customer_id_customer_pro FOREIGN KEY (canonical_customer_id) REFERENCES public.customer_profiles(canonical_customer_id);


--
-- Name: customer_profiles customer_profiles_account_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_profiles
    ADD CONSTRAINT customer_profiles_account_user_id_users_id_fk FOREIGN KEY (account_user_id) REFERENCES public.users(id);


--
-- Name: decision_assignments decision_assignments_insight_id_decision_insights_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_assignments
    ADD CONSTRAINT decision_assignments_insight_id_decision_insights_id_fk FOREIGN KEY (insight_id) REFERENCES public.decision_insights(id);


--
-- Name: decision_events decision_events_insight_id_decision_insights_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_events
    ADD CONSTRAINT decision_events_insight_id_decision_insights_id_fk FOREIGN KEY (insight_id) REFERENCES public.decision_insights(id);


--
-- Name: decision_evidence decision_evidence_insight_id_decision_insights_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_evidence
    ADD CONSTRAINT decision_evidence_insight_id_decision_insights_id_fk FOREIGN KEY (insight_id) REFERENCES public.decision_insights(id);


--
-- Name: decision_insights decision_insights_assigned_to_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_insights
    ADD CONSTRAINT decision_insights_assigned_to_users_id_fk FOREIGN KEY (assigned_to) REFERENCES public.users(id);


--
-- Name: decision_recommendations decision_recommendations_insight_id_decision_insights_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_recommendations
    ADD CONSTRAINT decision_recommendations_insight_id_decision_insights_id_fk FOREIGN KEY (insight_id) REFERENCES public.decision_insights(id);


--
-- Name: experiment_assignments experiment_assignments_experiment_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiment_assignments
    ADD CONSTRAINT experiment_assignments_experiment_fk FOREIGN KEY (experiment_id) REFERENCES public.experiments(id);


--
-- Name: experiment_exposures experiment_exposures_assignment_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiment_exposures
    ADD CONSTRAINT experiment_exposures_assignment_fk FOREIGN KEY (assignment_id) REFERENCES public.experiment_assignments(id);


--
-- Name: experiment_exposures experiment_exposures_experiment_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiment_exposures
    ADD CONSTRAINT experiment_exposures_experiment_fk FOREIGN KEY (experiment_id) REFERENCES public.experiments(id);


--
-- Name: experiment_variants experiment_variants_experiment_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiment_variants
    ADD CONSTRAINT experiment_variants_experiment_fk FOREIGN KEY (experiment_id) REFERENCES public.experiments(id);


--
-- Name: fraud_case_events fraud_case_events_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_case_events
    ADD CONSTRAINT fraud_case_events_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.fraud_cases(id);


--
-- Name: fraud_signals fraud_signals_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_signals
    ADD CONSTRAINT fraud_signals_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.fraud_cases(id);


--
-- Name: fulfilment_deliveries fulfilment_deliveries_fulfilment_task_id_fulfilment_tasks_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fulfilment_deliveries
    ADD CONSTRAINT fulfilment_deliveries_fulfilment_task_id_fulfilment_tasks_id_fk FOREIGN KEY (fulfilment_task_id) REFERENCES public.fulfilment_tasks(id);


--
-- Name: fulfilment_deliveries fulfilment_deliveries_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fulfilment_deliveries
    ADD CONSTRAINT fulfilment_deliveries_order_id_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: fulfilment_dispatches fulfilment_dispatches_fulfilment_task_id_fulfilment_tasks_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fulfilment_dispatches
    ADD CONSTRAINT fulfilment_dispatches_fulfilment_task_id_fulfilment_tasks_id_fk FOREIGN KEY (fulfilment_task_id) REFERENCES public.fulfilment_tasks(id);


--
-- Name: fulfilment_dispatches fulfilment_dispatches_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fulfilment_dispatches
    ADD CONSTRAINT fulfilment_dispatches_order_id_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: fulfilment_lines fulfilment_lines_fulfilment_task_id_fulfilment_tasks_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fulfilment_lines
    ADD CONSTRAINT fulfilment_lines_fulfilment_task_id_fulfilment_tasks_id_fk FOREIGN KEY (fulfilment_task_id) REFERENCES public.fulfilment_tasks(id);


--
-- Name: fulfilment_sla_events fulfilment_sla_events_task_id_fulfilment_tasks_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fulfilment_sla_events
    ADD CONSTRAINT fulfilment_sla_events_task_id_fulfilment_tasks_id_fk FOREIGN KEY (task_id) REFERENCES public.fulfilment_tasks(id);


--
-- Name: fulfilment_tasks fulfilment_tasks_assigned_to_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fulfilment_tasks
    ADD CONSTRAINT fulfilment_tasks_assigned_to_users_id_fk FOREIGN KEY (assigned_to) REFERENCES public.users(id);


--
-- Name: fulfilment_tasks fulfilment_tasks_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fulfilment_tasks
    ADD CONSTRAINT fulfilment_tasks_order_id_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: fulfilment_team_members fulfilment_team_members_team_id_fulfilment_teams_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fulfilment_team_members
    ADD CONSTRAINT fulfilment_team_members_team_id_fulfilment_teams_id_fk FOREIGN KEY (team_id) REFERENCES public.fulfilment_teams(id);


--
-- Name: fulfilment_team_members fulfilment_team_members_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fulfilment_team_members
    ADD CONSTRAINT fulfilment_team_members_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: inventory_reservations inventory_reservations_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_reservations
    ADD CONSTRAINT inventory_reservations_order_id_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: inventory_reservations inventory_reservations_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_reservations
    ADD CONSTRAINT inventory_reservations_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: loyalty_accounts loyalty_accounts_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_accounts
    ADD CONSTRAINT loyalty_accounts_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: loyalty_ledger_entries loyalty_ledger_entries_account_id_loyalty_accounts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_ledger_entries
    ADD CONSTRAINT loyalty_ledger_entries_account_id_loyalty_accounts_id_fk FOREIGN KEY (account_id) REFERENCES public.loyalty_accounts(id) ON DELETE CASCADE;


--
-- Name: loyalty_ledger_entries loyalty_ledger_entries_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_ledger_entries
    ADD CONSTRAINT loyalty_ledger_entries_order_id_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: loyalty_ledger_entries loyalty_ledger_related_entry_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_ledger_entries
    ADD CONSTRAINT loyalty_ledger_related_entry_fk FOREIGN KEY (reversed_entry_id) REFERENCES public.loyalty_ledger_entries(id) ON DELETE RESTRICT;


--
-- Name: measurement_admin_permissions measurement_admin_permissions_role_id_measurement_admin_roles_i; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_admin_permissions
    ADD CONSTRAINT measurement_admin_permissions_role_id_measurement_admin_roles_i FOREIGN KEY (role_id) REFERENCES public.measurement_admin_roles(id);


--
-- Name: measurement_data_quality_alerts measurement_data_quality_alerts_rule_id_measurement_data_qualit; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_data_quality_alerts
    ADD CONSTRAINT measurement_data_quality_alerts_rule_id_measurement_data_qualit FOREIGN KEY (rule_id) REFERENCES public.measurement_data_quality_rules(id);


--
-- Name: measurement_destination_delivery_logs measurement_destination_delivery_logs_destination_id_measuremen; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_destination_delivery_logs
    ADD CONSTRAINT measurement_destination_delivery_logs_destination_id_measuremen FOREIGN KEY (destination_id) REFERENCES public.measurement_destinations(id);


--
-- Name: measurement_destination_routes measurement_destination_routes_destination_id_measurement_desti; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_destination_routes
    ADD CONSTRAINT measurement_destination_routes_destination_id_measurement_desti FOREIGN KEY (destination_id) REFERENCES public.measurement_destinations(id);


--
-- Name: measurement_gtm_containers measurement_gtm_containers_account_id_measurement_gtm_accounts_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_gtm_containers
    ADD CONSTRAINT measurement_gtm_containers_account_id_measurement_gtm_accounts_ FOREIGN KEY (account_id) REFERENCES public.measurement_gtm_accounts(account_id);


--
-- Name: measurement_gtm_versions measurement_gtm_versions_container_id_measurement_gtm_container; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_gtm_versions
    ADD CONSTRAINT measurement_gtm_versions_container_id_measurement_gtm_container FOREIGN KEY (container_id) REFERENCES public.measurement_gtm_containers(container_id);


--
-- Name: measurement_gtm_workspaces measurement_gtm_workspaces_container_id_measurement_gtm_contain; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_gtm_workspaces
    ADD CONSTRAINT measurement_gtm_workspaces_container_id_measurement_gtm_contain FOREIGN KEY (container_id) REFERENCES public.measurement_gtm_containers(container_id);


--
-- Name: measurement_paid_social_delivery_logs measurement_paid_social_delivery_logs_destination_id_measuremen; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_paid_social_delivery_logs
    ADD CONSTRAINT measurement_paid_social_delivery_logs_destination_id_measuremen FOREIGN KEY (destination_id) REFERENCES public.measurement_paid_social_destinations(id);


--
-- Name: measurement_paid_social_event_mappings measurement_paid_social_event_mappings_destination_id_measureme; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_paid_social_event_mappings
    ADD CONSTRAINT measurement_paid_social_event_mappings_destination_id_measureme FOREIGN KEY (destination_id) REFERENCES public.measurement_paid_social_destinations(id);


--
-- Name: measurement_qa_results measurement_qa_results_release_request_id_measurement_release_r; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_qa_results
    ADD CONSTRAINT measurement_qa_results_release_request_id_measurement_release_r FOREIGN KEY (release_request_id) REFERENCES public.measurement_release_requests(id);


--
-- Name: measurement_qa_results measurement_qa_results_test_id_measurement_qa_tests_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_qa_results
    ADD CONSTRAINT measurement_qa_results_test_id_measurement_qa_tests_id_fk FOREIGN KEY (test_id) REFERENCES public.measurement_qa_tests(id);


--
-- Name: measurement_release_approvals measurement_release_approvals_release_request_id_measurement_re; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_release_approvals
    ADD CONSTRAINT measurement_release_approvals_release_request_id_measurement_re FOREIGN KEY (release_request_id) REFERENCES public.measurement_release_requests(id);


--
-- Name: module_activation_approvals module_activation_approvals_approved_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.module_activation_approvals
    ADD CONSTRAINT module_activation_approvals_approved_by_fk FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: module_activation_approvals module_activation_approvals_revoked_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.module_activation_approvals
    ADD CONSTRAINT module_activation_approvals_revoked_by_fk FOREIGN KEY (revoked_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: nba_candidates nba_candidates_decision_id_nba_decisions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nba_candidates
    ADD CONSTRAINT nba_candidates_decision_id_nba_decisions_id_fk FOREIGN KEY (decision_id) REFERENCES public.nba_decisions(id);


--
-- Name: nba_decisions nba_decisions_canonical_customer_id_customer_profiles_canonical; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nba_decisions
    ADD CONSTRAINT nba_decisions_canonical_customer_id_customer_profiles_canonical FOREIGN KEY (canonical_customer_id) REFERENCES public.customer_profiles(canonical_customer_id);


--
-- Name: order_items order_items_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: order_items order_items_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: orders orders_pricing_quote_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pricing_quote_fk FOREIGN KEY (pricing_quote_id) REFERENCES public.pricing_quotes(id);


--
-- Name: orders orders_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: packing_sessions packing_sessions_fulfilment_task_id_fulfilment_tasks_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packing_sessions
    ADD CONSTRAINT packing_sessions_fulfilment_task_id_fulfilment_tasks_id_fk FOREIGN KEY (fulfilment_task_id) REFERENCES public.fulfilment_tasks(id);


--
-- Name: packing_sessions packing_sessions_packer_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packing_sessions
    ADD CONSTRAINT packing_sessions_packer_user_id_users_id_fk FOREIGN KEY (packer_user_id) REFERENCES public.users(id);


--
-- Name: payment_attempts payment_attempts_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_attempts
    ADD CONSTRAINT payment_attempts_order_id_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: payments payments_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_order_id_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: pim_import_approvals pim_import_approvals_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pim_import_approvals
    ADD CONSTRAINT pim_import_approvals_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.pim_import_sessions(id);


--
-- Name: pim_import_events pim_import_events_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pim_import_events
    ADD CONSTRAINT pim_import_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.pim_import_sessions(id);


--
-- Name: pim_import_rows pim_import_rows_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pim_import_rows
    ADD CONSTRAINT pim_import_rows_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.pim_import_sessions(id);


--
-- Name: pricing_adjustments pricing_adjustments_definition_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_adjustments
    ADD CONSTRAINT pricing_adjustments_definition_fk FOREIGN KEY (promotion_definition_id) REFERENCES public.promotion_definitions(id);


--
-- Name: pricing_adjustments pricing_adjustments_line_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_adjustments
    ADD CONSTRAINT pricing_adjustments_line_fk FOREIGN KEY (quote_line_id) REFERENCES public.pricing_quote_lines(id);


--
-- Name: pricing_adjustments pricing_adjustments_quote_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_adjustments
    ADD CONSTRAINT pricing_adjustments_quote_fk FOREIGN KEY (quote_id) REFERENCES public.pricing_quotes(id);


--
-- Name: pricing_adjustments pricing_adjustments_version_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_adjustments
    ADD CONSTRAINT pricing_adjustments_version_fk FOREIGN KEY (promotion_version_id) REFERENCES public.promotion_versions(id);


--
-- Name: pricing_experiment_associations pricing_experiment_associations_experiment_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_experiment_associations
    ADD CONSTRAINT pricing_experiment_associations_experiment_fk FOREIGN KEY (experiment_id) REFERENCES public.experiments(id);


--
-- Name: pricing_experiment_associations pricing_experiment_associations_version_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_experiment_associations
    ADD CONSTRAINT pricing_experiment_associations_version_fk FOREIGN KEY (promotion_version_id) REFERENCES public.promotion_versions(id);


--
-- Name: pricing_quote_lines pricing_quote_lines_quote_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_quote_lines
    ADD CONSTRAINT pricing_quote_lines_quote_fk FOREIGN KEY (quote_id) REFERENCES public.pricing_quotes(id);


--
-- Name: product_attribute_values product_attribute_values_attribute_id_attributes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_attribute_values
    ADD CONSTRAINT product_attribute_values_attribute_id_attributes_id_fk FOREIGN KEY (attribute_id) REFERENCES public.attributes(id) ON DELETE CASCADE;


--
-- Name: product_attribute_values product_attribute_values_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_attribute_values
    ADD CONSTRAINT product_attribute_values_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_compatibility_mappings product_compatibility_mappings_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_compatibility_mappings
    ADD CONSTRAINT product_compatibility_mappings_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_compatibility_mappings product_compatibility_mappings_target_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_compatibility_mappings
    ADD CONSTRAINT product_compatibility_mappings_target_product_id_products_id_fk FOREIGN KEY (target_product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_feed_items product_feed_items_feed_id_product_feeds_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_feed_items
    ADD CONSTRAINT product_feed_items_feed_id_product_feeds_id_fk FOREIGN KEY (feed_id) REFERENCES public.product_feeds(id);


--
-- Name: product_feed_items product_feed_items_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_feed_items
    ADD CONSTRAINT product_feed_items_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: product_finder_sessions product_finder_sessions_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_finder_sessions
    ADD CONSTRAINT product_finder_sessions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: product_images product_images_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_prices product_prices_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_prices
    ADD CONSTRAINT product_prices_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: products products_category_id_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.categories(id);


--
-- Name: promotion_approvals promotion_approvals_version_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_approvals
    ADD CONSTRAINT promotion_approvals_version_fk FOREIGN KEY (version_id) REFERENCES public.promotion_versions(id);


--
-- Name: promotion_definitions promotion_definitions_active_version_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_definitions
    ADD CONSTRAINT promotion_definitions_active_version_fk FOREIGN KEY (active_version_id) REFERENCES public.promotion_versions(id);


--
-- Name: promotion_redemptions promotion_redemptions_order_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_redemptions
    ADD CONSTRAINT promotion_redemptions_order_fk FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: promotion_redemptions promotion_redemptions_reservation_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_redemptions
    ADD CONSTRAINT promotion_redemptions_reservation_fk FOREIGN KEY (reservation_id) REFERENCES public.promotion_reservations(id);


--
-- Name: promotion_reservations promotion_reservations_quote_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_reservations
    ADD CONSTRAINT promotion_reservations_quote_fk FOREIGN KEY (quote_id) REFERENCES public.pricing_quotes(id);


--
-- Name: promotion_reservations promotion_reservations_version_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_reservations
    ADD CONSTRAINT promotion_reservations_version_fk FOREIGN KEY (promotion_version_id) REFERENCES public.promotion_versions(id);


--
-- Name: promotion_versions promotion_versions_definition_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_versions
    ADD CONSTRAINT promotion_versions_definition_fk FOREIGN KEY (definition_id) REFERENCES public.promotion_definitions(id);


--
-- Name: recommendation_events recommendation_events_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_events
    ADD CONSTRAINT recommendation_events_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: recommendation_events recommendation_events_recommendation_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_events
    ADD CONSTRAINT recommendation_events_recommendation_product_id_products_id_fk FOREIGN KEY (recommendation_product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: recommendation_events recommendation_events_rule_id_recommendation_rules_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_events
    ADD CONSTRAINT recommendation_events_rule_id_recommendation_rules_id_fk FOREIGN KEY (rule_id) REFERENCES public.recommendation_rules(id) ON DELETE SET NULL;


--
-- Name: recommendation_events recommendation_events_source_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_events
    ADD CONSTRAINT recommendation_events_source_product_id_products_id_fk FOREIGN KEY (source_product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: recommendation_rule_audit_logs recommendation_rule_audit_logs_rule_id_recommendation_rules_id_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_rule_audit_logs
    ADD CONSTRAINT recommendation_rule_audit_logs_rule_id_recommendation_rules_id_ FOREIGN KEY (rule_id) REFERENCES public.recommendation_rules(id) ON DELETE CASCADE;


--
-- Name: release_decisions release_decisions_recorded_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_decisions
    ADD CONSTRAINT release_decisions_recorded_by_users_id_fk FOREIGN KEY (recorded_by) REFERENCES public.users(id);


--
-- Name: release_decisions release_decisions_run_id_release_readiness_runs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_decisions
    ADD CONSTRAINT release_decisions_run_id_release_readiness_runs_id_fk FOREIGN KEY (run_id) REFERENCES public.release_readiness_runs(id);


--
-- Name: release_readiness_audit_log release_readiness_audit_log_admin_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_readiness_audit_log
    ADD CONSTRAINT release_readiness_audit_log_admin_user_id_users_id_fk FOREIGN KEY (admin_user_id) REFERENCES public.users(id);


--
-- Name: release_readiness_gate_results release_readiness_gate_results_acknowledged_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_readiness_gate_results
    ADD CONSTRAINT release_readiness_gate_results_acknowledged_by_users_id_fk FOREIGN KEY (acknowledged_by) REFERENCES public.users(id);


--
-- Name: release_readiness_gate_results release_readiness_gate_results_run_id_release_readiness_runs_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_readiness_gate_results
    ADD CONSTRAINT release_readiness_gate_results_run_id_release_readiness_runs_id FOREIGN KEY (run_id) REFERENCES public.release_readiness_runs(id) ON DELETE CASCADE;


--
-- Name: release_readiness_runs release_readiness_runs_triggered_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_readiness_runs
    ADD CONSTRAINT release_readiness_runs_triggered_by_users_id_fk FOREIGN KEY (triggered_by) REFERENCES public.users(id);


--
-- Name: role_permissions role_permissions_permission_id_permissions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_permissions_id_fk FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_roles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_roles_id_fk FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: search_product_insights search_product_insights_product_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_product_insights
    ADD CONSTRAINT search_product_insights_product_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: search_product_insights search_product_insights_query_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_product_insights
    ADD CONSTRAINT search_product_insights_query_fk FOREIGN KEY (query) REFERENCES public.search_demand_signals(query) ON DELETE CASCADE;


--
-- Name: survey_events survey_events_definition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_events
    ADD CONSTRAINT survey_events_definition_id_fkey FOREIGN KEY (definition_id) REFERENCES public.survey_definitions(id);


--
-- Name: survey_responses survey_responses_definition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_responses
    ADD CONSTRAINT survey_responses_definition_id_fkey FOREIGN KEY (definition_id) REFERENCES public.survey_definitions(id);


--
-- Name: survey_responses survey_responses_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_responses
    ADD CONSTRAINT survey_responses_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.survey_versions(id);


--
-- Name: survey_versions survey_versions_definition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_versions
    ADD CONSTRAINT survey_versions_definition_id_fkey FOREIGN KEY (definition_id) REFERENCES public.survey_definitions(id);


--
-- Name: user_roles user_roles_role_id_roles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_role_id_roles_id_fk FOREIGN KEY (role_id) REFERENCES public.roles(id);


--
-- Name: user_roles user_roles_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: utm_links utm_links_campaign_id_campaigns_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.utm_links
    ADD CONSTRAINT utm_links_campaign_id_campaigns_id_fk FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id);


--
-- Name: verification_codes verification_codes_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_codes
    ADD CONSTRAINT verification_codes_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: wishlists wishlists_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wishlists
    ADD CONSTRAINT wishlists_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: wishlists wishlists_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wishlists
    ADD CONSTRAINT wishlists_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


