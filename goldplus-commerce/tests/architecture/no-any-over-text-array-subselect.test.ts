import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `pgTextArray` expands to a SUBSELECT. `= any((select …))` is then a
 * subquery comparison of a scalar with a text[] row, and PostgreSQL refuses it
 * ("operator does not exist: character varying = text[]"). It typechecks,
 * passes every unit test, and — inside a catch-all — silently turned every
 * visitor into a new one until a real-database test caught it (2026-09-20).
 * Membership goes through `pgInTextList`.
 */
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });

describe("no `= any(pgTextArray(...))`", () => {
  it("uses pgInTextList for text membership", () => {
    const offenders = walk("apps/api/src").filter((f) => /any\(\s*\$\{\s*pgTextArray\(/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
