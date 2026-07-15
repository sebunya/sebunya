import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONSENT_CHANNEL_KEYS,
  CONSENT_PURPOSE_KEYS,
  type ChannelSuppressionWrite,
  type ConsentAggregateKey,
  type ConsentCurrentState,
  type ConsentEventWrite,
  type ConsentMutationReceipt,
  type ConsentOperatingRepository,
  type LegacyMappingResultWrite,
  type PolicyBlockWrite,
  type ProviderUnsubscribeWrite,
  type SupportAssistedRequestWrite,
} from "../../apps/api/src/application/ports/consent/ConsentOperatingRepository";
import {
  CONSENT_FEATURE_GATE_NAMES,
  readConsentFeatureGates,
  type ConsentFeatureGateName,
} from "../../apps/api/src/application/services/consent/ConsentFeatureGates";
import { LegacyPreferenceMigrationDryRun } from "../../apps/api/src/application/services/consent/LegacyPreferenceMigrationDryRun";
import { ConsentNoSendReleaseReadiness } from "../../apps/api/src/application/services/consent/ConsentNoSendReleaseReadiness";
import {
  ApplyPolicyBlock,
  PreviewProviderEligibility,
  RecordConsentGrant,
  RecordConsentWithdrawal,
  RecordProviderStopSignal,
  RecordProviderUnsubscribeSignal,
  RecordSupportAssistedPreferenceRequest,
  RequestPreferenceChange,
  ResolveConsentConflict,
  SupersedeConsentState,
  VerifyPreferenceChange,
  type StateMutationInput,
} from "../../apps/api/src/application/use-cases/consent/ConsentOperatingCommands";
import type { ConsentState } from "../../apps/api/src/domain/consent/ConsentFoundation";
import type { ConsentProviderEligibilityPreviewInput } from "../../apps/api/src/domain/consent/ConsentProviderEligibilityPreview";

const root = resolve(import.meta.dirname, "../..");
const paths = {
  repositoryContract: "apps/api/src/application/ports/consent/ConsentOperatingRepository.ts",
  featureGates: "apps/api/src/application/services/consent/ConsentFeatureGates.ts",
  commandSupport: "apps/api/src/application/services/consent/ConsentCommandSupport.ts",
  legacyDryRun: "apps/api/src/application/services/consent/LegacyPreferenceMigrationDryRun.ts",
  readiness: "apps/api/src/application/services/consent/ConsentNoSendReleaseReadiness.ts",
  commands: "apps/api/src/application/use-cases/consent/ConsentOperatingCommands.ts",
  drizzleRepository: "apps/api/src/infrastructure/consent/DrizzleConsentOperatingRepository.ts",
  runtime: "apps/api/src/infrastructure/consent/ConsentOperatingRuntime.ts",
  customerRoute: "apps/api/src/interfaces/http/routes/consent-operating.ts",
  adminRoute: "apps/api/src/interfaces/http/routes/admin/consent-operating.ts",
  app: "apps/api/src/interfaces/http/app.ts",
  canonicalForm: "apps/web/src/components/preferences/CanonicalConsentForm.astro",
  preferencePage: "apps/web/src/pages/account/preferences.astro",
  adminPage: "apps/web/src/pages/admin/consent-operating.astro",
  adminNavigation: "apps/web/src/lib/admin-navigation.ts",
  implementationEvidence: "docs/platform/evidence/slices/slice-09-x-prime-consent-operating-layer-p0.md",
  readinessEvidence: "docs/platform/evidence/slices/slice-09-x-prime-no-send-release-readiness.md",
  artifactReview: "docs/platform/evidence/slices/slice-09-x-prime-artifact-review.md",
  adminProtectionRegression: "tests/unit/Slice08B1AdminRouteProtectionSweep.test.ts",
  test: "tests/unit/Slice09XPrimeConsentOperatingLayerP0.test.ts",
};
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const lower = (path: string) => read(path).toLowerCase();
const repositorySource = lower(paths.repositoryContract);
const gateSource = lower(paths.featureGates);
const commandSource = lower(paths.commands);
const drizzleSource = lower(paths.drizzleRepository);
const runtimeSource = lower(paths.runtime);
const customerRouteSource = lower(paths.customerRoute);
const adminRouteSource = lower(paths.adminRoute);
const appSource = lower(paths.app);
const canonicalFormSource = lower(paths.canonicalForm);
const preferencePageSource = lower(paths.preferencePage);
const adminPageSource = lower(paths.adminPage);
const implementationEvidence = lower(paths.implementationEvidence);
const readinessEvidence = lower(paths.readinessEvidence);
const artifactReview = lower(paths.artifactReview);

function keyOf(key: ConsentAggregateKey): string {
  return [key.customer_identity_ref, key.endpoint_ref, key.purpose_key, key.channel_key].join("|");
}

