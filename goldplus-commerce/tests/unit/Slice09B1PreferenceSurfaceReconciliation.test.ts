import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const discoveryPath = "docs/platform/evidence/slices/slice-09-b1-preference-surface-discovery.md";
const blueprintPath = "docs/platform/evidence/slices/slice-09-b1-consent-source-of-truth-blueprint.md";
const reviewPath = "docs/platform/evidence/slices/slice-09-b1-artifact-review.md";
const testPath = "tests/unit/Slice09B1PreferenceSurfaceReconciliation.test.ts";

const discovery = read(discoveryPath);
const blueprint = read(blueprintPath);
const review = read(reviewPath);
const evidence = `${discovery}\n${blueprint}\n${review}`;

const allowedArtifacts = [discoveryPath, blueprintPath, reviewPath, testPath];
const surfaceRows = discovery.split("\n").filter((line) => /^\| S\d{2} \|/.test(line));
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
const channels = ["email", "sms", "whatsapp", "phone_call", "in_account", "support_assisted"];
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

describe("Slice 9-B1 preference surface inventory", () => {
  it("inventories at least twenty distinct surfaces", () => expect(surfaceRows.length).toBeGreaterThanOrEqual(20));

  it("keeps the required nineteen-column schema for every inventory row", () => {
    for (const row of surfaceRows) {
      const cells = row.split("|").slice(1, -1).map((cell) => cell.trim());
      expect(cells).toHaveLength(19);
      expect(cells.every((cell) => cell.length > 0)).toBe(true);
    }
  });

  it("answers all sixteen required discovery questions", () => {
    for (let question = 1; question <= 16; question += 1) {
      expect(discovery).toContain(`${question}. **`);
    }
  });

  it("distinguishes the static public centre from legacy account persistence", () => {
    expect(discovery).toMatch(/Public Preference Centre[\s\S]*Guidance only/);
    expect(discovery).toMatch(/Legacy account preference form[\s\S]*Legacy persisted input/);
  });

  it("does not treat checkout contact as marketing consent", () => expect(discovery).toMatch(/Checkout contact data is necessary service\/order intent only/i));
  it("does not treat support contact as campaign consent", () => expect(discovery).toMatch(/Support contact is purpose-limited follow-up intent only/i));
  it("does not treat Product Finder interest as consent", () => expect(discovery).toMatch(/Product Finder interest writes must remain recommendation-interest signals only/i));
  it("records the fragmented-audit risk", () => expect(discovery).toMatch(/Preference audits, Measurement consent records, order\/support records, and delivery\/outbox audit are separate/i));
  it("records the newsletter as not yet active", () => expect(discovery).toMatch(/email updates are opening soon and has no form, persistence, or send/i));
  it("records no dedicated active provider suppression contract", () => expect(discovery).toMatch(/No dedicated active-source customer messaging preference\/suppression contract was found/i));
});

describe("Slice 9-B1 canonical purpose taxonomy", () => {
  it.each(purposes)("defines purpose %s", (purpose) => {
    expect(blueprint).toContain(`\`${purpose}\``);
  });

  it("defines exactly twelve canonical purpose rows", () => {
    const rows = blueprint.split("\n").filter((line) => purposes.some((purpose) => line.startsWith(`| \`${purpose}\``)));
    expect(rows).toHaveLength(12);
  });

  it("keeps every optional programme not requested by default", () => {
    for (const purpose of purposes.filter((item) => !["service_order_updates", "support_follow_up", "account_security_notifications"].includes(item))) {
      const row = blueprint.split("\n").find((line) => line.startsWith(`| \`${purpose}\``));
      expect(row).toContain("`not_requested`");
    }
  });

  it("keeps order and security messaging service-only", () => {
    expect(blueprint).toMatch(/`service_order_updates`[^\n]*`service_only`/);
    expect(blueprint).toMatch(/`account_security_notifications`[^\n]*`service_only`/);
  });
});

