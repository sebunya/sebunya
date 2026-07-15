import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONSENT_ACTOR_TYPES,
  CONSENT_IDENTITY_LEVELS,
  CONSENT_STATES,
  assertConsentIdentityLevelShape,
  assertConsentStateTransitionShape,
  assertLegacyMappingIsNotAutoGrant,
  assertNoAnonymousConsentGrant,
  assertNoCheckoutContactMarketingGrant,
  assertPolicyBlockPrecedence,
  assertProviderSuppressionShape,
  assertWithdrawalSupersedesGrant,
  createConsentAuditEnvelope,
  hashConsentAuditEnvelope,
  type ConsentAuditEnvelopeInput,
} from "../../apps/api/src/domain/consent/ConsentFoundation";
import {
  evaluateConsentProviderEligibilityPreview,
  type ConsentProviderEligibilityPreviewInput,
} from "../../apps/api/src/domain/consent/ConsentProviderEligibilityPreview";

const root = resolve(import.meta.dirname, "../..");
const paths = {
  migration: "apps/api/src/infrastructure/db/migrations/0022_low_phil_sheldon.sql",
  snapshot: "apps/api/src/infrastructure/db/migrations/meta/0022_snapshot.json",
  journal: "apps/api/src/infrastructure/db/migrations/meta/_journal.json",
  schemaIndex: "apps/api/src/infrastructure/db/schema/index.ts",
  schema: "apps/api/src/infrastructure/db/schema/consent-foundation.ts",
  foundation: "apps/api/src/domain/consent/ConsentFoundation.ts",
  evaluator: "apps/api/src/domain/consent/ConsentProviderEligibilityPreview.ts",
  evidence: "docs/platform/evidence/slices/slice-09-b3-consent-schema-audit-command-foundation.md",
  migrationReview: "docs/platform/evidence/slices/slice-09-b3-migration-review.md",
  artifactReview: "docs/platform/evidence/slices/slice-09-b3-artifact-review.md",
  test: "tests/unit/Slice09B3ConsentSchemaAuditCommandFoundation.test.ts",
};
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const lower = (path: string) => read(path).toLowerCase();
const migration = lower(paths.migration);
const schema = lower(paths.schema);
const foundationSource = lower(paths.foundation);
const evaluatorSource = lower(paths.evaluator);
const evidence = lower(paths.evidence);
const migrationReview = lower(paths.migrationReview);
const artifactReview = lower(paths.artifactReview);

const auditInput: ConsentAuditEnvelopeInput = {
  consent_event_id: "event-001",
  event_type: "consent_withdrawal_recorded",
  customer_identity_ref: "customer-ref-001",
  purpose_key: "marketing_offers_campaigns",
  channel_key: "email",
  state: "withdrawn",
  source_surface: "preference_centre",
  actor_type: "customer",
  actor_id: "customer-ref-001",
  timestamp: "2026-07-15T10:00:00.000Z",
  copy_version_id: "copy-v1",
  previous_state: "granted",
  new_state: "withdrawn",
  reason: "customer withdrawal",
  correlation_id: "correlation-001",
  provider_callback_ref: null,
  support_ticket_ref: null,
  retention_policy: "consent-audit-v1",
};

const eligibleInput: ConsentProviderEligibilityPreviewInput = {
  purpose_key: "marketing_offers_campaigns",
  channel_key: "email",
  consent_state: "granted",
  identity_level: "verified_account",
  optional_marketing: true,
  policy_block_active: false,
  withdrawal_active: false,
  provider_suppression_active: false,
  template_required: true,
  template_approved: true,
  copy_version_present: true,
  provider_credential_configured: true,
  provider_delivery_enabled: true,
  message_category_matches_purpose: true,
};

describe("Slice 9-B3 artifacts", () => {
  Object.entries(paths).forEach(([name, path]) => {
    it(`${name} exists`, () => expect(read(path).length).toBeGreaterThan(20));
  });
});