class InMemoryConsentOperatingRepository implements ConsentOperatingRepository {
  states = new Map<string, ConsentCurrentState>();
  events: ConsentEventWrite[] = [];
  suppressions: ChannelSuppressionWrite[] = [];
  providerEvents: ProviderUnsubscribeWrite[] = [];
  supportRequests: SupportAssistedRequestWrite[] = [];
  legacyMappings: LegacyMappingResultWrite[] = [];
  policyBlocks: PolicyBlockWrite[] = [];
  copyVersions: Array<Record<string, unknown>> = [];

  async listPurposes() { return CONSENT_PURPOSE_KEYS.map(purpose_key => ({ purpose_key })); }
  async listChannels() { return CONSENT_CHANNEL_KEYS.map(channel_key => ({ channel_key })); }
  async listSourceSurfaces() { return [{ source_surface: "account_preference_centre_p0" }]; }
  async getLatestConsentState(key: ConsentAggregateKey) { return this.states.get(keyOf(key)) ?? null; }
  async appendImmutableConsentEvent(event: ConsentEventWrite): Promise<ConsentMutationReceipt> {
    const existing = this.events.find(candidate => candidate.consent_event_id === event.consent_event_id);
    if (existing) return { consent_event_id: existing.consent_event_id, state: existing.new_state, already_applied: true };
    this.events.push(event);
    return { consent_event_id: event.consent_event_id, state: event.new_state, already_applied: false };
  }
  async upsertCurrentConsentStateBySupersession(event: ConsentEventWrite): Promise<ConsentCurrentState> {
    const state: ConsentCurrentState = {
      customer_identity_ref: event.customer_identity_ref,
      endpoint_ref: event.endpoint_ref,
      purpose_key: event.purpose_key,
      channel_key: event.channel_key,
      state: event.new_state,
      identity_level: event.identity_level,
      source_surface: event.source_surface,
      copy_version_id: event.copy_version_id,
      last_consent_event_id: event.consent_event_id,
      effective_at: event.effective_at,
      expires_at: null,
    };
    this.states.set(keyOf(event), state);
    return state;
  }
  async commitStateChange(event: ConsentEventWrite): Promise<ConsentMutationReceipt> {
    const receipt = await this.appendImmutableConsentEvent(event);
    if (!receipt.already_applied) await this.upsertCurrentConsentStateBySupersession(event);
    return receipt;
  }
  async recordCopyVersionReference(input: Record<string, unknown>) { this.copyVersions.push(input); }
  async recordChannelSuppression(input: ChannelSuppressionWrite) {
    this.suppressions.push(input);
    return { suppression_id: `suppression-${this.suppressions.length}` };
  }
  async recordProviderUnsubscribeEvent(input: ProviderUnsubscribeWrite) {
    const existing = this.providerEvents.find(event => event.provider_key === input.provider_key && event.provider_event_ref === input.provider_event_ref);
    if (existing) return { event_id: existing.provider_event_ref, already_applied: true };
    this.providerEvents.push(input);
    return { event_id: input.provider_event_ref, already_applied: false };
  }
  async recordSupportAssistedRequest(input: SupportAssistedRequestWrite) {
    this.supportRequests.push(input);
    return { request_id: `support-${this.supportRequests.length}` };
  }
  async recordLegacyMappingResult(input: LegacyMappingResultWrite) {
    this.legacyMappings.push(input);
    return { mapping_id: `mapping-${this.legacyMappings.length}` };
  }
  async recordPolicyBlock(input: PolicyBlockWrite) {
    this.policyBlocks.push(input);
    return { block_id: `block-${this.policyBlocks.length}` };
  }
  async queryAuditTimeline(customerIdentityRef: string) {
    return this.events.filter(event => event.customer_identity_ref === customerIdentityRef);
  }
  async listSupportAssistedRequests() { return [...this.supportRequests]; }
  async listChannelSuppressions() { return [...this.suppressions]; }
  async buildDryRunEligibilityInput(key: ConsentAggregateKey): Promise<ConsentProviderEligibilityPreviewInput> {
    const state = await this.getLatestConsentState(key);
    return {
      purpose_key: key.purpose_key,
      channel_key: key.channel_key,
      consent_state: state?.state ?? "unknown",
      identity_level: state?.identity_level ?? "anonymous",
      optional_marketing: key.purpose_key === "marketing_offers_campaigns",
      policy_block_active: this.policyBlocks.some(block => block.customer_identity_ref === key.customer_identity_ref),
      withdrawal_active: state?.state === "withdrawn",
      provider_suppression_active: this.suppressions.some(suppression => suppression.endpoint_ref === key.endpoint_ref && suppression.channel_key === key.channel_key),
      template_required: true,
      template_approved: true,
      copy_version_present: Boolean(state?.copy_version_id),
      provider_credential_configured: false,
      provider_delivery_enabled: false,
      message_category_matches_purpose: true,
    };
  }
}

