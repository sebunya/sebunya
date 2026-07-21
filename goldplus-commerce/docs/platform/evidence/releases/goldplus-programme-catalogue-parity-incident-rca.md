# GoldPlus programme catalogue incident RCA and repair evidence

Decision: `CATALOGUE_INCIDENT_CLASSIFIED_MONITOR_REQUEST_OR_PARSER_DEFECT`

Failed release: `goldplus-programme-682384b2-m0048-b79a4de7`

Failed executable: `682384b2a862e86ce3a14f4f5a875506f4a9d33f`

Failed release-package head: `c5191f26776cb4b7c8e424eb9250a2b1441c09f0`

Terminal rollback evidence head: `c9ce093e73913d47eed6255e33fe240c7753de2d`

## Rollback verification and preservation

Production was inspected read-only. It remained clean at `c9ce093e73913d47eed6255e33fe240c7753de2d`, aligned with origin, with 55 migration-ledger rows through `0048`. Both API and web rollback replicas were healthy with zero restarts. Caddy, PostgreSQL and Redis retained their original container identities and zero restart counts.

The exact failed and rollback images remained locally available on production and were preserved outside the repository with the failed-attempt evidence and database backup:

| Asset | Identity |
| --- | --- |
| Failed API | `sha256:784647e9f178a9fd5d34093aae99a9aa590701b82bb791ccd2c19977995e69b7` |
| Failed web | `sha256:331c9432d5b94e00c97b7abf494b6cdebf30a4ad2dba27a34a0f86ce023f67af` |
| Rollback API | `sha256:4057585542b53b35265d7ab702ecd233048ee47ec3dcaa75a5dd204e011d8638` |
| Rollback web | `sha256:2caef4d600a6974c471b95ceb670bd662c066f1c4c1a45c40bf81c27ec4f8ea9` |
| Production backup | SHA-256 `a188b0c5768ce304e5316005a23db38862b3e3748308df07ced4829e85bde60f` |

The preservation root is `/Users/robertsebunya/Documents/GitHub_Projects/goldplus-catalogue-incident-forensics`. Preserved image archives are evidence assets only and are not tracked in Git.

## Incident timeline

- `2026-07-20T16:30:19Z`: the two exact new API replicas started and became healthy with zero restarts.
- During the five-minute API-only stabilization window, each replica's scheduled `analytics-fanout` synthetic job reached catalogue stage and failed. Three critical occurrences reported `Catalog returned zero products`.
- The same API route continued returning HTTP 200 with five products, while PostgreSQL continued to contain eight approved products and eight canonical prices totaling UGX 630,000.
- `2026-07-20T16:37:54Z`: the runtime threshold triggered API/web rollback. No 30-minute success soak or production UAT claim followed.
- After rollback, both API and web services stabilized on the preserved rollback images. No Caddy, PostgreSQL or Redis restart occurred.

## Classification gate

Independent SQL truth for the failed request was:

```text
predicate: products.approval_status = 'approved'
request: GET /products?limit=5
eligible total: 8
page count: 5
database: goldplus
schema: public
```

The API contract was HTTP 200, `application/json`, and `ApiResponse<ProductPublicDto[]>`, so the collection path is `data`. The exact failed executable parsed `data.items` at `SyntheticMonitor.ts:85`, converted the real five-item array to `[]`, and raised the zero-product error. The first divergence is therefore `API response -> SyntheticMonitor parser`, and the incident class is:

```text
A. SYNTHETIC_MONITOR_REQUEST_OR_PARSER_DEFECT
```

The product repository, list use case, DTO mapper, products route, schemas, migrations and production data are not the first divergent layer and were not changed.

The rollback image narrowly avoided the defect because it contains a production-local queue activation guard absent from the clean failed executable; with queue runtime disabled, it did not schedule the stale parser. This explains operational success but does not make its stale `data.items` parser correct. The repair therefore corrects and hardens the parser instead of suppressing the monitor.

## Restored-production differential

The failed-attempt backup was restored to isolated PostgreSQL 16, migrated from 29 to 55 ledger rows with the exact failed migrator, and joined only to an isolated Redis and internal Docker network. Provider and communication flags remained disabled/dry-run. The independent SQL page was:

