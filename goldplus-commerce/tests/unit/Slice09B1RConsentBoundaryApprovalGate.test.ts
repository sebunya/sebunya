import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const recordPath = "docs/platform/evidence/slices/slice-09-b1r-canonical-consent-boundary-approval-record.md";
const reviewPath = "docs/platform/evidence/slices/slice-09-b1r-artifact-review.md";
const testPath = "tests/unit/Slice09B1RConsentBoundaryApprovalGate.test.ts";
const record = read(recordPath);
const review = read(reviewPath);
const combined = `${record}\n${review}`;

const allowedArtifacts = [recordPath, reviewPath, testPath];
const purposes = [
  "service_order_updates",
  "support_follow_up",
  "warranty_product_care",
  "product_education",
  "marketing_offers_campaigns",
  "loyalty_programme_updates",
  "quest_progress_and_badges",
  "memory_lane_annual_journey",
  "personalised_product_guidance",
  "utilisation_aware_offers",
  "research_feedback_surveys",
  "account_security_notifications",
];
const channels = ["whatsapp", "email", "sms", "phone", "in_account", "support_assisted"];
const legacySurfaces = [
  "Public `/preferences`",
  "`/consent` alias",
  "Legacy authenticated account preferences",
  "Newsletter/footer interest area",
  "Checkout contact collection",
  "Support contact/follow-up path",
  "Privacy/terms preference language",
  "Measurement consent references",
  "External Delivery/provider references",
  "Loyalty readiness references",
  "Memory Lane readiness references",
  "Personalisation/utilisation-aware readiness",
  "Admin readiness evidence",
  "Tests and evidence",
];
const precedence = [
  "Legal/policy block",
  "Provider STOP or unsubscribe callback",
  "Verified withdrawal",
  "Verified customer account preference",
  "Verified support-assisted update",
  "Audited Preference Centre submission",
  "Service communication necessity from checkout/order",
  "Legacy newsletter interest",
  "Marketing campaign import",
  "Unknown or implicit intent",
];
const states = [
  "unknown",
  "not_requested",
  "requested_support_assisted",
  "pending_verification",
  "granted",
  "withdrawn",
  "expired",
  "superseded",
  "blocked_by_policy",
  "service_only",
];
const providerGates = [
  "Purpose allowed",
  "Channel allowed",
  "Channel consent current",
  "Identity verified",
  "Withdrawal respected",
  "suppression checked",
  "Message category matches purpose",
  "Template approved where required",
  "Customer copy version compatible",
  "Support exception policy passes",
  "Rate, frequency, quiet-hours, budget, margin, fairness, and capacity caps pass",
  "Audit log written or durably queued",
  "Provider credential configured and isolated",
  "Provider delivery explicitly enabled",
];
const slice9B2Designs = [
  "database schema proposal",
  "API command proposal",
  "identity verification approach",
  "audit trail design",
  "consent copy versioning design",
  "source precedence implementation plan",
  "migration plan for legacy account flags",
  "provider enforcement dry-run interface design",
  "admin review workflow design",
  "support-assisted update workflow design",
  "test plan",
  "rollback plan",
];

const markdownRow = (key: string) => record.split("\n").find((line) => line.startsWith(`| ${key} |`));

describe("Slice 9-B1R approval record", () => {
  it("exists and identifies the exact Slice 9-B1 baseline", () => expect(record).toContain("`c67ec7df6db3ccaf8bd33bf00a63da539221d39a`"));
  it("references the Slice 9-B1 discovery", () => expect(record).toContain("`slice-09-b1-preference-surface-discovery.md`"));
  it("references the Slice 9-B1 blueprint", () => expect(record).toContain("`slice-09-b1-consent-source-of-truth-blueprint.md`"));
  it("references the Slice 9-B Preference Centre evidence", () => expect(record).toContain("`slice-09-b-consent-preference-centre-p0.md`"));
  it("declares architecture and design-boundary approval only", () => expect(record).toMatch(/Approval type: architecture and design-boundary approval only/i));
});