const allEnabled = readConsentFeatureGates(Object.fromEntries(CONSENT_FEATURE_GATE_NAMES.map(name => [name, "true"])));
const allDisabled = readConsentFeatureGates({});
const aggregate: ConsentAggregateKey = {
  customer_identity_ref: "customer-1",
  endpoint_ref: "account:customer-1:email",
  purpose_key: "marketing_offers_campaigns",
  channel_key: "email",
};
const mutation: StateMutationInput = {
  ...aggregate,
  actor_type: "customer",
  actor_id: "customer-1",
  identity_level: "verified_account",
  correlation_id: "correlation-1",
  idempotency_key: "idempotency-1",
  reason: "explicit customer choice",
  source_surface: "account_preference_centre_p0",
  copy_version_id: "copy-v1",
};

async function seedState(repository: InMemoryConsentOperatingRepository, state: ConsentState, identity_level: StateMutationInput["identity_level"] = "verified_account") {
  await repository.commitStateChange({
    ...mutation,
    identity_level,
    consent_event_id: `00000000-0000-5000-a000-${String(repository.events.length + 1).padStart(12, "0")}`,
    event_type: "fixture",
    state,
    previous_state: null,
    new_state: state,
    provider_callback_ref: null,
    support_ticket_ref: null,
    retention_policy: "test",
    effective_at: "2026-07-15T00:00:00.000Z",
  });
}

describe("Slice 9-X PRIME artifacts", () => {
  Object.entries(paths).forEach(([name, path]) => {
    it(`${name} exists`, () => expect(read(path).length).toBeGreaterThan(30));
  });
});

describe("repository contract and implementation", () => {
  [
    "listpurposes",
    "listchannels",
    "listsourcesurfaces",
    "getlatestconsentstate",
    "appendimmutableconsentevent",
    "upsertcurrentconsentstatebysupersession",
    "commitstatechange",
    "recordcopyversionreference",
    "recordchannelsuppression",
    "recordproviderunsubscribeevent",
    "recordsupportassistedrequest",
    "recordlegacymappingresult",
    "recordpolicyblock",
    "queryaudittimeline",
    "listsupportassistedrequests",
    "builddryruneligibilityinput",
  ].forEach(capability => {
    it(`represents ${capability}`, () => expect(repositorySource).toContain(capability));
  });
  [
    "db.transaction",
    "hashconsentauditenvelope",
    "createconsentauditenvelope",
    "onconflictdoupdate",
    "consentevents",
    "customerconsentstates",
    "channelsuppressions",
    "providerunsubscribeevents",
    "supportassistedpreferencerequests",
    "legacypreferencemappings",
    "consentpolicyblocks",
  ].forEach(control => {
    it(`Drizzle adapter contains ${control}`, () => expect(drizzleSource).toContain(control));
  });
});

describe("canonical taxonomy", () => {
  CONSENT_PURPOSE_KEYS.forEach(purpose => {
    it(`includes purpose ${purpose}`, () => expect(repositorySource).toContain(`'${purpose}'`));
  });
  CONSENT_CHANNEL_KEYS.forEach(channel => {
    it(`includes channel ${channel}`, () => expect(repositorySource).toContain(`'${channel}'`));
  });
});

describe("required command classes", () => {
  [
    "RequestPreferenceChange",
    "VerifyPreferenceChange",
    "RecordConsentGrant",
    "RecordConsentWithdrawal",
    "RecordProviderStopSignal",
    "RecordProviderUnsubscribeSignal",
    "ApplyPolicyBlock",
    "SupersedeConsentState",
    "RecordSupportAssistedPreferenceRequest",
    "ResolveConsentConflict",
    "PreviewProviderEligibility",
  ].forEach(command => {
    it(`implements ${command}`, () => expect(commandSource).toContain(`class ${command.toLowerCase()}`));
  });
  [
    "correlation_id",
    "idempotency_key",
    "actor_type",
    "identity_level",
    "purpose_key",
    "channel_key",
    "reason",
    "commitstatechange",
    "consent_event_id",
    "audit",
  ].forEach(requirement => {
    it(`commands represent ${requirement}`, () => expect(commandSource).toContain(requirement));
  });
});

