import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const paths = {
  proposal: "docs/platform/evidence/slices/slice-09-b2-consent-persistence-design-proposal.md",
  readiness: "docs/platform/evidence/slices/slice-09-b2-implementation-readiness-checklist.md",
  review: "docs/platform/evidence/slices/slice-09-b2-artifact-review.md",
  test: "tests/unit/Slice09B2ConsentPersistenceDesignProposal.test.ts",
};
const read = (path: string) => readFileSync(resolve(root, path), "utf8").toLowerCase();
const proposal = read(paths.proposal);
const readiness = read(paths.readiness);
const review = read(paths.review);

describe("Slice 9-B2 artifacts", () => {
  Object.entries(paths).forEach(([name, path]) => it(`${name} exists`, () => expect(readFileSync(resolve(root, path), "utf8").length).toBeGreaterThan(100)));
});

describe("required proposal sections", () => {
  ["executive design summary", "design-only authorization boundary", "non-authorized implementation boundary", "canonical consent domain model", "proposed future data model", "proposed command model", "proposed audit event model", "identity verification model", "source precedence and conflict resolution", "legacy account flag migration design", "provider stop/unsubscribe suppression design", "admin/operator workflow design", "support-assisted update workflow design", "provider enforcement dry-run design", "privacy/security/legal review blockers", "implementation slice plan", "test strategy", "rollback and failure strategy", "open questions"].forEach(section => it(`contains ${section}`, () => expect(proposal).toContain(section)));
});

describe("design-only boundary", () => {
  ["this design proposes future implementation", "does not create migrations", "does not implement apis", "does not persist preferences", "does not activate provider enforcement", "does not send customer communications", "formal specialist approvals remain blockers", "not legal, privacy, security"].forEach(term => it(`states ${term}`, () => expect(proposal).toContain(term)));
});

describe("future logical entities", () => {
  ["consent_purposes", "consent_channels", "customer_consent_states", "consent_events", "consent_copy_versions", "consent_source_surfaces", "channel_suppressions", "provider_unsubscribe_events", "support_assisted_preference_requests", "legacy_preference_mappings", "consent_policy_blocks"].forEach(entity => it(`lists ${entity}`, () => expect(proposal).toContain(`\`${entity}\``)));
});

describe("required future field concepts", () => {
  ["purpose_key", "channel_key", "customer_identity_ref", "identity_verification_level", "state", "source_surface", "copy_version_id", "previous_state", "new_state", "actor_type", "actor_id", "reason", "correlation_id", "provider_callback_ref", "support_ticket_ref", "policy_block_reason", "created_at", "effective_at", "expires_at"].forEach(field => it(`includes ${field}`, () => expect(proposal).toContain(field)));
});

describe("future command contracts", () => {
  ["requestpreferencechange", "verifypreferencechange", "recordconsentgrant", "recordconsentwithdrawal", "recordproviderstopsignal", "recordproviderunsubscribesignal", "applypolicyblock", "supersedeconsentstate", "recordsupportassistedpreferencerequest", "resolveconsentconflict", "previewprovidereligibility"].forEach(command => it(`defines ${command}`, () => expect(proposal).toContain(`\`${command}\``)));
});

describe("immutable audit events", () => {
  ["consent_grant_recorded", "consent_withdrawal_recorded", "preference_change_requested", "preference_change_verified", "provider_stop_recorded", "provider_unsubscribe_recorded", "policy_block_applied", "consent_state_superseded", "support_assisted_request_recorded", "consent_conflict_resolved", "provider_eligibility_previewed"].forEach(event => it(`defines ${event}`, () => expect(proposal).toContain(event)));
  ["consent_event_id", "customer_identity_ref", "purpose_key", "channel_key", "state", "source_surface", "actor_type", "actor_id", "timestamp", "copy_version_id", "previous_state", "new_state", "provider_callback_ref", "retention_policy", "tamper_evidence_ref"].forEach(field => it(`audit includes ${field}`, () => expect(proposal).toContain(field)));
});

describe("identity assurance", () => {
  ["anonymous", "checkout_contact_only", "support_verified_contact", "verified_account", "provider_callback_verified", "admin_operator_confirmed"].forEach(level => it(`defines ${level}`, () => expect(proposal).toContain(`\`${level}\``)));
  ["anonymous cannot save consent", "checkout contact only cannot authorize marketing", "cannot directly grant", "no manual override"].forEach(rule => it(`enforces ${rule}`, () => expect(proposal).toContain(rule)));
});