| Product ID | Canonical price UGX |
| --- | ---: |
| `68001def-f81c-46e3-903e-c3b51e34e8b1` | 50,000 |
| `27b396dd-55c1-4181-9772-aec1bf4a3dcf` | 80,000 |
| `9a7f612b-68e9-47d5-b9ea-442bc7690a02` | 25,000 |
| `bc1901fa-cfde-49ad-9ccf-818724bbdc6d` | 120,000 |
| `fa7e1a81-c640-4283-bd52-a5d4429ef1e1` | 150,000 |

The proof canonicalizes each page by sorting identifiers before hashing:

```text
identifier-set SHA-256:
14c57483a91eb7b563f4f0e9ccbadf2f14b4a107bbe4565911b1fa50655b220b

identifier+canonical-price SHA-256:
5e34628a127e93cb6d9ee432ca63e2ce64fcd2f22349edd52929dd0c1d65d4e2
```

| Observation | OLD rollback | FAILED programme | REPAIRED candidate |
| --- | --- | --- | --- |
| PostgreSQL eligible/page | 8 / 5 | 8 / 5 | 8 / 5 |
| Repository page | 5 | 5 | 5 |
| Use-case/DTO page | 5 | 5 | 5 |
| API status/schema/count | 200 / `data[]` / 5 | 200 / `data[]` / 5 | 200 / `data[]` / 5 |
| API ID hash | matches SQL | matches SQL | matches SQL |
| API price hash | matches SQL | matches SQL | matches SQL |
| Monitor extraction | stale `data.items` | stale `data.items` | validated `data` |
| Monitor outcome when exercised | not scheduled by image-local guard | `Catalog returned zero products` | catalogue parity pass |

The exact failed monitor reproduced the incident against the restored database with `{success:false, stages:["storefront_html_check","catalog_load"]}` and the same zero-product error. The repaired compiled image produced `CATALOGUE_PARITY_PROOF_PASS` with SQL, repository, DTO and API counts all equal to five.

## Storefront parity defect caught before release freeze

The mandatory production-web proof then caught a separate, genuine data-plane divergence before a new release was frozen. Against an exact restored-data API returning eight products, the compiled web rendered 21 products. `getCleanCatalog` always prepended `LOCAL_SEED_PRODUCTS` to every non-empty API response, making the offline fallback catalogue authoritative over live API truth. The storefront did not display its offline notice because the API request itself had succeeded.

The smallest repair keeps a non-empty API collection authoritative and uses local seeds only when the caller has no live catalogue. The production proof also established that all eight restored slugs matched the helper's legacy `STALE_SLUGS` denylist; that filter was therefore another non-authoritative source override and was removed from live-data selection. Existing shop, home, PDP and recommendation callers retain their explicit empty/unavailable fallback paths. Focused tests prove live authority, denylist non-interference and empty-response fallback. No product, price, order or database state changed.

## Environment and image differential

All three images used Node `v20.20.2`, `/app`, database `goldplus`, schema `public`, isolated Redis, disabled notification gates and no provider live mode. The failed and repaired images use the compiled entrypoint `node apps/api/dist/interfaces/http/server.js`; the rollback image uses its preserved source/tsx entrypoint. The failed API carried the exact failed release labels. No missing compiled shared module, alternate database, alternate schema, pagination drift or price/DTO divergence was observed.

Redis state was deliberately isolated per candidate. Catalogue request handling contains no read-through Redis layer; the public route resolves through Registry, `ListPublicProductsUseCase` and `DrizzleProductRepository`. Cold, missing, injected stale-empty, expired, recovered and warm isolated-Redis states all produced the same SQL-bound identifiers and prices, and all injected proof keys were removed. This rules out Redis as the first divergent layer without inventing a cache contract.

## Minimal repair

The repaired monitor now builds two independent observations:

1. direct SQL eligibility/page truth for the exact `approval_status=approved&limit=5` request; and
2. the actual public API response.

It validates database/schema fingerprint, HTTP status, content type, response envelope, real collection path, collection entries, dynamic page count, identifier-set hash and identifier+canonical-price hash. It distinguishes malformed response, missing/malformed collection, DB-positive/API-empty, page-count, identifier, price, database-target and schema-target failures and records the first divergent layer.