describe("Slice 9-B1 channel and state model", () => {
  it.each(channels)("defines channel %s", (channel) => expect(blueprint).toContain(`\`${channel}\``));
  it.each(states)("defines consent state %s", (state) => expect(blueprint).toContain(`\`${state}\``));

  it("allows optional sending only for granted state", () => {
    const optionalYesRows = blueprint.split("\n").filter((line) => /^\| `[^`]+` \|/.test(line) && line.includes("| Yes,"));
    expect(optionalYesRows).toHaveLength(1);
    expect(optionalYesRows[0]).toContain("`granted`");
  });

  it("fails closed on unknown or conflicting evidence", () => expect(blueprint).toMatch(/Unknown or conflicting evidence fails closed/i));
  it("requires endpoint-specific eligibility", () => expect(blueprint).toMatch(/subject, verified channel endpoint, purpose, jurisdiction\/policy context, and time/i));
});

describe("Slice 9-B1 source precedence", () => {
  it("makes provider STOP or unsubscribe override marketing", () => expect(blueprint).toMatch(/Provider STOP, unsubscribe[\s\S]{0,120}overrides optional marketing/i));
  it("makes customer withdrawal override marketing", () => expect(blueprint).toMatch(/customer withdrawal overrides marketing sends/i));
  it("states checkout contact is not marketing consent", () => expect(blueprint).toMatch(/Checkout phone\/email is `service_only`[\s\S]{0,100}not marketing consent/i));
  it("states support conversation is not campaign consent", () => expect(blueprint).toMatch(/support conversation is `service_only`[\s\S]{0,100}not campaign consent/i));
  it("separates loyalty consent from Memory Lane", () => expect(blueprint).toMatch(/Loyalty consent does not equal Memory Lane consent/i));
  it("separates Memory Lane from utilisation-aware offers", () => expect(blueprint).toMatch(/Memory Lane consent does not equal utilization-aware offer consent/i));
  it("prevents interests and behavior from creating consent", () => expect(blueprint).toMatch(/Product Finder interests, browsing, purchase history, silence, pre-ticked boxes[\s\S]{0,100}never create messaging consent/i));
  it("shows restrictive evidence winning in conflict examples", () => {
    expect(blueprint).toMatch(/Older marketing email grant \| Provider email unsubscribe \| `withdrawn`/);
    expect(blueprint).toMatch(/Marketing grant current \| Margin\/policy block \| `blocked_by_policy`/);
  });
});

describe("Slice 9-B1 audit and provider enforcement contract", () => {
  const auditRequirements = [
    "Stable pseudonymous subject ID",
    "Purpose, channel, endpoint reference",
    "Source type, surface ID",
    "Exact copy/version",
    "Event time, received time, effective time",
    "Correlation ID, idempotency key",
    "Policy version, purpose taxonomy version",
    "Requested message category, template/version",
    "Provider request reference",
    "Immutable event ID",
  ];

  it.each(auditRequirements)("requires audit evidence: %s", (requirement) => expect(blueprint).toContain(requirement));

  const enforcementRequirements = [
    "purpose is allowed",
    "channel consent is current",
    "identity is verified",
    "withdrawal is respected",
    "suppression is checked",
    "message category matches the purpose",
    "template is approved where required",
    "audit log is written or durably queued",
    "provider credential is configured",
    "Provider delivery remains disabled unless explicitly enabled",
  ];

  it.each(enforcementRequirements)("requires provider gate: %s", (requirement) => {
    expect(blueprint.toLowerCase()).toContain(requirement.toLowerCase());
  });

  it("defines a versioned decision receipt", () => {
    for (const field of ["decisionId", "allowed", "reasonCodes", "purpose", "channel", "stateVersion", "policyVersion", "suppressionVersion", "templateVersion", "auditEventId"]) {
      expect(blueprint).toContain(`\`${field}\``);
    }
  });

  it("fails closed when enforcement dependencies are unavailable", () => expect(blueprint).toMatch(/missing state, unknown purpose, unverified endpoint[\s\S]{0,240}disabled provider/i));
});

describe("Slice 9-B1 data readiness and artifact safety", () => {
  it("labels future entities as unapproved migrations", () => expect(blueprint).toMatch(/future logical entities, not approved migrations/i));
  it("maps legacy channel flags to unknown instead of granted", () => expect(blueprint).toMatch(/`customer_preferences\.channels\.\*` \| `unknown`[\s\S]{0,100}\| No \|/));
  it("maps checkout and support to service-only", () => {
    expect(blueprint).toMatch(/Checkout phone\/email \| `service_only`/);
    expect(blueprint).toMatch(/Support contact \| `service_only`/);
  });
  it("keeps public Preference Centre visits stateless", () => expect(blueprint).toMatch(/Public `\/preferences` visit \| No state \| No/));
  it("forbids a generic save command from changing multiple purposes", () => expect(blueprint).toMatch(/No generic “save preferences” command may silently alter multiple purposes/i));
  it("declares that Slice 9-B1 creates evidence and tests only", () => expect(blueprint).toMatch(/Slice 9-B1 creates evidence and tests only/i));
  it("documents no deployment", () => expect(review).toMatch(/Deployment is forbidden for Slice 9-B1/i));
  it("documents evidence-only rollback", () => expect(review).toMatch(/No database, provider, runtime, customer state, or production rollback is required/i));

  it.each(allowedArtifacts)("allowlists artifact %s", (artifact) => expect(review).toContain(`\`${artifact}\``));

  it("has no changed path outside the evidence-only allowlist", () => {
    const output = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
    const changed = output.split("\n").filter(Boolean).map((line) => line.slice(3));
    expect(changed.every((path) => allowedArtifacts.some((artifact) => path === artifact || path.endsWith(`/${artifact}`)))).toBe(true);
  });

  it("does not modify runtime, schema, migration, checkout, auth, loyalty, or provider files", () => {
    const output = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
    expect(output).not.toMatch(/apps\/|packages\/|migrations\/|schema\/|checkout|payment|auth|loyalty|provider/i);
  });

  it("reviews all explicit non-implementation boundaries", () => {
    for (const boundary of ["preference persistence", "email, SMS, WhatsApp", "checkout, payment", "auth or RBAC", "Measurement behavior", "loyalty, Memory Lane, personalization", "migration or data model", "customer communications"]) {
      expect(review).toContain(boundary);
    }
  });
});
