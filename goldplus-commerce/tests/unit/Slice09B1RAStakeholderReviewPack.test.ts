import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const paths = {
  pack: "docs/platform/evidence/slices/slice-09-b1ra-consent-boundary-stakeholder-review-pack.md",
  matrix: "docs/platform/evidence/slices/slice-09-b1ra-stakeholder-decision-matrix.md",
  log: "docs/platform/evidence/slices/slice-09-b1ra-consent-boundary-decision-log-template.md",
  agenda: "docs/platform/evidence/slices/slice-09-b1ra-consent-boundary-review-meeting-agenda.md",
  redlines: "docs/platform/evidence/slices/slice-09-b1ra-consent-red-line-register.md",
  checklist: "docs/platform/evidence/slices/slice-09-b1ra-slice-9-b2-authorization-checklist.md",
  review: "docs/platform/evidence/slices/slice-09-b1ra-artifact-review.md",
  test: "tests/unit/Slice09B1RAStakeholderReviewPack.test.ts",
} as const;

const docs = Object.entries(paths).filter(([key]) => key !== "test").map(([key, path]) => ({ key, path, content: read(path) }));
const pack = read(paths.pack);
const matrix = read(paths.matrix);
const log = read(paths.log);
const agenda = read(paths.agenda);
const redlines = read(paths.redlines);
const checklist = read(paths.checklist);
const review = read(paths.review);
const allowedArtifacts = Object.values(paths);

const stakeholders = [
  "Legal",
  "Privacy and data protection",
  "Security",
  "Product",
  "Operator/support",
  "Provider/channel owner",
  "Data owner/analytics",
  "Business sponsor",
];
const statuses = ["approved", "approved with conditions", "rejected", "requires more information", "not applicable"];
const requiredRedLines = [
  "Checkout contact is not marketing consent",
  "Support conversation is not campaign consent",
  "Legacy broad flags are not canonical purpose consent",
  "Measurement consent is not messaging consent",
  "Loyalty interest is not Memory Lane consent",
  "Memory Lane consent is not utilisation-aware offer consent",
  "Provider STOP overrides local optional marketing preference",
  "Withdrawal wins over marketing",
  "Unknown intent cannot authorize provider sends",
  "No provider sends before dry-run enforcement",
  "No persistence before identity and audit model",
  "No manual override without audit",
];
const decisionFields = [
  "Decision ID",
  "Decision owner",
  "Stakeholder group",
  "Decision area",
  "Date",
  "Decision status",
  "Approved scope",
  "Excluded scope",
  "Conditions",
  "Risks accepted",
  "Risks rejected",
  "Evidence reviewed",
  "Open questions",
  "Follow-up owner",
  "Due date",
  "Review expiry date",
  "Implementation impact",
  "Slice 9-B2 impact",
];

describe("Slice 9-B1RA deliverable set", () => {
  it.each(Object.entries(paths).map(([key, path]) => ({ key, path })))("creates $key", ({ path }) => expect(existsSync(resolve(root, path))).toBe(true));
  it("creates exactly seven documentation artifacts", () => expect(docs).toHaveLength(7));
  it("uses the exact Slice 9-B1R baseline", () => expect(pack).toContain("9b92ca001bbbf01ac5dfe5007c131f8dc5157a6e"));
});

describe("Slice 9-B1RA executive review pack", () => {
  const requiredStatements = [
    "GoldPlus is not asking to save customer preferences yet.",
    "GoldPlus is not asking to send WhatsApp, email or SMS yet.",
    "GoldPlus is not asking to activate loyalty, Memory Lane, personalised offers, utilisation-aware offers or discounts yet.",
    "GoldPlus is asking reviewers to approve the boundary that will guide a future design-only persistence proposal.",
  ];
  it.each(requiredStatements)("states: %s", (statement) => expect(pack).toContain(statement));

  const customerRisks = [
    "avoid treating checkout contact details as marketing consent",
    "avoid treating support conversations as campaign consent",
    "avoid treating broad account flags as purpose-specific consent",
    "avoid treating Measurement consent as messaging consent",
    "avoid treating loyalty interest as Memory Lane consent",
    "avoid treating Memory Lane consent as personalised offer consent",
    "avoid sending messages after withdrawal or provider STOP",
    "avoid building provider enforcement without audit trail and suppression controls",
  ];
  it.each(customerRisks)("frames customer risk: %s", (risk) => expect(pack).toContain(risk));

  const sections = [
    "One-page executive summary",
    "Current state",
    "What is being reviewed",
    "What is not being approved",
    "Why this review exists",
    "Customer-risk framing",
    "Approved boundary from Slice 9-B1R",
    "Decisions reviewers must make",
    "Stakeholder-specific review sections",
    "Red lines",
    "Open decisions",
    "Slice 9-B2 authorization criteria",
    "Sign-off sequence",
    "How to use the decision log",
    "Appendix: source evidence",
  ];
  it.each(sections)("contains executive section %s", (section) => expect(pack).toContain(section));
  it("does not treat attendance or silence as approval", () => expect(pack).toMatch(/Silence, meeting attendance, or an unsigned draft is not approval/i));
});