describe("Slice 9-B1R purpose boundary", () => {
  it.each(purposes)("explicitly decides purpose %s", (purpose) => {
    const row = markdownRow(`\`${purpose}\``);
    expect(row).toBeDefined();
    expect(row).toContain("Approved for future design only");
    expect(row).toMatch(/service|support|product education|marketing|loyalty|personalisation|research|security/);
    expect(row).toMatch(/verified|checkout contact only/);
    expect(row).toMatch(/required|service necessity|service-limited/);
    expect(row).toMatch(/Withdrawable|Service-limited|STOP|policy block/i);
    expect(row).toMatch(/Copy version/);
    expect(row).toMatch(/Prohibited now/);
  });
});

describe("Slice 9-B1R channel boundary", () => {
  it.each(channels)("explicitly decides channel %s", (channel) => {
    const row = markdownRow(`\`${channel}\``);
    expect(row).toBeDefined();
    expect(row).toMatch(/Approved|service|support|consented/i);
    expect(row).toMatch(/Not-approved|treated as|inferred|campaign|unverified|automatic consent/i);
    expect(row).toMatch(/template|script|copy/i);
    expect(row).toMatch(/Disabled|No new capability|Request source only|campaigns disabled/i);
  });

  it("requires explicit WhatsApp consent and an approved template", () => expect(record).toMatch(/WhatsApp marketing requires explicit WhatsApp consent and approved template/i));
  it("requires explicit SMS consent and opt-out handling", () => expect(record).toMatch(/SMS marketing requires explicit SMS consent and opt-out handling/i));
  it("requires email consent and unsubscribe handling", () => expect(record).toMatch(/email marketing requires email consent and unsubscribe handling/i));
  it("keeps phone support follow-up separate from campaign consent", () => expect(record).toMatch(/Phone support follow-up treated as campaign consent/));
  it("keeps support-assisted requests separate from provider enforcement", () => expect(record).toMatch(/Request source only; no update or send authorized now/));
});

describe("Slice 9-B1R legacy surface decisions", () => {
  it.each(legacySurfaces)("decides legacy surface %s", (surface) => {
    const row = markdownRow(surface);
    expect(row).toBeDefined();
    expect(row).toContain("| Yes | No |");
    expect(row).toMatch(/Low|Medium|High/);
  });

  it("keeps checkout contact service-only", () => expect(record).toMatch(/checkout contact is service-only and cannot broaden into marketing/i));
  it("keeps support conversation support-follow-up only", () => expect(record).toMatch(/Support conversation is support-follow-up only/i));
  it("requires purpose decomposition for legacy account flags", () => expect(record).toMatch(/Decompose broad channel flags by purpose/));
  it("states Measurement consent is not messaging consent", () => expect(record).toMatch(/Measurement consent is not messaging consent/i));
  it("states loyalty consent is not Memory Lane consent", () => expect(record).toMatch(/Loyalty consent is not Memory Lane consent/i));
  it("states Memory Lane consent is not utilisation-aware offer consent", () => expect(record).toMatch(/Memory Lane consent is not utilisation-aware offer consent/i));
});