Changed runtime boundary:

- `apps/api/src/infrastructure/scheduler/SyntheticMonitor.ts`
- `apps/web/src/lib/catalog/catalog.ts`

Proof boundary:

- `apps/api/src/scripts/catalogue-parity-proof.ts`
- `tests/unit/CatalogueParityMonitor.test.ts`
- `tests/unit/StorefrontCatalog.test.ts`

No repository query, use case, DTO, route, product schema, migration, price, checkout, payment, Inventory, fulfilment, provider, consent, RBAC or production data file changed. Migration ceiling remains `0048`.

## Regression and fault-injection proof

The focused unit suite passes 12/12 and covers:

- actual `ApiResponse<ProductPublicDto[]>` schema;
- legitimate SQL/API empty state;
- DB-positive/API-empty;
- stale `data.items` contract;
- missing and malformed collection;
- malformed envelope/product;
- identifier divergence;
- canonical-price divergence;
- wrong database/schema fingerprint;
- invalid status/content type; and
- first-divergent-layer reason codes.

The compiled linux/amd64 repaired API image is `sha256:0950db52867580e71062e7be54d0031e95d371fd3262088b8255de99e120a936` with working-tree label `working-tree-catalogue-parity-repair`. Its real restored-data proof exited zero and printed one deterministic verdict:

```json
{"verdict":"CATALOGUE_PARITY_PROOF_PASS","databaseFingerprintSha256":"95079c1f679324a1b1dce2f2ae40f2a59c881b57fec76ded73fdaf96d9bc18fa","predicateVersion":"public-catalogue-v1:approval_status=approved;limit=5;price=retail_price_when_has_retail_price","sqlCount":5,"repositoryCount":5,"dtoCount":5,"apiCount":5,"identifierSetSha256":"14c57483a91eb7b563f4f0e9ccbadf2f14b4a107bbe4565911b1fa50655b220b","identifierPriceSha256":"5e34628a127e93cb6d9ee432ca63e2ce64fcd2f22349edd52929dd0c1d65d4e2","coldWarmParity":true,"staleEmptyCacheIgnored":true,"faultInjections":8,"providerCalls":0,"protectedMutationDelta":0,"redisResidue":0}
```

The final exact-commit release proof reruns the expanded cold/miss/stale-empty/expired/recovered/warm matrix before the new release is frozen.

## Validation and safety state

- Secret scan: pass.
- Workspace typecheck: pass.
- API/web source build: pass.
- Architecture suite: pass, 10/10.
- Focused catalogue suite: pass, 12/12.
- Changed-path lint: pass with zero errors; five warnings remain in unchanged legacy portions of `SyntheticMonitor`.
- Dirty-tree full suite: 4,129 behavioral passes plus all 12 new tests; 12 historical artifact-scope guards failed solely because they inspect `git status` and require either their own legacy allowlist or a clean tree. A clean-commit rerun is a release-freeze gate.
- `git diff --check`: pass.
- Fresh migration replay: pass, 49 tracked migration rows through `0048`, zero products, orders, outbox rows or notification attempts; scratch database and migrator container removed.
- Populated restored upgrade: pass, 29 to 55 ledger rows through `0048`, with 8 products, 8 approved products, 13 orders, 30 consent events, zero outbox and zero notification attempts.
- Database mutation delta during the catalogue proof: zero.
- Isolated Redis residue: zero.
- Provider calls: zero; provider egress was unavailable on the internal proof network.
- Customer communications: zero.

Production remained read-only throughout RCA and repair validation. Its final observed counts remained 55 migrations, 8 products, 8 approved products, 8 prices totaling UGX 630,000, 13 orders totaling UGX 1,545,000, 30 consent events, zero outbox and zero notification attempts.

The consumed approval marker remains present, unchanged, root-owned mode `600`, one hard link, 58 bytes, inode `129547`, mtime epoch `1784562095`, SHA-256 `7fd9d49d1883a068bb37743670a0370b8ef75a36d3abeee59c883d980200fc1f`. Codex did not modify or remove it.