describe("Slice 9-B1RA stakeholder matrix and RACI", () => {
  it.each(stakeholders)("assigns decision ownership to %s", (stakeholder) => {
    expect(matrix).toContain(`| ${stakeholder} |`);
    expect(matrix).toMatch(new RegExp(stakeholder.replace("/", "\\/"), "i"));
  });
  it.each(statuses)("offers status %s", (status) => expect(matrix).toContain(status));
  it("includes every required decision-matrix column", () => {
    for (const heading of ["Decision area", "Decision required", "Why it matters", "Risk if unresolved", "Minimum evidence", "Status options", "Blocking questions", "Acceptable conditions", "Red-line blockers", "Required output"]) expect(matrix).toContain(heading);
  });
  it("includes a RACI owner map", () => expect(matrix).toMatch(/RACI by decision domain[\s\S]*A = accountable decision owner/));
  it("makes the business sponsor accountable for design-only go/no-go", () => expect(matrix).toMatch(/Slice 9-B2 design-only go\/no-go and funding[^\n]*\| A\/R \|/));
  it("requires the business sponsor to confirm implementation remains blocked", () => expect(matrix).toMatch(/confirm no persistence\/sends|implementation remains blocked/i));
});

describe("Slice 9-B1RA stakeholder-specific red lines", () => {
  const stakeholderRedLines = [
    "no persistence before purpose classification",
    "no provider enforcement before withdrawal/suppression policy",
    "no persistence without identity verification model",
    "no audit trail without copy version and source surface",
    "no API mutation without auth model",
    "no callback ingestion without signature/freshness checks",
    "no “saved” UX until persistence exists",
    "no broad marketing toggle without purpose clarity",
    "no reward or discount bait as consent capture",
    "no support-assisted updates before the workflow exists",
    "no manual override without audit trail",
    "no WhatsApp send without explicit WhatsApp consent and approved template",
    "no SMS marketing without SMS consent and opt-out handling",
    "no email marketing without unsubscribe handling",
    "no canonical persistence without an owner",
    "no taxonomy change without versioning",
    "no Measurement consent reuse for messaging consent",
    "no acceleration into implementation without legal, privacy, security, operator, provider, and data-owner sign-off",
    "no live customer communications as a shortcut",
  ];
  it.each(stakeholderRedLines)("preserves stakeholder red line: %s", (line) => expect(pack.toLowerCase()).toContain(line.toLowerCase()));
});

describe("Slice 9-B1RA red-line register", () => {
  it.each(requiredRedLines)("records red line %s", (line) => expect(redlines.toLowerCase()).toContain(line.toLowerCase()));
  it("groups red lines across all required governance domains", () => {
    for (const domain of ["Customer consent", "Privacy", "Security", "Provider/channel", "Product/UX", "Operator/support", "Data governance", "Business governance"]) expect(redlines).toContain(`| ${domain} |`);
  });
  it("forbids informal waiver", () => expect(redlines).toMatch(/No meeting participant may waive a universal red line/i));
  it("applies the most restrictive safe outcome", () => expect(redlines).toMatch(/most restrictive safe outcome applies/i));
});