describe("Slice 9-B1R source precedence", () => {
  it("contains all ten precedence levels in the approved order", () => {
    const positions = precedence.map((source, index) => record.indexOf(`${index + 1}. **${source}**`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("makes provider STOP override local marketing preference", () => expect(record).toMatch(/Provider STOP wins over local marketing preference for that channel/i));
  it("makes withdrawal win over marketing", () => expect(record).toMatch(/Withdrawal wins over marketing/i));
  it("prevents unknown intent from authorizing provider sends", () => expect(record).toMatch(/Unknown intent cannot authorize provider sends/i));
  it("prevents checkout and support from broadening", () => {
    expect(record).toMatch(/Checkout contact cannot broaden into marketing/i);
    expect(record).toMatch(/Support contact cannot broaden into campaigns/i);
  });
});

describe("Slice 9-B1R consent state approval", () => {
  it.each(states)("approves state %s with a complete decision", (state) => {
    const row = markdownRow(`\`${state}\``);
    expect(row).toBeDefined();
    expect(row).toMatch(/Deny|May allow|Historical evidence/);
    expect(row).toMatch(/Yes|No by itself|No/);
    expect(row).toMatch(/Reversible|reversible|expires|Historical|authorized policy event|never promotes/);
  });

  it("allows only current verified purpose/channel grants to contribute to optional sends", () => expect(record).toMatch(/Only `granted`, purpose-specific, channel-specific, verified, current consent may contribute/i));
});

describe("Slice 9-B1R audit approval", () => {
  it("requires every minimum audit field", () => {
    for (const field of [
      "consent_event_id",
      "customer_id",
      "purpose",
      "channel",
      "state",
      "source_surface",
      "actor_type",
      "actor_id",
      "timestamp",
      "copy_version_shown",
      "previous_state",
      "new_state",
      "reason",
      "support_ticket_reference",
      "provider_callback_reference",
      "correlation_id",
      "retention_policy",
    ]) expect(record).toContain(`\`${field}\``);
  });

  it("requires immutable or tamper-evident audit events", () => expect(record).toMatch(/No future persistence design is approved unless it includes immutable or tamper-evident audit events/i));
});

describe("Slice 9-B1R provider enforcement gate", () => {
  it.each(providerGates)("requires future provider gate: %s", (gate) => expect(record.toLowerCase()).toContain(gate.toLowerCase()));
  it("keeps provider enforcement disabled", () => expect(record).toMatch(/Provider enforcement remains disabled/i));
  it("authorizes no WhatsApp, email, SMS, or customer send", () => expect(record).toMatch(/No WhatsApp, email, SMS, phone campaign, provider send, or customer communication is authorized/i));
});

describe("Slice 9-B1R Slice 9-B2 permission boundary", () => {
  it.each(slice9B2Designs)("permits design only for %s", (item) => expect(record).toContain(`- ${item}`));

  it("prohibits every requested implementation category", () => {
    for (const item of [
      "migrations",
      "live persistence",
      "API mutation",
      "provider sends",
      "provider enforcement",
      "customer communications",
      "loyalty activation",
      "Memory Lane activation",
      "personalisation activation",
      "discount or coupon activation",
      "checkout mutation",
      "auth/RBAC rewrite",
    ]) expect(record).toContain(`- ${item}`);
  });

  it("states Slice 9-B2 must remain design-only", () => expect(record).toMatch(/Slice 9-B2 must remain design-only/i));
});

describe("Slice 9-B1R artifact and no-runtime-change safety", () => {
  it("allows exactly three evidence/test artifacts", () => expect(review.match(/^\d+\. `.+`$/gm)).toHaveLength(3));
  it.each(allowedArtifacts)("allowlists %s", (artifact) => expect(review).toContain(`\`${artifact}\``));
  it("authorizes no persistence", () => expect(combined).toMatch(/Persistence authority granted: none/i));
  it("authorizes no provider or customer communication", () => expect(combined).toMatch(/Provider or customer-communication authority granted: none/i));
  it("records no deployment or restart", () => expect(review).toMatch(/Deployment and service restart are forbidden/i));
  it("keeps all current changes inside the exact allowlist", () => {
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
    const changed = status.split("\n").filter(Boolean).map((line) => line.slice(3));
    expect(changed.every((path) => allowedArtifacts.some((artifact) => path === artifact || path.endsWith(`/${artifact}`)))).toBe(true);
  });
  it("changes no runtime, migration, provider, checkout, auth, or loyalty path", () => {
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
    expect(status).not.toMatch(/apps\/|packages\/|migrations\/|provider|external-delivery|queue|outbox|checkout|payment|auth|rbac|loyalty/i);
  });
  it("keeps legal, security, and business sign-offs pending", () => expect(record.match(/— pending/g)).toHaveLength(3));
  it("blocks later work on unchecked reviews without blocking this evidence gate", () => expect(record).toMatch(/every unchecked item blocks relevant persistence, migration, enforcement, or activation work/i));
  it("defines evidence-only rollback", () => expect(review).toMatch(/normal revert of the single Slice 9-B1R evidence\/test commit/i));
});