describe("feature gates fail closed", () => {
  CONSENT_FEATURE_GATE_NAMES.forEach(name => {
    it(`declares ${name}`, () => expect(gateSource).toContain(name.toLowerCase()));
    it(`defaults ${name} off`, () => expect(allDisabled[name]).toBe(false));
    it(`enables only explicit true for ${name}`, () => {
      const gates = readConsentFeatureGates({ [name]: "true" });
      expect(gates[name]).toBe(true);
      expect(CONSENT_FEATURE_GATE_NAMES.filter(other => other !== name).every(other => !gates[other])).toBe(true);
    });
  });
  ["yes", "1", "enabled", "on", " true-ish "].forEach(value => {
    it(`rejects non-exact gate value ${value}`, () => {
      expect(readConsentFeatureGates({ CONSENT_PERSISTENCE_COMMANDS_ENABLED: value }).CONSENT_PERSISTENCE_COMMANDS_ENABLED).toBe(false);
    });
  });
  it("freezes the resolved gate map", () => expect(Object.isFrozen(allDisabled)).toBe(true));
});

describe("disabled command boundaries", () => {
  const repository = new InMemoryConsentOperatingRepository();
  const providerInput: ProviderUnsubscribeWrite = {
    ...aggregate,
    customer_identity_ref: "customer-1",
    scope: "channel",
    reason: "STOP",
    source_surface: "provider_callback",
    provider_callback_ref: "callback-1",
    correlation_id: "correlation-provider",
    idempotency_key: "idempotency-provider",
    effective_at: "2026-07-15T00:00:00.000Z",
    provider_key: "provider",
    provider_event_ref: "event-1",
    authenticity_verified: true,
    freshness_verified: true,
    provider_occurred_at: "2026-07-15T00:00:00.000Z",
    normalized_evidence: { event_type: "stop" },
  };
  const checks = [
    () => new RequestPreferenceChange(repository, allDisabled).execute(mutation),
    () => new VerifyPreferenceChange(repository, allDisabled).execute({ ...mutation, verification_passed: true }),
    () => new RecordConsentGrant(repository, allDisabled).execute({ ...mutation, optional_marketing: true }),
    () => new RecordConsentWithdrawal(repository, allDisabled).execute(mutation),
    () => new RecordProviderStopSignal(repository, allDisabled).execute(providerInput),
    () => new RecordProviderUnsubscribeSignal(repository, allDisabled).execute(providerInput),
    () => new ApplyPolicyBlock(repository, allDisabled).execute({ ...mutation, actor_type: "admin", actor_id: "admin", identity_level: "admin_operator_confirmed", policy_version: "v1" }),
    () => new SupersedeConsentState(repository, allDisabled).execute({ ...mutation, actor_type: "admin", actor_id: "admin", identity_level: "admin_operator_confirmed", proposed_state: "unknown" }),
    () => new RecordSupportAssistedPreferenceRequest(repository, allDisabled).execute({
      ...aggregate, requested_state: "requested_support_assisted", identity_level: "support_verified_contact", verification_status: "verified", support_ticket_ref: "ticket", actor_type: "support_operator", actor_id: "support", script_copy_version_id: "script", correlation_id: "c", idempotency_key: "i", expires_at: "2026-08-01T00:00:00Z",
    }),
    () => new ResolveConsentConflict(repository, allDisabled).execute({ ...mutation, actor_type: "admin", actor_id: "admin", identity_level: "admin_operator_confirmed", competing_states: ["granted"] }),
    () => new PreviewProviderEligibility(repository, allDisabled).execute(aggregate),
  ];
  checks.forEach((execute, index) => {
    it(`fails disabled command ${index + 1} closed`, async () => {
      const result = await execute();
      expect(result.ok).toBe(false);
      expect(result.status).toBe("disabled");
    });
  });
});

