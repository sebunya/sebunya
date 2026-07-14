import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const paths = {
  intake: "docs/platform/evidence/slices/slice-09-b1rc-stakeholder-decision-intake-record.md",
  assessment: "docs/platform/evidence/slices/slice-09-b1rc-slice-9-b2-authorization-assessment.md",
  review: "docs/platform/evidence/slices/slice-09-b1rc-artifact-review.md",
  test: "tests/unit/Slice09B1RCStakeholderDecisionGate.test.ts",
};
const intake = readFileSync(resolve(root, paths.intake), "utf8").toLowerCase();
const assessment = readFileSync(resolve(root, paths.assessment), "utf8").toLowerCase();
const review = readFileSync(resolve(root, paths.review), "utf8").toLowerCase();
const stakeholders = ["legal", "privacy/data protection", "security", "product", "operator/support", "provider/channel owner", "data owner/analytics", "business sponsor"];
const statuses = ["approved", "approved with conditions", "rejected", "requires more information", "not applicable", "pending review"];
const redLines = ["checkout contact is not marketing consent", "support conversation is not campaign consent", "legacy broad flags are not canonical purpose consent", "measurement consent is not messaging consent", "loyalty interest is not memory lane consent", "memory lane consent is not utilisation-aware offer consent", "provider stop overrides local optional marketing preference", "withdrawal wins over marketing", "unknown intent cannot authorize provider sends", "no provider sends before dry-run enforcement", "no persistence before identity and audit model", "no manual override without audit"];

describe("Slice 9-B1RC artifacts", () => Object.entries(paths).forEach(([name, path]) => it(`${name} exists`, () => expect(readFileSync(resolve(root, path), "utf8").length).toBeGreaterThan(100))));

describe("fail-closed intake", () => {
  ["no genuine stakeholder decision input was available", "slice 9-b2 remains unauthorized", "decision source", "decision date", "decision owner/name", "conditions", "blocking questions", "condition owner", "due date", "9-b2 impact", "blocks design-only work", "implementation approval attempted"].forEach(term => it(`records ${term}`, () => expect(intake).toContain(term)));
  stakeholders.forEach(group => it(`${group} is represented`, () => expect(intake).toContain(group)));
  statuses.forEach(status => it(`allows ${status}`, () => expect(intake).toContain(status)));
  it("keeps all eight reviews pending", () => expect((intake.match(/pending review/g) || []).length).toBeGreaterThanOrEqual(8));
  it("records the exact baseline", () => expect(intake).toContain("d2889d6fc4e5413bf5cfbccb51af231724204668"));
  it("does not fabricate approval", () => expect(intake).toContain("no status may be elevated"));
});

describe("authorization assessment", () => {
  ["overall authorization state", "not_authorized", "blocked_by_missing_review", "stakeholder status summary", "conditions summary", "blockers summary", "design-only boundary", "silence is not approval", "attendance is not approval", "distribution is not approval", "owner and due date", "do not start slice 9-b2"].forEach(term => it(`contains ${term}`, () => expect(assessment).toContain(term)));
  stakeholders.forEach(group => it(`${group} status is pending`, () => expect(assessment).toContain(`${group}: \`pending review\``)));
  redLines.forEach(line => it(`preserves ${line}`, () => expect(assessment).toContain(line)));
  it("records the blocked decision", () => expect(assessment).toContain("slice_9_b1rc_blocked_pending_stakeholder_decisions"));
  it("keeps red lines non-waivable", () => expect(assessment).toContain("non-waivable"));
  it("requires sponsor confirmation", () => expect(assessment).toContain("business sponsor has not explicitly confirmed"));
});

describe("implementation prohibition", () => {
  ["migrations", "live persistence", "api mutations", "provider sends", "provider enforcement", "customer communications", "loyalty activation", "memory lane activation", "personalisation activation", "discounts/coupons", "checkout mutation", "auth/rbac rewrite"].forEach(term => it(`blocks ${term}`, () => expect(assessment).toContain(term)));
  ["persistence remains blocked", "provider sends remain blocked", "runtime implementation remains blocked"].forEach(term => it(`explains ${term}`, () => expect(assessment).toContain(term)));
});

describe("artifact scope", () => {
  it("contains only four allowed paths", () => {
    const output = execFileSync("git", ["status", "--short"], { cwd: resolve(root, ".."), encoding: "utf8" });
    const changed = output.trim().split("\n").filter(Boolean).map(line => line.slice(3));
    const allowed = new Set(Object.values(paths).map(path => `goldplus-commerce/${path}`));
    expect([0, 4]).toContain(changed.length);
    expect(changed.every(path => allowed.has(path))).toBe(true);
  });
  ["no runtime", "no deployment", "no genuine stakeholder decision input", "unauthorized"].forEach(term => it(`review states ${term}`, () => expect(review).toContain(term)));
  it("is evidence and tests only", () => expect(review).toContain("evidence and tests only"));
  it("does not create optional input evidence", () => expect(review).toContain("optional stakeholder-decision-input file was not created"));
});