describe("additive migration structure", () => {
  [
    "consent_purposes",
    "consent_channels",
    "consent_copy_versions",
    "consent_source_surfaces",
    "customer_consent_states",
    "consent_events",
    "channel_suppressions",
    "provider_unsubscribe_events",
    "support_assisted_preference_requests",
    "legacy_preference_mappings",
    "consent_policy_blocks",
  ].forEach(table => {
    it(`creates ${table}`, () => expect(migration).toContain(`create table if not exists "${table}"`));
  });

  CONSENT_STATES.forEach(state => {
    it(`contains consent state ${state}`, () => expect(migration).toContain(`'${state}'`));
  });
  CONSENT_ACTOR_TYPES.forEach(actor => {
    it(`contains actor type ${actor}`, () => expect(migration).toContain(`'${actor}'`));
  });
  CONSENT_IDENTITY_LEVELS.forEach(level => {
    it(`contains identity level ${level}`, () => expect(migration).toContain(`'${level}'`));
  });

  [
    "integrity_hash",
    "tamper_evidence_ref",
    "provider_callback_ref",
    "support_ticket_ref",
    "policy_block_reason",
    "correlation_id",
    "created_at",
    "effective_at",
    "expires_at",
    "customer_consent_states_no_anonymous_grant_chk",
    "customer_consent_states_no_checkout_marketing_grant_chk",
    "support_assisted_requests_no_direct_grant_chk",
    "consent_events_append_only",
    "provider_unsubscribe_events_append_only",
    "consent_policy_blocks_append_only",
    "provider_unsubscribe_events_provider_event_uidx",
    "channel_suppressions_active_idx",
    "customer_consent_states_aggregate_uidx",
    "legacy_preference_mappings_rule_uidx",
    "consent_events_aggregate_audit_idx",
    "consent_policy_blocks_scope_chk",
    "consent_legacy_mapping_outcome",
  ].forEach(token => {
    it(`contains migration safeguard ${token}`, () => expect(migration).toContain(token));
  });

  [
    "drop table",
    "drop column",
    "insert into",
    "provider_secret",
    "client_secret",
    "controlled_live_canaries",
  ].forEach(forbidden => {
    it(`does not contain ${forbidden}`, () => expect(migration).not.toContain(forbidden));
  });
});

describe("isolated Drizzle schema", () => {
  [
    "consent_purposes",
    "consent_channels",
    "consent_copy_versions",
    "consent_source_surfaces",
    "customer_consent_states",
    "consent_events",
    "channel_suppressions",
    "provider_unsubscribe_events",
    "support_assisted_preference_requests",
    "legacy_preference_mappings",
    "consent_policy_blocks",
  ].forEach(table => {
    it(`models ${table}`, () => expect(schema).toContain(`pgtable('${table}'`));
  });

  [...CONSENT_STATES, ...CONSENT_ACTOR_TYPES, ...CONSENT_IDENTITY_LEVELS].forEach(value => {
    it(`models enum value ${value}`, () => expect(schema).toContain(`'${value}'`));
  });

  [
    "purpose_key",
    "channel_key",
    "customer_identity_ref",
    "endpoint_ref",
    "identity_verification_level",
    "source_surface",
    "copy_version_id",
    "previous_state",
    "new_state",
    "actor_type",
    "actor_id",
    "reason",
    "correlation_id",
    "provider_callback_ref",
    "support_ticket_ref",
    "retention_policy",
    "integrity_hash",
    "tamper_evidence_ref",
    "policy_block_reason",
    "mapping_outcome",
  ].forEach(field => {
    it(`models field ${field}`, () => expect(schema).toContain(`'${field}'`));
  });
});

describe("immutable deterministic audit envelope", () => {
  const envelope = createConsentAuditEnvelope(auditInput);
  [
    "consent_event_id",
    "event_type",
    "customer_identity_ref",
    "purpose_key",
    "channel_key",
    "state",
    "source_surface",
    "actor_type",
    "actor_id",
    "timestamp",
    "copy_version_id",
    "previous_state",
    "new_state",
    "reason",
    "correlation_id",
    "provider_callback_ref",
    "support_ticket_ref",
    "retention_policy",
  ].forEach(field => {
    it(`includes ${field}`, () => expect(envelope).toHaveProperty(field));
  });

  it("freezes the envelope", () => expect(Object.isFrozen(envelope)).toBe(true));
  it("creates equal envelopes for equal inputs", () => expect(createConsentAuditEnvelope(auditInput)).toEqual(envelope));
  it("hashes equal envelopes identically", () => expect(hashConsentAuditEnvelope(createConsentAuditEnvelope(auditInput))).toBe(hashConsentAuditEnvelope(envelope)));
  it("returns a SHA-256 hex digest", () => expect(hashConsentAuditEnvelope(envelope)).toMatch(/^[a-f0-9]{64}$/));
  it("changes the hash when audited content changes", () => {
    const changed = createConsentAuditEnvelope({ ...auditInput, reason: "different reason" });
    expect(hashConsentAuditEnvelope(changed)).not.toBe(hashConsentAuditEnvelope(envelope));
  });
  ["correlation_id", "purpose_key", "channel_key", "source_surface", "reason", "retention_policy"].forEach(field => {
    it(`rejects blank ${field}`, () => {
      expect(() => createConsentAuditEnvelope({ ...auditInput, [field]: " " })).toThrow();
    });
  });
  it("rejects an invalid timestamp", () => expect(() => createConsentAuditEnvelope({ ...auditInput, timestamp: "never" })).toThrow());
  it("rejects state/new-state disagreement", () => expect(() => createConsentAuditEnvelope({ ...auditInput, state: "granted" })).toThrow());
});