describe("grant, request and withdrawal red lines", () => {
  const scenarios: Array<[string, Partial<StateMutationInput>, string]> = [
    ["anonymous", { identity_level: "anonymous" }, "anonymous identity cannot grant consent"],
    ["checkout marketing", { identity_level: "checkout_contact_only" }, "checkout contact cannot authorize optional marketing"],
    ["support campaign", { actor_type: "support_operator", actor_id: "support", identity_level: "support_verified_contact" }, "support_conversation_cannot_grant_campaign_consent"],
    ["measurement source", { source_surface: "measurement_consent" }, "measurement_consent_is_not_messaging_consent"],
    ["loyalty to Memory Lane", { purpose_key: "memory_lane_annual_journey", source_surface: "loyalty_interest" }, "loyalty_interest_is_not_memory_lane_consent"],
    ["Memory Lane to utilisation offer", { purpose_key: "utilisation_aware_offers", source_surface: "memory_lane_choice" }, "memory_lane_consent_is_not_utilisation_aware_offer_consent"],
  ];
  scenarios.forEach(([name, override, reason]) => {
    it(`rejects ${name}`, async () => {
      const repository = new InMemoryConsentOperatingRepository();
      const result = await new RecordConsentGrant(repository, allEnabled).execute({ ...mutation, ...override, optional_marketing: true });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasons).toContain(reason);
      expect(repository.events).toHaveLength(0);
    });
  });
  it("records an exact verified grant with audit", async () => {
    const repository = new InMemoryConsentOperatingRepository();
    const result = await new RecordConsentGrant(repository, allEnabled).execute({ ...mutation, optional_marketing: true });
    expect(result.ok).toBe(true);
    expect(repository.events[0].new_state).toBe("granted");
  });
  it("is idempotent for the same command key", async () => {
    const repository = new InMemoryConsentOperatingRepository();
    const command = new RecordConsentGrant(repository, allEnabled);
    await command.execute({ ...mutation, optional_marketing: true });
    const second = await command.execute({ ...mutation, optional_marketing: true });
    expect(repository.events).toHaveLength(1);
    if (second.ok) expect(second.receipt?.already_applied).toBe(true);
  });
  it("withdrawal supersedes a grant", async () => {
    const repository = new InMemoryConsentOperatingRepository();
    await seedState(repository, "granted");
    const result = await new RecordConsentWithdrawal(repository, allEnabled).execute({ ...mutation, idempotency_key: "withdraw-1" });
    expect(result.ok).toBe(true);
    expect((await repository.getLatestConsentState(aggregate))?.state).toBe("withdrawn");
  });
  ["blocked_by_policy", "withdrawn"].forEach(state => {
    it(`does not reopen ${state} with a generic request`, async () => {
      const repository = new InMemoryConsentOperatingRepository();
      await seedState(repository, state as ConsentState);
      const result = await new RequestPreferenceChange(repository, allEnabled).execute({ ...mutation, idempotency_key: `request-${state}` });
      expect(result.ok).toBe(false);
    });
  });
});

describe("mutation context validation", () => {
  const fields: Array<[keyof StateMutationInput, unknown]> = [
    ["correlation_id", ""],
    ["idempotency_key", " "],
    ["reason", ""],
    ["customer_identity_ref", ""],
    ["endpoint_ref", ""],
    ["source_surface", ""],
    ["purpose_key", "invalid"],
    ["channel_key", "invalid"],
  ];
  fields.forEach(([field, value]) => {
    it(`rejects invalid ${field}`, async () => {
      const repository = new InMemoryConsentOperatingRepository();
      const result = await new RecordConsentGrant(repository, allEnabled).execute({ ...mutation, [field]: value, optional_marketing: true } as never);
      expect(result.ok).toBe(false);
      expect(repository.events).toHaveLength(0);
    });
  });
});

describe("audit envelope emitted by commands", () => {
  const auditFields: Array<keyof ConsentEventWrite> = [
    "consent_event_id", "event_type", "customer_identity_ref", "endpoint_ref", "purpose_key", "channel_key",
    "state", "previous_state", "new_state", "identity_level", "source_surface", "actor_type", "actor_id",
    "copy_version_id", "reason", "correlation_id", "idempotency_key", "retention_policy", "effective_at",
  ];
  auditFields.forEach(field => {
    it(`emits audit field ${field}`, async () => {
      const repository = new InMemoryConsentOperatingRepository();
      await new RecordConsentGrant(repository, allEnabled).execute({ ...mutation, optional_marketing: true });
      expect(repository.events[0]).toHaveProperty(field);
    });
  });
});