describe("source precedence", () => {
  ["1. legal/policy block", "2. provider stop or unsubscribe callback", "3. verified withdrawal", "4. verified customer account preference", "5. verified support-assisted update", "6. audited preference centre submission", "7. service communication necessity from checkout/order", "8. legacy newsletter interest", "9. marketing campaign import", "10. unknown or implicit intent"].forEach(rule => it(`orders ${rule}`, () => expect(proposal).toContain(rule)));
  ["withdrawal overrides optional marketing", "provider stop suppresses the affected channel", "checkout contact is service-only", "support conversation is support-follow-up only", "legacy broad flags cannot become canonical consent", "measurement consent is not messaging consent", "loyalty consent is not memory lane consent", "memory lane consent is not utilisation-aware offer consent", "unknown intent cannot authorize provider sends"].forEach(rule => it(`preserves ${rule}`, () => expect(proposal).toContain(rule)));
});

describe("legacy migration", () => {
  ["map to `unknown` or `requested_support_assisted`", "no automatic marketing grant", "no automatic memory lane grant", "no automatic provider enforcement", "customer re-confirmation", "migration dry-run", "rollback"].forEach(rule => it(`includes ${rule}`, () => expect(proposal).toContain(rule)));
});

describe("provider suppression", () => {
  ["signature", "freshness", "replay protection", "channel-specific", "purpose-specific", "global channel stop", "wins over local optional marketing preference"].forEach(rule => it(`includes ${rule}`, () => expect(proposal).toContain(rule)));
});

describe("provider dry-run", () => {
  ["purpose allowed", "channel allowed", "exact current grant", "verified subject and endpoint", "no active withdrawal", "no suppression", "category matches purpose", "template approved", "rate/cap respected", "audit event could be written", "provider_delivery_remains_disabled", "no live send"].forEach(rule => it(`checks ${rule}`, () => expect(proposal).toContain(rule)));
});

describe("operator and support workflows", () => {
  ["consent review dashboard", "support-assisted request queue", "manual correction", "dispute workflow", "immutable audit viewer", "conflict-resolution panel", "provider-suppression viewer", "dry-run eligibility preview"].forEach(item => it(`designs ${item}`, () => expect(proposal).toContain(item)));
});

describe("future implementation slices", () => {
  ["9-b2a — specialist review closure pack", "9-b3 — schema and audit migration implementation, no provider sends", "9-b4 — write command implementation, no provider sends", "9-b5 — admin/support review workflow p0", "9-b6 — provider enforcement dry-run, no sends", "9-b7 — preference centre persistence uat, no sends", "9-b8 — provider enforcement live readiness gate"].forEach(slice => it(`plans ${slice}`, () => expect(proposal).toContain(slice)));
});

describe("readiness checklist", () => {
  it("tracks all owners and pending specialist approvals", () => {
    ["legal", "privacy/data protection", "security", "product", "operator/support", "provider/channel", "data-owner/analytics", "business sponsor", "engineering", "qa", "release management"].forEach(group => expect(readiness).toContain(group));
    expect(readiness).toContain("pending specialist approval");
    expect(readiness).toContain("status");
    expect(readiness).toContain("owner");
    expect(readiness).toContain("required evidence");
    expect(readiness).toContain("blocks future slice");
  });
});

describe("artifact scope evidence", () => {
  ["changed files", "allowed files", "excluded files", "runtime-page check", "migration/schema implementation check", "api mutation/persistence check", "provider/transport check", "checkout/payment/order check", "auth/rbac check", "loyalty/offer check"].forEach(check => it(`records ${check}`, () => expect(review).toContain(check)));
  it("contains only four allowed paths", () => {
    const output = execFileSync("git", ["status", "--short"], { cwd: resolve(root, ".."), encoding: "utf8" });
    const changed = output.trimEnd().split("\n").filter(Boolean).map(line => line.slice(3));
    const allowed = new Set(Object.values(paths).map(path => `goldplus-commerce/${path}`));
    expect([0, 4]).toContain(changed.length);
    expect(changed.every(path => allowed.has(path))).toBe(true);
  });
});