describe("pure fail-closed guards", () => {
  it("accepts a valid transition shape", () => expect(() => assertConsentStateTransitionShape("granted", "withdrawn")).not.toThrow());
  it("rejects an invalid prior state", () => expect(() => assertConsentStateTransitionShape("invalid" as never, "withdrawn")).toThrow());
  it("rejects an invalid next state", () => expect(() => assertConsentStateTransitionShape("granted", "invalid" as never)).toThrow());
  it("accepts a valid identity level", () => expect(() => assertConsentIdentityLevelShape("verified_account")).not.toThrow());
  it("rejects an invalid identity level", () => expect(() => assertConsentIdentityLevelShape("invalid" as never)).toThrow());
  it("rejects anonymous grant", () => expect(() => assertNoAnonymousConsentGrant("anonymous", "granted")).toThrow());
  it("allows anonymous unknown state", () => expect(() => assertNoAnonymousConsentGrant("anonymous", "unknown")).not.toThrow());
  it("rejects checkout-contact marketing grant", () => expect(() => assertNoCheckoutContactMarketingGrant("checkout_contact_only", true, "granted")).toThrow());
  it("does not broaden the checkout guard to service-only", () => expect(() => assertNoCheckoutContactMarketingGrant("checkout_contact_only", false, "service_only")).not.toThrow());
  it("rejects legacy automatic grant", () => expect(() => assertLegacyMappingIsNotAutoGrant("granted")).toThrow());
  it("allows legacy mapping to unknown", () => expect(() => assertLegacyMappingIsNotAutoGrant("unknown")).not.toThrow());
  it("rejects STOP without suppression", () => expect(() => assertProviderSuppressionShape({ channel_key: "sms", suppression_active: false, provider_stop_or_unsubscribe: true })).toThrow());
  it("accepts STOP with suppression", () => expect(() => assertProviderSuppressionShape({ channel_key: "sms", suppression_active: true, provider_stop_or_unsubscribe: true })).not.toThrow());
  it("requires a suppression channel", () => expect(() => assertProviderSuppressionShape({ channel_key: " ", suppression_active: true, provider_stop_or_unsubscribe: true })).toThrow());
  it("makes policy block outrank grant", () => expect(assertPolicyBlockPrecedence(true, "granted")).toBe("blocked_by_policy"));
  it("retains state without policy block", () => expect(assertPolicyBlockPrecedence(false, "granted")).toBe("granted"));
  it("makes withdrawal supersede grant", () => expect(assertWithdrawalSupersedesGrant(true, "granted")).toBe("withdrawn"));
  it("does not invent withdrawal without a signal", () => expect(assertWithdrawalSupersedesGrant(false, "granted")).toBe("granted"));
});