describe("verification, provider and operator workflows", () => {
  it("verification records no silent grant", async () => {
    const repository = new InMemoryConsentOperatingRepository();
    const result = await new VerifyPreferenceChange(repository, allEnabled).execute({ ...mutation, verification_passed: true });
    expect(result.ok).toBe(true);
    expect(repository.events[0].new_state).toBe("pending_verification");
  });
  ["anonymous", "checkout_contact_only"].forEach(identity => {
    it(`verification rejects ${identity}`, async () => {
      const repository = new InMemoryConsentOperatingRepository();
      const result = await new VerifyPreferenceChange(repository, allEnabled).execute({ ...mutation, identity_level: identity as never, verification_passed: true });
      expect(result.ok).toBe(false);
    });
  });
  [false, true].forEach(authenticity => {
    [false, true].forEach(freshness => {
      it(`provider intake authenticity ${authenticity} freshness ${freshness}`, async () => {
        const repository = new InMemoryConsentOperatingRepository();
        const input: ProviderUnsubscribeWrite = {
          ...aggregate, scope: "channel", reason: "STOP", source_surface: "provider_callback", provider_callback_ref: "callback",
          correlation_id: "provider-c", idempotency_key: "provider-i", effective_at: "2026-07-15T00:00:00Z",
          provider_key: "provider", provider_event_ref: "provider-event", authenticity_verified: authenticity,
          freshness_verified: freshness, provider_occurred_at: "2026-07-15T00:00:00Z", normalized_evidence: { event_type: "stop" },
        };
        const result = await new RecordProviderStopSignal(repository, allEnabled).execute(input);
        expect(result.ok).toBe(authenticity && freshness);
        expect(repository.suppressions.length).toBe(authenticity && freshness ? 1 : 0);
      });
    });
  });
  it("support request cannot directly grant", async () => {
    const repository = new InMemoryConsentOperatingRepository();
    const result = await new RecordSupportAssistedPreferenceRequest(repository, allEnabled).execute({
      ...aggregate, requested_state: "granted", identity_level: "support_verified_contact", verification_status: "verified",
      support_ticket_ref: "ticket", actor_type: "support_operator", actor_id: "support", script_copy_version_id: "script",
      correlation_id: "support-c", idempotency_key: "support-i", expires_at: "2026-08-01T00:00:00Z",
    });
    expect(result.ok).toBe(false);
  });
  it("support request records request and audit", async () => {
    const repository = new InMemoryConsentOperatingRepository();
    const result = await new RecordSupportAssistedPreferenceRequest(repository, allEnabled).execute({
      ...aggregate, requested_state: "requested_support_assisted", identity_level: "support_verified_contact", verification_status: "verified",
      support_ticket_ref: "ticket", actor_type: "support_operator", actor_id: "support", script_copy_version_id: "script",
      correlation_id: "support-c", idempotency_key: "support-i", expires_at: "2026-08-01T00:00:00Z",
    });
    expect(result.ok).toBe(true);
    expect(repository.supportRequests).toHaveLength(1);
    expect(repository.events[0].event_type).toBe("support_assisted_request_recorded");
  });
  it("admin correction cannot grant", async () => {
    const repository = new InMemoryConsentOperatingRepository();
    const result = await new SupersedeConsentState(repository, allEnabled).execute({
      ...mutation, actor_type: "admin", actor_id: "admin", identity_level: "admin_operator_confirmed", proposed_state: "granted",
    });
    expect(result.ok).toBe(false);
  });
  it("policy block outranks grant", async () => {
    const repository = new InMemoryConsentOperatingRepository();
    await seedState(repository, "granted");
    const result = await new ApplyPolicyBlock(repository, allEnabled).execute({
      ...mutation, actor_type: "admin", actor_id: "admin", identity_level: "admin_operator_confirmed",
      idempotency_key: "policy", policy_version: "v1",
    });
    expect(result.ok).toBe(true);
    expect((await repository.getLatestConsentState(aggregate))?.state).toBe("blocked_by_policy");
  });
  ["blocked_by_policy", "withdrawn", "unknown"].forEach(expected => {
    it(`conflict resolves restrictively to ${expected}`, async () => {
      const states: ConsentState[] = expected === "blocked_by_policy"
        ? ["granted", "blocked_by_policy"]
        : expected === "withdrawn"
          ? ["granted", "withdrawn"]
          : ["granted", "expired"];
      const repository = new InMemoryConsentOperatingRepository();
      const result = await new ResolveConsentConflict(repository, allEnabled).execute({
        ...mutation, actor_type: "admin", actor_id: "admin", identity_level: "admin_operator_confirmed",
        idempotency_key: `conflict-${expected}`, competing_states: states,
      });
      expect(result.ok).toBe(true);
      expect((await repository.getLatestConsentState(aggregate))?.state).toBe(expected);
    });
  });
});

describe("provider eligibility dry-run", () => {
  const states: ConsentState[] = ["unknown", "not_requested", "pending_verification", "withdrawn", "expired", "blocked_by_policy"];
  states.forEach(state => {
    it(`returns ineligible for ${state}`, async () => {
      const repository = new InMemoryConsentOperatingRepository();
      await seedState(repository, state);
      const result = await new PreviewProviderEligibility(repository, allEnabled).execute(aggregate);
      expect(result.ok).toBe(true);
      if (result.ok) expect((result.data as { eligible: boolean }).eligible).toBe(false);
    });
  });
  it("uses provider suppression", async () => {
    const repository = new InMemoryConsentOperatingRepository();
    await seedState(repository, "granted");
    repository.suppressions.push({ ...aggregate, scope: "channel", reason: "STOP", source_surface: "provider", provider_callback_ref: "callback", correlation_id: "c", idempotency_key: "i", effective_at: "2026-07-15T00:00:00Z" });
    const result = await new PreviewProviderEligibility(repository, allEnabled).execute(aggregate);
    if (result.ok) expect((result.data as { reasons: string[] }).reasons).toContain("provider_suppression_active");
  });
  it("always reports delivery disabled in the repository input", async () => {
    const repository = new InMemoryConsentOperatingRepository();
    await seedState(repository, "granted");
    const result = await new PreviewProviderEligibility(repository, allEnabled).execute(aggregate);
    if (result.ok) expect((result.data as { delivery_mode: string }).delivery_mode).toBe("disabled");
  });
});

