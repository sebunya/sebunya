import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Public pages must not publish back-office material.
 *
 * `/preferences` shipped a customer-facing URL — linked from the footer of every
 * page, and indexable — whose content was internal governance: a 21-item launch
 * readiness checklist, a 15-item register of what "must remain blocked", the
 * activation blockers behind each unreleased capability, and concepts like
 * utilisation-aware offers with their margin floors and budget caps.
 *
 * Two distinct harms, worth separating:
 *
 *   1. It published things we would not choose to publish — a roadmap, our
 *      internal controls, and the commercial vocabulary behind future pricing.
 *   2. It told customers nothing they could act on, and one thing that was
 *      false: "Loyalty ... not active yet" while /loyalty was selling points.
 *
 * The internal model was not deleted; it stays in `preference-centre.ts` and
 * stays under test. It simply stopped being rendered to shoppers. This guard
 * reads the real page files so a new public page cannot reintroduce the shape.
 */

const PAGES = "apps/web/src/pages";
const COMPONENTS = "apps/web/src/components";

const walkAstro = (dir: string, out: string[]): string[] => {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry !== "admin") walkAstro(p, out);
    } else if (p.endsWith(".astro")) {
      out.push(p);
    }
  }
  return out;
};

/** Every page a shopper can reach — admin surfaces are exempt by definition. */
const publicPages = (): string[] => walkAstro(PAGES, []);

/**
 * Pages and the components they render. The leak this file was written for had
 * a sibling one level down: `CanonicalConsentForm.astro` showed signed-in
 * customers "Canonical consent P0" and a "Gated UAT only" badge. A guard that
 * reads only `pages/` would have missed it.
 */
const publicSurfaces = (): string[] => [...publicPages(), ...walkAstro(COMPONENTS, [])];

/**
 * Rendered prose only. Attribute values (placeholders, class names, aria labels)
 * and code comments are not what a customer reads, and matching them produces
 * false positives — an earlier version of this check flagged `/* preview only *​/`
 * comments in cart.astro and checkout.astro.
 */
const prose = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\b[a-zA-Z-]+=(\{[^}]*\}|"[^"]*"|'[^']*')/g, "");

const BACK_OFFICE = [
  /launch readiness/i,
  /readiness checklist/i,
  /must be proven first/i,
  /must remain blocked/i,
  /before activation/i,
  /activation requirement/i,
  /readiness, not enrolment/i,
  /margin floors?/i,
  /budget caps?/i,
  /utilisation-aware/i,
  /operator readiness/i,
  /privacy (and|&) legal review/i,
  /preference data contract/i,
  /provider suppression/i,
];

describe("no public page publishes back-office material", () => {
  it("finds no internal governance prose on any customer-reachable page", () => {
    const offenders: string[] = [];
    for (const page of publicPages()) {
      const text = prose(readFileSync(page, "utf8"));
      for (const pattern of BACK_OFFICE) {
        const hit = text.match(pattern);
        if (hit) offenders.push(`${relative(PAGES, page)}: ${hit[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("reads a real, substantial set of public pages, so the guard is not vacuous", () => {
    // A file-walking guard that silently matches nothing always passes.
    expect(publicPages().length).toBeGreaterThan(30);
  });

  it("excludes admin pages, where this vocabulary is correct and expected", () => {
    expect(publicPages().some((p) => p.includes(`${PAGES}/admin`))).toBe(false);
  });
});

describe("no customer surface exposes our release process", () => {
  // A customer reading "Canonical consent P0 — Gated UAT only" learns our slice
  // naming and our rollout state, and nothing about their own choice.
  const RELEASE_VOCABULARY = [
    /canonical (consent|persistence|purpose|saving)/i,
    /\bgated UAT\b/i,
    /\bUAT only\b/i,
    /consent P0\b/,
    /purpose-specific (preference|choice) was not saved/i,
    /legacy (account settings|compatibility surface)/i,
  ];

  it("finds no release-process vocabulary on any page or rendered component", () => {
    const offenders: string[] = [];
    for (const file of publicSurfaces()) {
      const text = prose(readFileSync(file, "utf8"));
      for (const pattern of RELEASE_VOCABULARY) {
        const hit = text.match(pattern);
        if (hit) offenders.push(`${relative("apps/web/src", file)}: ${hit[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("reads components as well as pages", () => {
    expect(publicSurfaces().length).toBeGreaterThan(publicPages().length);
  });

  it("renders no dead form when the optional-marketing capability is off", () => {
    // A disabled form with a dead submit button reads as a broken page. When the
    // capability is off the component explains that instead of rendering it.
    const form = readFileSync(`${COMPONENTS}/preferences/CanonicalConsentForm.astro`, "utf8");
    expect(form).toMatch(/\{enabled \? \(/);
    expect(form).not.toMatch(/disabled=\{!enabled\}/);
  });
});

describe("no public page contradicts a programme that is live", () => {
  it("does not tell customers loyalty is unavailable", () => {
    // /loyalty sells points on delivered orders. Another public page claiming
    // loyalty is "not active yet" is not a wording problem, it is a false
    // statement to a customer deciding whether to buy.
    const offenders = publicPages().filter((page) => {
      const text = prose(readFileSync(page, "utf8"));
      return /loyalty[^.]{0,80}not active yet|not active yet[^.]{0,80}loyalty/i.test(text);
    });
    expect(offenders).toEqual([]);
  });
});