describe("read-only provider eligibility preview", () => {
  const cases: Array<[string, Partial<ConsentProviderEligibilityPreviewInput>, string]> = [
    ["policy block", { policy_block_active: true }, "policy_block_active"],
    ["provider suppression", { provider_suppression_active: true }, "provider_suppression_active"],
    ["withdrawal", { withdrawal_active: true }, "withdrawal_active"],
    ["unknown consent", { consent_state: "unknown" }, "consent_state_unknown"],
    ["not-requested consent", { consent_state: "not_requested" }, "consent_state_not_requested"],
    ["anonymous identity", { identity_level: "anonymous" }, "identity_anonymous"],
    ["checkout-only marketing", { identity_level: "checkout_contact_only" }, "checkout_contact_not_marketing_consent"],
    ["missing purpose", { purpose_key: " " }, "purpose_missing"],
    ["missing channel", { channel_key: "" }, "channel_missing"],
    ["missing copy", { copy_version_present: false }, "copy_version_missing"],
    ["unapproved template", { template_approved: false }, "template_not_approved"],
    ["category mismatch", { message_category_matches_purpose: false }, "message_category_mismatch"],
    ["missing credential", { provider_credential_configured: false }, "provider_credential_not_configured"],
    ["delivery disabled", { provider_delivery_enabled: false }, "provider_delivery_disabled"],
  ];
  cases.forEach(([name, override, reason]) => {
    it(`fails closed for ${name}`, () => {
      const result = evaluateConsentProviderEligibilityPreview({ ...eligibleInput, ...override });
      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain(reason);
    });
  });

  it("can describe a future-approved eligible shape without sending", () => expect(evaluateConsentProviderEligibilityPreview(eligibleInput).eligible).toBe(true));
  it("always requires an audit preview", () => expect(evaluateConsentProviderEligibilityPreview(eligibleInput).audit_preview_required).toBe(true));
  it("reports the state used", () => expect(evaluateConsentProviderEligibilityPreview(eligibleInput).state_used).toBe("granted"));
  it("reports active suppression", () => expect(evaluateConsentProviderEligibilityPreview({ ...eligibleInput, provider_suppression_active: true }).suppression_status).toBe("active"));
  it("reports no suppression", () => expect(evaluateConsentProviderEligibilityPreview(eligibleInput).suppression_status).toBe("none"));
  it("returns disabled delivery when disabled", () => expect(evaluateConsentProviderEligibilityPreview({ ...eligibleInput, provider_delivery_enabled: false }).delivery_mode).toBe("disabled"));
  it("returns dry-run-only for a failed gate while delivery is configured", () => expect(evaluateConsentProviderEligibilityPreview({ ...eligibleInput, withdrawal_active: true }).delivery_mode).toBe("dry_run_only"));
  it("labels a fully passing configured shape as requiring future approval", () => expect(evaluateConsentProviderEligibilityPreview(eligibleInput).delivery_mode).toBe("future_live_allowed_after_approval"));
  it("returns missing copy gate", () => expect(evaluateConsentProviderEligibilityPreview({ ...eligibleInput, copy_version_present: false }).missing_gates).toContain("copy_version"));
  it("returns template approval gate", () => expect(evaluateConsentProviderEligibilityPreview({ ...eligibleInput, template_approved: false }).missing_gates).toContain("approved_template"));
  it("returns credential gate", () => expect(evaluateConsentProviderEligibilityPreview({ ...eligibleInput, provider_credential_configured: false }).missing_gates).toContain("provider_credential"));
  it("returns delivery approval gate", () => expect(evaluateConsentProviderEligibilityPreview({ ...eligibleInput, provider_delivery_enabled: false }).missing_gates).toContain("provider_delivery_approval"));
  it("returns deterministic output", () => expect(evaluateConsentProviderEligibilityPreview(eligibleInput)).toEqual(evaluateConsentProviderEligibilityPreview(eligibleInput)));
  it("does not mutate its input", () => {
    const input = { ...eligibleInput };
    evaluateConsentProviderEligibilityPreview(input);
    expect(input).toEqual(eligibleInput);
  });
});

describe("pure source boundary", () => {
  ["fetch(", "axios", "process.env", "drizzle", "database", "outbox", "queue.", "send("].forEach(term => {
    it(`foundation does not use ${term}`, () => expect(foundationSource).not.toContain(term));
  });
  ["fetch(", "axios", "process.env", "drizzle", "database", "outbox", "queue.", "send("].forEach(term => {
    it(`evaluator does not use ${term}`, () => expect(evaluatorSource).not.toContain(term));
  });
});

describe("evidence records the implementation boundary", () => {
  [
    "schema foundation",
    "drizzle schema",
    "audit envelope",
    "pure command guards",
    "pure provider eligibility preview",
    "no api mutation",
    "no customer preference write",
    "no provider send",
    "no customer communication",
    "no runtime ux",
    "no production migration",
    "specialist",
    "checkout contact is not marketing consent",
    "legacy broad flags",
  ].forEach(term => {
    it(`records ${term}`, () => expect(evidence).toContain(term));
  });
  ["additive", "no drop", "append-only", "not been executed", "provider secrets", "legacy auto-grant", "generator boundary"].forEach(term => {
    it(`migration review records ${term}`, () => expect(migrationReview).toContain(term));
  });
  ["api mutation/customer writes", "provider/transport/send", "runtime ux", "checkout/payment/order", "auth/rbac/credentials", "loyalty/offers", "deployment"].forEach(term => {
    it(`artifact review records ${term}`, () => expect(artifactReview).toContain(term));
  });
});

describe("artifact scope", () => {
  [
    "apps/web/src/",
    "/routes/",
    "provider-transport",
    "checkout",
    "payment",
    "pesapal",
    "/auth/",
    "loyalty-ledger",
    ".env",
    "deploy",
    "external-delivery",
  ].forEach(forbidden => {
    it(`allowlist excludes ${forbidden}`, () => expect(Object.values(paths).every(path => !path.toLowerCase().includes(forbidden))).toBe(true));
  });

  it("contains only the exact Slice 9-B3 allowlist while dirty or is clean after commit", () => {
    const output = execFileSync("git", ["status", "--short", "--untracked-files=all"], { cwd: resolve(root, ".."), encoding: "utf8" });
    const changed = output.trimEnd().split("\n").filter(Boolean).map(line => line.slice(3));
    const allowed = new Set(Object.values(paths).map(path => `goldplus-commerce/${path}`));
    expect([0, 11]).toContain(changed.length);
    expect(changed.every(path => allowed.has(path))).toBe(true);
  });
});
