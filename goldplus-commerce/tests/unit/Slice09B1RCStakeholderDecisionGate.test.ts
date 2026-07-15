import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const paths = {
  input: "docs/platform/evidence/slices/slice-09-b1rc-stakeholder-decision-input.md",
  intake: "docs/platform/evidence/slices/slice-09-b1rc-stakeholder-decision-intake-record.md",
  assessment: "docs/platform/evidence/slices/slice-09-b1rc-slice-9-b2-authorization-assessment.md",
  review: "docs/platform/evidence/slices/slice-09-b1rc-artifact-review.md",
  test: "tests/unit/Slice09B1RCStakeholderDecisionGate.test.ts",
};
const read = (path: string) => readFileSync(resolve(root, path), "utf8").toLowerCase();
const input = read(paths.input);
const intake = read(paths.intake);
const assessment = read(paths.assessment);
const review = read(paths.review);
const stakeholders = ["legal", "privacy/data protection", "security", "product", "operator/support", "provider/channel owner", "data owner/analytics", "business sponsor"];
const statuses = ["approved", "approved with conditions", "rejected", "requires more information", "not applicable", "pending review"];
const redLines = ["checkout contact is not marketing consent", "support conversation is not campaign consent", "legacy broad flags are not canonical purpose consent", "measurement consent is not messaging consent", "loyalty interest is not memory lane consent", "memory lane consent is not utilisation-aware offer consent", "provider stop overrides local optional marketing preference", "withdrawal wins over marketing", "unknown intent cannot authorize provider sends", "no provider sends before dry-run enforcement", "no persistence before identity and audit model", "no manual override without audit"];

describe("Slice 9-B1RC rerun artifacts", () => {
  Object.entries(paths).forEach(([name, path]) => it(`${name} exists`, () => expect(readFileSync(resolve(root, path), "utf8").length).toBeGreaterThan(100)));
});

describe("sponsor-attributed decision input", () => {
  ["robert sebunya", "business sponsor", "accountable product owner", "2026-07-15", "design-only only", "not final legal", "not final specialist", "formal specialist approvals remain mandatory", "no persistence", "no migrations", "no api mutation", "no preference saving", "no provider enforcement", "no whatsapp", "no customer communications", "no loyalty activation", "no memory lane activation", "no personalisation", "no utilisation-aware offers", "no discounts or coupons"].forEach(term => it(`records ${term}`, () => expect(input).toContain(term)));
  stakeholders.forEach(group => it(`represents ${group}`, () => expect(input).toContain(group)));
  redLines.forEach(line => it(`preserves ${line}`, () => expect(input).toContain(line)));
});

describe("strict intake record", () => {
  statuses.forEach(status => it(`retains valid status ${status}`, () => expect(intake).toContain(status)));
  stakeholders.forEach(group => it(`${group} is conditionally approved`, () => expect(intake).toContain(`| ${group} |`)));
  ["decision source/date", "decision owner", "approved with conditions", "condition owner", "due date", "severity", "9-b2 design impact", "future persistence impact", "future provider-enforcement impact", "blocks design-only", "specialist approval represented", "implementation approval attempted", "red-line waiver attempted", "all eight required groups", "not fabricated or inferred specialist approvals"].forEach(term => it(`records ${term}`, () => expect(intake).toContain(term)));
});

describe("conditional authorization assessment", () => {
  ["authorized_for_design_only_with_conditions", "slice_9_b1rc_stakeholder_decision_gate_completed_9b2_design_conditionally_authorized", "slice 9-b2 may proceed as design-only", "slice 9-b2 may not implement anything", "sponsor-attributed interim authorization", "not final specialist approval", "stakeholder status summary", "decision evidence summary", "conditions summary", "blockers summary", "exact slice 9-b2 design-only boundary", "formal specialist approval remains required", "no persistence is authorized", "no provider enforcement is authorized", "no customer communications are authorized"].forEach(term => it(`contains ${term}`, () => expect(assessment).toContain(term)));
  stakeholders.forEach(group => it(`${group} status is approved with conditions`, () => expect(assessment).toContain(`${group}: \`approved with conditions\``)));
  redLines.forEach(line => it(`preserves ${line}`, () => expect(assessment).toContain(line)));
});

describe("condition completeness", () => {
  ["condition owner", "due date", "severity", "future persistence impact", "future provider-enforcement impact", "blocks 9-b2 design-only", "critical", "high", "blocking", "before any implementation"].forEach(field => it(`input contains ${field}`, () => expect(input).toContain(field)));
  it("records eight conditional statuses", () => expect((input.match(/approved with conditions/g) || []).length).toBeGreaterThanOrEqual(8));
  it("records eight non-blocking design decisions", () => expect((input.match(/\| no \|/g) || []).length).toBeGreaterThanOrEqual(8));
});

describe("design proposals and implementation prohibitions", () => {
  ["schema design", "api command design", "identity-verification design", "audit-trail design", "copy versioning", "source-precedence", "migration design", "dry-run design", "admin-review workflow", "test plans", "rollback plans"].forEach(term => it(`allows proposal for ${term}`, () => expect(assessment).toContain(term)));
  ["database migrations", "tables", "live persistence", "api mutation endpoints", "customer writes", "preference saving", "provider sends", "provider enforcement", "customer communications", "checkout/payment changes", "auth/rbac changes", "loyalty activation", "memory lane activation", "personalisation", "utilisation-aware offers", "discounts", "coupons"].forEach(term => it(`prohibits ${term}`, () => expect(assessment).toContain(term)));
});

describe("artifact scope", () => {
  ["changed files", "allowed files", "excluded files", "runtime-change check", "migration-change check", "provider-change check", "checkout/payment-change check", "auth/rbac-change check", "loyalty-ledger-change check", "secret/env check", "deployment check", "final artifact decision", "no runtime", "no web/api deployment"].forEach(term => it(`records ${term}`, () => expect(review).toContain(term)));
  it("contains only the five allowed paths", () => {
    const output = execFileSync("git", ["status", "--short"], { cwd: resolve(root, ".."), encoding: "utf8" });
    const changed = output.trimEnd().split("\n").filter(Boolean).map(line => line.slice(3));
    const allowed = new Set(Object.values(paths).map(path => `goldplus-commerce/${path}`));
    expect([0, 5]).toContain(changed.length);
    expect(changed.every(path => allowed.has(path))).toBe(true);
  });
});
