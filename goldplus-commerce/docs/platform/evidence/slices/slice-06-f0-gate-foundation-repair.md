# Slice 6-F0 gate foundation repair

## Missing foundation

The requested `c1925dbd` baseline did not track four named protected contract tests, did not define `pnpm security:scan-secrets`, and tracked a Product Finder page importing a nonexistent `layouts/MainLayout.astro`.

## Repairs

- Added narrow source-contract tests for storefront taxonomy/truth, checkout location/payment truth, fail-closed admin access, and PDP trust.
- Added a tracked-source secret scanner that excludes environment, backup, archive and generated paths and reports only file, line and rule ID—not matched values.
- Replaced only the Product Finder page's missing layout import and wrapper tag with the existing `BaseLayout`.

The Product Finder shell, copy, requests, APIs, forms, storage and behavior were not changed. No Product Finder functionality was implemented.

## Scope exclusions

No checkout implementation, payment, PesaPal, order mutation, auth/RBAC implementation, provider, Measurement Control Tower, queue, loyalty, migration, environment, backup or customer-communication file was changed.

No production change, provider call or customer communication occurred during this repair.

## Gate result

- Corrected protected contracts: Slice 2 (3 tests), Slice 3 (4 tests), Slice 3-B (4 tests), Slice 4 (4 tests).
- Existing protected contracts: Slice 5 (10 tests), Slice 6 support (7 tests), Slice 6-D (7 tests).
- Secret scan: passed; 855 source/config files checked without printing values.
- Typecheck: passed.
- Lint: passed with existing warnings and zero errors.
- Build: blocked after the Product Finder repair exposed a second pre-existing missing import in `apps/web/src/pages/admin/measurement/control-tower/controlled-activation/live-review/index.astro`.

The previously blocked compile chain was later repaired through separately authorized 6-F0M, 6-F0D and 6-F0DL build-foundation work. The final 6-F0 gate run passed all protected tests, the secret scan, typecheck, lint with zero errors, and the production build.
