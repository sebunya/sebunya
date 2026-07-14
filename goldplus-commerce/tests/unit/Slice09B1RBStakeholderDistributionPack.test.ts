import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const paths = {
  memo: "docs/platform/evidence/slices/slice-09-b1rb-stakeholder-review-cover-memo.md",
  email: "docs/platform/evidence/slices/slice-09-b1rb-stakeholder-review-email.md",
  briefs: "docs/platform/evidence/slices/slice-09-b1rb-stakeholder-one-page-briefs.md",
  tracker: "docs/platform/evidence/slices/slice-09-b1rb-stakeholder-decision-capture-tracker.md",
  index: "docs/platform/evidence/slices/slice-09-b1rb-meeting-pack-index.md",
  review: "docs/platform/evidence/slices/slice-09-b1rb-artifact-review.md",
  test: "tests/unit/Slice09B1RBStakeholderDistributionPack.test.ts",
} as const;
const docs = Object.fromEntries(Object.entries(paths).filter(([key]) => key !== "test").map(([key, path]) => [key, readFileSync(resolve(root, path), "utf8")])) as Record<string, string>;
const highLevel = [docs.memo, docs.email, docs.briefs, docs.tracker, docs.index];
const redLines = [
  "checkout contact is not marketing consent",
  "support conversation is not campaign consent",
  "legacy broad flags are not canonical purpose consent",
  "measurement consent is not messaging consent",
  "loyalty interest is not memory lane consent",
  "memory lane consent is not utilisation-aware offer consent",
  "provider stop overrides local optional marketing preference",
  "withdrawal wins over marketing",
  "unknown intent cannot authorize provider sends",
  "no provider sends before dry-run enforcement",
  "no persistence before identity and audit model",
  "no manual override without audit",
];
const stakeholders = ["legal", "privacy and data protection", "security", "product", "operator/support", "provider/channel owner", "data owner/analytics", "business sponsor"];

describe("Slice 9-B1RB artifacts", () => {
  Object.entries(paths).forEach(([key, path]) => it(`${key} exists`, () => expect(readFileSync(resolve(root, path), "utf8").length).toBeGreaterThan(100)));
});

describe("cover memo", () => {
  ["subject", "purpose", "what is being reviewed", "what is not being approved", "why this matters", "required reviewers", "decision statuses", "what happens after review", "what remains blocked"].forEach(term => it(`contains ${term}`, () => expect(docs.memo.toLowerCase()).toContain(term)));
  ["does not authorize preference saving", "provider sends", "customer communications", "slice 9-b2 may proceed as design-only"].forEach(term => it(`preserves ${term}`, () => expect(docs.memo.toLowerCase()).toContain(term)));
});

describe("send-ready email", () => {
  ["subject:", "hello colleagues", "not an implementation request", "approved with conditions", "rejected", "requires more information", "not applicable", "owner and due date", "slice 9-b2 remains blocked", "thank you", "robert"].forEach(term => it(`contains ${term}`, () => expect(docs.email.toLowerCase()).toContain(term)));
});

describe("stakeholder briefs", () => {
  stakeholders.forEach(stakeholder => it(`includes ${stakeholder}`, () => expect(docs.briefs.toLowerCase()).toContain(stakeholder)));
  ["what you are reviewing", "decisions you own", "red lines you must protect", "questions to answer", "what approval means", "what approval does not mean", "blockers that stop 9-b2"].forEach(field => it(`repeats ${field} for eight briefs`, () => expect((docs.briefs.toLowerCase().match(new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length).toBe(8)));
});

describe("decision tracker", () => {
  ["stakeholder group", "owner/name", "decision status", "conditions", "blocking questions", "owner for blockers", "due date", "evidence reviewed", "9-b2 impact"].forEach(column => it(`has ${column}`, () => expect(docs.tracker.toLowerCase()).toContain(column)));
  ["approved", "approved with conditions", "rejected", "requires more information", "not applicable", "pending review"].forEach(status => it(`has ${status}`, () => expect(docs.tracker.toLowerCase()).toContain(status)));
  it("initializes all eight rows pending", () => expect((docs.tracker.match(/pending review/g) || []).length).toBeGreaterThanOrEqual(8));
});

describe("meeting index", () => {
  ["read first", "send to reviewers", "use in meeting", "use for decisions", "source evidence", "red-line controls", "slice 9-b2 authorization gate", "document path", "audience", "when to use it", "decision supported"].forEach(term => it(`contains ${term}`, () => expect(docs.index.toLowerCase()).toContain(term)));
});

describe("universal red-line preservation", () => {
  highLevel.forEach((doc, docIndex) => redLines.forEach(line => it(`document ${docIndex + 1} preserves ${line}`, () => expect(doc.toLowerCase()).toContain(line))));
});

describe("scope safety", () => {
  it("changes only the seven allowed paths", () => {
    const status = execFileSync("git", ["status", "--short"], { cwd: resolve(root, ".."), encoding: "utf8" });
    const changed = status.trim().split("\n").filter(Boolean).map(line => line.slice(3));
    const allowed = new Set(Object.values(paths).map(path => `goldplus-commerce/${path}`));
    expect([0, 7]).toContain(changed.length);
    expect(changed.every(path => allowed.has(path))).toBe(true);
  });
  ["persistence", "provider sends", "customer communications", "runtime change", "deployment"].forEach(boundary => it(`artifact review blocks ${boundary}`, () => expect(docs.review.toLowerCase()).toContain(boundary)));
});