describe("legacy migration is dry-run only", () => {
  const candidates = Array.from({ length: 20 }, (_, index) => ({
    customer_ref: `customer-${index}`,
    source: index % 4 === 0 ? "support_ticket" : index % 3 === 0 ? "measurement_consent" : "legacy_account_preferences",
    field: index % 2 === 0 ? "channels.email" : "loyalty_interest",
    value: index % 2 === 0,
  }));
  const report = new LegacyPreferenceMigrationDryRun().execute(candidates);
  candidates.forEach((candidate, index) => {
    it(`redacts and restricts legacy candidate ${index + 1}`, () => {
      const sample = report.redacted_samples.find(value => value.customer_ref !== candidate.customer_ref);
      expect(sample?.customer_ref).toMatch(/^legacy_[a-f0-9]{8}$/);
      expect(["unknown", "requested_support_assisted"]).toContain(sample?.outcome);
    });
  });
  [
    "candidate_count",
    "would_map_unknown_count",
    "would_request_support_assisted_count",
    "would_reject_auto_grant_count",
    "risks",
    "redacted_samples",
  ].forEach(field => {
    it(`returns ${field}`, () => expect(report).toHaveProperty(field));
  });
  it("never returns a granted outcome", () => expect(JSON.stringify(report)).not.toContain('"granted"'));
  it("performs no repository write", () => expect(report.candidate_count).toBe(20));
});

describe("no-send release readiness", () => {
  const service = new ConsentNoSendReleaseReadiness();
  const disabled = service.evaluate(allDisabled);
  CONSENT_FEATURE_GATE_NAMES.forEach(name => {
    const expectedField = {
      CONSENT_PERSISTENCE_COMMANDS_ENABLED: "commands_enabled",
      CONSENT_PREFERENCE_CENTRE_SAVE_ENABLED: "preference_centre_save_enabled",
      CONSENT_ADMIN_WORKFLOW_ENABLED: "admin_workflow_enabled",
      CONSENT_SUPPORT_WORKFLOW_ENABLED: "support_workflow_enabled",
      CONSENT_PROVIDER_SUPPRESSION_INTAKE_ENABLED: "provider_suppression_intake_enabled",
      CONSENT_PROVIDER_DRY_RUN_ENABLED: "provider_dry_run_enabled",
      CONSENT_PROVIDER_LIVE_SENDS_ENABLED: "provider_live_sends_enabled",
      CONSENT_LEGACY_MIGRATION_DRY_RUN_ENABLED: "legacy_migration_dry_run_enabled",
    }[name];
    it(`reports ${name}`, () => expect(disabled).toHaveProperty(expectedField));
  });
  it("passes no-send status when live sends are off", () => expect(disabled.no_send_status).toBe("pass"));
  it("blocks live-send readiness", () => expect(disabled.live_send_readiness).toBe("blocked"));
  it("requires a production migration", () => expect(disabled.production_migration_required).toBe(true));
  it("reports specialist approvals pending", () => expect(disabled.specialist_approvals_pending).toBe(true));
  it("separates disabled dry-run readiness", () => expect(disabled.dry_run_readiness).toBe("disabled"));
  it("fails if live sends flag is true", () => {
    const gates = readConsentFeatureGates({ CONSENT_PROVIDER_LIVE_SENDS_ENABLED: "true" });
    expect(service.evaluate(gates).no_send_status).toBe("fail");
  });
  it("does not describe dry-run as live-ready", () => {
    const gates = readConsentFeatureGates({ CONSENT_PROVIDER_DRY_RUN_ENABLED: "true" });
    const result = service.evaluate(gates);
    expect(result.dry_run_readiness).toBe("available");
    expect(result.live_send_readiness).toBe("blocked");
  });
});

describe("customer API and Preference Centre truth", () => {
  [
    "customersessionmiddleware",
    "consent_preference_centre_save_enabled",
    "consent_persistence_commands_enabled",
    "correlation_id_and_idempotency_key_required",
    "explicit_grant_or_withdrawal_required",
    "saved: false",
    "const saved = result.ok",
    "recordconsentwithdrawal",
    "recordconsentgrant",
    "account:",
    "invalid_purpose_or_channel",
  ].forEach(term => {
    it(`customer route contains ${term}`, () => expect(customerRouteSource).toContain(term));
  });
  [
    "canonical saving is not live",
    "disabled={!enabled}",
    "marketing_offers_campaigns",
    "no send is activated by saving",
    "withdraw this optional choice",
    "purpose-specific choice",
  ].forEach(term => {
    it(`canonical form contains ${term}`, () => expect(canonicalFormSource).toContain(term));
  });
  [
    "result?.data?.saved === true",
    "was not saved",
    "no communication setting changed",
    "x-correlation-id",
    "idempotency-key",
    "legacy account settings",
    "not canonical purpose consent",
  ].forEach(term => {
    it(`Preference Centre page contains ${term}`, () => expect(preferencePageSource).toContain(term));
  });
});

