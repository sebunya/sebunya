# Dependency Audit

Protected systems touched: NO production code mutated.
Protected systems inspected: YES, read-only audit only.

## Command

`pnpm audit --audit-level=high`

Result: FAIL.

## Summary

- 24 vulnerabilities found.
- Severity distribution: 1 critical, 5 high, 15 moderate, 3 low.

## High And Critical Advisories

| Severity | Package | Path | Advisory | Notes |
| --- | --- | --- | --- | --- |
| Critical | `vitest` | root | GHSA-5xrq-8626-4rwp | Dev/test exposure, upgrade to patched Vitest line. |
| High | `xlsx` | root | GHSA-4r6h-8v6p-xvw6 | Prototype pollution. No patched npm version reported by audit. |
| High | `xlsx` | root | GHSA-5pgg-2g8v-p4x9 | ReDoS. No patched npm version reported by audit. |
| High | `astro` | `apps/web` | GHSA-wrwg-2hg8-v723 | Reflected XSS via server islands; audit says patched in `>=5.15.8`. |
| High | `drizzle-orm` | `apps/api` | GHSA-gpj5-g38j-94v9 | SQL identifier escaping issue; patched in `>=0.45.2`. |
| High | `devalue` | transitive via Astro | GHSA-77vg-94rm-hx3p | DoS via sparse array deserialization; patched in `>=5.8.1`. |

## Recommended Dependency Pass

- Upgrade Vitest in isolation and run full tests.
- Upgrade Astro and related integration packages together; verify SSR build and storefront/admin smoke.
- Upgrade Drizzle ORM and Drizzle Kit carefully; verify migrations and repository tests.
- Evaluate `xlsx` usage. If unused, remove. If needed, isolate or replace with a maintained parser.
- Re-run `pnpm audit --audit-level=high`.

## Risk Notes

- Drizzle upgrade can affect SQL generation and migrations; high care required.
- Astro major/minor upgrade can affect SSR build output, server adapter, and Sentry integration.
- Vitest upgrade can affect mocking behavior and test timeouts.
- Do not combine these with business logic refactors.