describe("Slice 9-B1RA authorization checklist", () => {
  it.each(stakeholders)("includes required reviewer %s", (stakeholder) => expect(checklist).toContain(`| ${stakeholder} |`));
  it.each(statuses)("defines authorization status %s", (status) => expect(checklist).toContain(`\`${status}\``));
  it("requires approved or conditionally approved stakeholders", () => expect(checklist).toMatch(/all required stakeholders are `approved` or `approved with conditions`/i));
  it("requires every blocking question to have an owner and due date", () => expect(checklist).toMatch(/all blocking questions have owners and due dates/i));
  it("keeps the initial state unauthorized", () => expect(checklist).toContain("NOT AUTHORIZED — STAKEHOLDER REVIEW PENDING"));
  it("keeps Slice 9-B2 design-only", () => expect(checklist).toMatch(/Slice 9-B2 must remain design-only unless explicitly reauthorized/i));
  it("blocks rejected or incomplete reviews", () => expect(checklist).toMatch(/Any `rejected`, `requires more information`, missing review[\s\S]*results in `NOT AUTHORIZED`/i));
  it("requires explicit sponsor acknowledgment that implementation remains blocked", () => expect(checklist).toMatch(/business sponsor explicitly states that implementation and sends remain blocked/i));
});

describe("Slice 9-B1RA decision log", () => {
  it.each(decisionFields)("includes decision field %s", (field) => expect(log).toContain(`| ${field} |`));
  it("requires one entry per material decision", () => expect(log).toMatch(/Use one entry for one material decision/i));
  it("does not require real signatures", () => expect(log).toMatch(/not a signature/i));
  it("requires conditions to have owner and due date", () => expect(log).toMatch(/each with owner and due date/i));
  it("retains superseded evidence", () => expect(log).toMatch(/Superseded decision ID[\s\S]*Evidence preserved/));
});

describe("Slice 9-B1RA meeting workflow", () => {
  it("provides a 60-minute agenda", () => expect(agenda).toContain("Recommended 60-minute version"));
  it("provides a 90-minute agenda", () => expect(agenda).toContain("Recommended 90-minute version"));
  it("includes provider STOP and withdrawal decisions", () => expect(agenda).toMatch(/Provider STOP\/withdrawal decisions/));
  it("includes audit and tamper-evidence decisions", () => expect(agenda).toMatch(/Audit\/tamper-evidence decisions/));
  it("includes the Slice 9-B2 authorization decision", () => expect(agenda).toMatch(/Slice 9-B2 authorization decision/));
  it("closes with owners and due dates", () => expect(agenda).toMatch(/Owners, due dates, expiry and close/));
  it("requires all eight stakeholder owners", () => {
    const normalizedAgenda = agenda.toLowerCase().replaceAll("-", " ");
    stakeholders.forEach((stakeholder) => expect(normalizedAgenda).toContain(stakeholder.toLowerCase().replace(" owner", "")));
  });
});

describe("Slice 9-B1RA cross-artifact safety", () => {
  it("keeps every document tied to the Slice 9-B1R boundary", () => docs.forEach(({ content }) => expect(content).toMatch(/Slice 9-B1R|9-B1R boundary/i)));
  it("keeps provider delivery disabled in every document", () => docs.forEach(({ content }) => expect(content).toMatch(/provider delivery remains disabled|provider delivery.*disabled/i)));
  it("preserves no-runtime-change scope in every document", () => docs.forEach(({ content }) => expect(content).toMatch(/no runtime change|no .*runtime.*change|does not approve[\s\S]{0,250}runtime changes|cannot authorize[\s\S]{0,250}runtime changes|no .*changes runtime behavior/i)));
  it("allowlists exactly eight artifacts", () => expect(review.match(/^\d+\. `.+`$/gm)).toHaveLength(8));
  it("changes no path outside the exact eight-file allowlist", () => {
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
    const changed = status.split("\n").filter(Boolean).map((line) => line.slice(3));
    expect(changed.every((path) => allowedArtifacts.some((artifact) => path === artifact || path.endsWith(`/${artifact}`)))).toBe(true);
  });
  it("changes no runtime, migration, provider, checkout, auth, or loyalty file", () => {
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
    const changed = status.split("\n").filter(Boolean).map((line) => line.slice(3));
    expect(changed.some((path) => path.includes("/apps/") || path.includes("/packages/") || path.includes("/migrations/") || path.includes("/src/"))).toBe(false);
  });
  it("authorizes no persistence or provider sends", () => expect(review).toMatch(/No persistence[\s\S]*No provider transport/i));
  it("records no deployment", () => expect(review).toMatch(/No production deployment/i));
});