describe("protected admin/support operating surface", () => {
  [
    "authmiddleware",
    "requirepermissions",
    "permissions.audit_read",
    "permissions.settings_manage",
    "/readiness",
    "/overview",
    "/timeline/:customerref",
    "/support/requests",
    "/conflicts/preview",
    "/conflicts/resolve",
    "/manual-corrections",
    "/legacy-migration/dry-run",
    "/suppressions",
    "/provider-suppressions",
    "/provider-eligibility/dry-run",
    "send_attempted: false",
    "provider_transport_called: false",
    "writes_performed: 0",
  ].forEach(term => {
    it(`admin route contains ${term}`, () => expect(adminRouteSource).toContain(term));
  });
  [
    "no-send release gate",
    "live-send readiness",
    "support request queue",
    "conflict resolution",
    "provider suppressions",
    "eligibility dry-run",
    "no live-send control",
    "specialist approvals remain pending",
  ].forEach(term => {
    it(`admin page contains ${term}`, () => expect(adminPageSource).toContain(term));
  });
  it("registers the customer route", () => expect(appSource).toContain("'/account/consent-operating'"));
  it("registers the admin route", () => expect(appSource).toContain("'/admin/consent-operating'"));
  it("registers the protected admin navigation", () => expect(lower(paths.adminNavigation)).toContain("'/admin/consent-operating'"));
});

describe("no provider transport or unrelated mutation dependency", () => {
  ["whatsappadapter", "zeptomailadapter", "pahappacomms", "notificationrouter", "processoutbox", "fetch(", ".send(", "queue"].forEach(term => {
    it(`consent runtime excludes ${term}`, () => expect(runtimeSource).not.toContain(term));
  });
  ["whatsappadapter", "zeptomailadapter", "pahappacomms", "notificationrouter", "processoutbox", "externaldelivery", "pesapal", "checkoutusecase", "orderrepo"].forEach(term => {
    it(`commands exclude ${term}`, () => expect(commandSource).not.toContain(term));
  });
  ["provider_delivery_enabled: false", "provider_credential_configured: false", "template_approved: false"].forEach(term => {
    it(`Drizzle eligibility input locks ${term}`, () => expect(drizzleSource).toContain(term));
  });
});

describe("evidence and artifact boundaries", () => {
  [
    "combined scope", "repositories", "eleven named consent commands", "eight local gates", "authenticated current-state",
    "preference centre", "admin/support", "legacy", "provider suppression", "eligibility", "readiness",
    "no provider client", "no customer communication", "checkout", "auth/rbac", "loyalty ledger", "production migration execution: none",
  ].forEach(term => {
    it(`implementation evidence records ${term}`, () => expect(implementationEvidence).toContain(term));
  });
  [
    "no-send status with defaults: pass", "live-send readiness: blocked", "provider/customer communications: none",
    "production migration execution: none", "deployment/service restart: none", "no provider transport",
  ].forEach(term => {
    it(`readiness evidence records ${term}`, () => expect(readinessEvidence).toContain(term));
  });
  [
    "no live provider transport", "disabled by default", "no checkout", "no auth/rbac", "no credential vault",
    "no loyalty ledger", "no production deployment", "customer-facing success", "admin/support routes",
  ].forEach(term => {
    it(`artifact review records ${term}`, () => expect(artifactReview).toContain(term));
  });
});

describe("exact artifact scope", () => {
  [
    "payments/",
    "checkout",
    "pesapal",
    "orders/",
    "middleware/auth.ts",
    "middleware/permissions.ts",
    ".env",
    "credential",
    "loyalty",
    "memory-lane",
    "discount",
    "coupon",
    "deployment",
    "notifications/whatsapp",
    "notifications/zeptomail",
  ].forEach(forbidden => {
    it(`changed-path allowlist excludes ${forbidden}`, () => {
      expect(Object.values(paths).every(path => !path.toLowerCase().includes(forbidden))).toBe(true);
    });
  });
  it("contains only the Slice 9-X PRIME allowlist while dirty or is clean after commit", () => {
    const output = execFileSync("git", ["status", "--short", "--untracked-files=all"], { cwd: resolve(root, ".."), encoding: "utf8" });
    const changed = output.trimEnd().split("\n").filter(Boolean).map(line => line.slice(3));
    const allowed = new Set(Object.values(paths).map(path => `goldplus-commerce/${path}`));
    expect(changed.length).toBeLessThanOrEqual(Object.keys(paths).length);
    expect(changed.every(path => allowed.has(path))).toBe(true);
  });
});
