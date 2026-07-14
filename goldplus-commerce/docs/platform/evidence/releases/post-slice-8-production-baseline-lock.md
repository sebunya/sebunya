# Post-Slice-8 production baseline lock

Captured: 2026-07-14 (Africa/Kampala)

Decision: `SLICE_8_B_POST_SLICE_8_BASELINE_LOCKED_READY_FOR_NEXT_PHASE`

## Source truth

- Repository: `goldplus-commerce-next-phase-c1925dbd/goldplus-commerce`
- Branch: `phase-2-measurement-control-tower-completion`
- Starting source and fetched origin: `42969e4446d5097bfd161f83b6577629d2292601`
- Ahead/behind: `0/0`
- Index/worktree before evidence: clean
- Diff from HEAD to origin: empty
- Slice 8-B changed no runtime, admin, auth, provider, checkout, loyalty, recommendation, infrastructure, or deployment file.

## Production public and commerce truth

Homepage, shop, charger search, loyalty, support, track-order, terms, privacy, robots, sitemap, and two real PDPs returned `200`. Checkout retained `303`.

The GoldPlus 100W Portable Power Station and 16GB USB Flash Drive PDPs each rendered two recommendation rails containing three and four products. Every rail used unique IDs, excluded its current product, and contained no unsupported Trending, Best sellers, Popular, Recommended for you, Customers also bought, Frequently bought together, Most loved, or Top rated label.

## Zero-trust admin route manifest and production crawl

The source-derived manifest contains 49 Astro pages: 48 protected operational routes and one public allowlisted route. Every protected page directly calls `readSessionToken(Astro.request)` and returns a `303` login redirect. Concrete production results were captured logged out; dynamic pages use source proof, with the previously documented live-review sample also checked in production.

| Source under `apps/web/src/pages/` | Derived route | Dynamic | Classification | Expected | Guard proof | Production | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `admin/audit/index.astro` | `/admin/audit` | no | protected operational | 303 | direct | 303 | pass |
| `admin/campaigns/index.astro` | `/admin/campaigns` | no | protected operational | 303 | direct | 303 | pass |
| `admin/carts/index.astro` | `/admin/carts` | no | protected operational | 303 | direct | 303 | pass |
| `admin/categories/index.astro` | `/admin/categories` | no | protected operational | 303 | direct | 303 | pass |
| `admin/controlled-activation-dry-run.astro` | `/admin/controlled-activation-dry-run` | no | protected operational | 303 | direct 8-B1 | 303 | zero markers |
| `admin/controlled-activation.astro` | `/admin/controlled-activation` | no | protected operational | 303 | direct 8-B1 | 303 | zero markers |
| `admin/controlled-live-canary.astro` | `/admin/controlled-live-canary` | no | protected operational | 303 | direct 8-B1 | 303 | zero markers |
| `admin/dealers/index.astro` | `/admin/dealers` | no | protected operational | 303 | direct | 303 | pass |
| `admin/feeds/index.astro` | `/admin/feeds` | no | protected operational | 303 | direct | 303 | pass |
| `admin/governance/index.astro` | `/admin/governance` | no | protected operational | 303 | direct | 303 | pass |
| `admin/index.astro` | `/admin` | no | protected operational | 303 | direct | 303 | zero markers |
| `admin/inventory/index.astro` | `/admin/inventory` | no | protected operational | 303 | direct | 303 | pass |
| `admin/login.astro` | `/admin/login` | no | public allowlisted | 200 | deliberately none | 200 | sole public admin page |
| `admin/loyalty.astro` | `/admin/loyalty` | no | protected operational | 303 | direct | 303 | zero markers |
| `admin/measurement-control-tower.astro` | `/admin/measurement-control-tower` | no | protected operational | 303 | direct | 303 | pass |
| `admin/measurement-handover.astro` | `/admin/measurement-handover` | no | protected operational | 303 | direct 8-B1 | 303 | zero markers |
| `admin/measurement/attribution.astro` | `/admin/measurement/attribution` | no | protected operational | 303 | direct 8-B0A | 303 | zero markers |
| `admin/measurement/consent.astro` | `/admin/measurement/consent` | no | protected operational | 303 | direct 8-B0A | 303 | zero markers |
| `admin/measurement/control-tower/controlled-activation/live-review/[id].astro` | `/admin/measurement/control-tower/controlled-activation/live-review/[id]` | yes | protected operational | 303 | guard 7, redirect 9, fetch 19, markup 41 | 303 sample | documented `test-candidate`; zero markers |
| `admin/measurement/control-tower/controlled-activation/live-review/index.astro` | `/admin/measurement/control-tower/controlled-activation/live-review` | no | protected operational | 303 | direct 8-B0A | 303 | zero markers |
| `admin/measurement/dlq.astro` | `/admin/measurement/dlq` | no | protected operational | 303 | direct 8-B0A | 303 | zero markers |
| `admin/measurement/index.astro` | `/admin/measurement` | no | protected operational | 303 | direct 8-B0A | 303 | zero markers |
| `admin/merchandising/index.astro` | `/admin/merchandising` | no | protected operational | 303 | direct | 303 | pass |
| `admin/notifications/index.astro` | `/admin/notifications` | no | protected operational | 303 | direct | 303 | pass |
| `admin/orders/[id].astro` | `/admin/orders/[id]` | yes | protected operational | 303 | guard 8, redirect 10, fetch 24, markup 203 | not applicable | no new sample invented |
| `admin/orders/index.astro` | `/admin/orders` | no | protected operational | 303 | direct | 303 | pass |
| `admin/payments/index.astro` | `/admin/payments` | no | protected operational | 303 | direct | 303 | pass |
| `admin/pricing/index.astro` | `/admin/pricing` | no | protected operational | 303 | direct | 303 | pass |
| `admin/products/[id].astro` | `/admin/products/[id]` | yes | protected operational | 303 | guard 8, redirect 10, fetch 15, markup 36 | not applicable | no new sample invented |
| `admin/products/[id]/edit-properties.astro` | `/admin/products/[id]/edit-properties` | yes | protected operational | 303 | guard 8, redirect 10, fetch 17, markup 78 | not applicable | no new sample invented |
| `admin/products/[id]/edit.astro` | `/admin/products/[id]/edit` | yes | protected operational | 303 | guard 11, redirect 13, fetch 20, markup 109 | not applicable | no new sample invented |
| `admin/products/index.astro` | `/admin/products` | no | protected operational | 303 | direct | 303 | pass |
| `admin/products/new.astro` | `/admin/products/new` | no | protected operational | 303 | direct | 303 | pass |
| `admin/quotes/index.astro` | `/admin/quotes` | no | protected operational | 303 | direct | 303 | pass |
| `admin/recommendations/analytics.astro` | `/admin/recommendations/analytics` | no | protected operational | 303 | direct | 303 | pass |
| `admin/recommendations/index.astro` | `/admin/recommendations` | no | protected operational | 303 | direct | 303 | pass |
| `admin/recommendations/preview.astro` | `/admin/recommendations/preview` | no | protected operational | 303 | direct | 303 | zero markers |
| `admin/recommendations/rules/[id].astro` | `/admin/recommendations/rules/[id]` | yes | protected operational | 303 | guard 15, redirect 16, markup 95, fetch 380 | not applicable | no new sample invented |
| `admin/recommendations/rules/index.astro` | `/admin/recommendations/rules` | no | protected operational | 303 | direct | 303 | pass |
| `admin/recommendations/rules/new.astro` | `/admin/recommendations/rules/new` | no | protected operational | 303 | direct | 303 | pass |
| `admin/release-readiness.astro` | `/admin/release-readiness` | no | protected operational | 303 | direct 8-B1 | 303 | zero markers |
| `admin/reports/index.astro` | `/admin/reports` | no | protected operational | 303 | direct | 303 | pass |
| `admin/roles/index.astro` | `/admin/roles` | no | protected operational | 303 | direct | 303 | pass |
| `admin/settings/index.astro` | `/admin/settings` | no | protected operational | 303 | direct | 303 | pass |
| `admin/support/index.astro` | `/admin/support` | no | protected operational | 303 | direct | 303 | pass |
| `admin/system/index.astro` | `/admin/system` | no | protected operational | 303 | direct | 303 | pass |
| `admin/users/index.astro` | `/admin/users` | no | protected operational | 303 | direct | 303 | pass |
| `admin/utm-builder/index.astro` | `/admin/utm-builder` | no | protected operational | 303 | direct | 303 | pass |
| `admin/verification/index.astro` | `/admin/verification` | no | protected operational | 303 | direct | 303 | pass |

Concrete crawl result: all 43 concrete routes matched policy—42 protected routes returned `303`, and `/admin/login` returned `200`. All six dynamic routes have source-level guards before protected fetch/markup. No unknown or unclassified admin page exists.

## Protected body checks

Logged-out bodies returned zero matches for the full protected-marker set on `/admin`, `/admin/loyalty`, `/admin/recommendations/preview`, all five 8-B1 routes, and all six 8-B0A Measurement routes including the documented dynamic sample. The marker set covered Control Tower, destinations, DLQ, replay, attribution, activation/canary/handover/readiness, credentials/providers, queues/outbox, admin navigation, and module cards.

## Loyalty safety

The live page states that GoldPlus Rewards is being prepared and not active; purchases are not yet earning live points; quests, Memory Lane, utilisation-aware offers, and mystery reveals are previews/future concepts; and no live discount, prize, or code exists. None of the forbidden earned-points, redeem, VIP, claim, applied-offer, personalised-price, balance, rank, scratch/spin-now, winner, or claim-now strings appeared.

## Release gates

- 13 protected focused suites: `226/226` tests passed.
- Secret scan: passed across 869 source/config files; values were not printed by the scanner.
- Typecheck: passed.
- Lint: passed with zero errors and established warnings only.
- Build: passed.
- Full suite: `139/139` files and `912/912` tests passed.
- Full tests emitted synthetic negative-path fixture strings; no production secret was read or printed.

## Protected source checksum manifest

SHA-256 values at starting commit `42969e4446d5097bfd161f83b6577629d2292601`:

```text
763911a341783f29e564dd5f61583dc9d14df8eda8131f282f82b5dfd1ba38d0  apps/web/src/pages/loyalty.astro
b286b61a9ab4b2e8bdb96745041dfb945954667ba4b0f35e949c1f13a7985519  apps/web/src/lib/loyalty-foundation.ts
f4106e6f6732ec5d783806457622941700c12045fd5aee3adad80c25a8ff0765  apps/web/src/pages/admin/loyalty.astro
536114a06f2f5e6f157aac545e743a9baf5c8d76000aec7a9d1ed8b3f1b07a81  apps/web/src/components/admin/AdminModuleCard.astro
7ede6cc1425a1baa78ef0e3a31e47e3aa910ea3f4fa88d0d843130987d624521  apps/web/src/components/admin/AdminEmptyState.astro
896f3c433ce7210376c209be2e1bbc80b9e694d0a7184ab9768b80df69d03547  apps/web/src/components/admin/AdminReadinessChecklist.astro
1b105d167d75e547956ae6f3e0b4316d5259adaa2c904bb6635e06d4d5aa4f4f  apps/web/src/lib/admin-trust-centre.ts
0f4aa0d54ea954c57c9eeef1d4bc1ec5ced3982657a621b0b73f932b4376a085  apps/web/src/pages/admin/index.astro
b27c9cf6d5a5e79dd9b68234556437f02909847bd17a4b9c6611caace38b6bbb  apps/web/src/pages/admin/measurement-control-tower.astro
9822b4d615eb789486ddda92fe4c8dd8459e41cca960d76277f7b82f36b052f7  apps/web/src/pages/admin/measurement/index.astro
321b7a495d609bfcd056804b44c44e55c717f8a2774e9972237c354dfd67f762  apps/web/src/pages/admin/measurement/attribution.astro
2ceaefffc4b001de6182f956f7060cdbbb4a8373623aaf5909245838c8bbb7e4  apps/web/src/pages/admin/measurement/consent.astro
e4e347a09d2d08dd0d74573de2e09b05b83ad828264a6e9b323c12404862aa6a  apps/web/src/pages/admin/measurement/dlq.astro
10d3d49843628389b3230a5c3095634f2ad0be20e20eea303463a1a404c10090  apps/web/src/pages/admin/measurement/control-tower/controlled-activation/live-review/index.astro
34c37689c688cb32e9a8d137e108d6f978b3d4d2c60feef65a1506d9ce94f88b  apps/web/src/pages/admin/measurement/control-tower/controlled-activation/live-review/[id].astro
30b52ca0454cd4bf587b1c5d97558c5f9808c95d8ea475ae5348f8717a58d798  apps/web/src/pages/admin/controlled-activation-dry-run.astro
1e8600150542d1390052c7f27887aca5be115281eef36575f34927c5f51b323d  apps/web/src/pages/admin/controlled-activation.astro
e32904d5187703088b2bd64a85acf533a374381b86aca7ef3fee23a7b8ddb4fa  apps/web/src/pages/admin/controlled-live-canary.astro
6500de8dc472b9c46c8fd96ba0d4a4afaac024758449551a4700f1de3cf13748  apps/web/src/pages/admin/measurement-handover.astro
051bb3bfec3d61a741862505ce9c73048cb249d46c90d5bd63e537616471a1ee  apps/web/src/pages/admin/release-readiness.astro
c3c5812c833acde059aa1cfb61feb601058f8e67223e9acb91c6b5a0ec6948d9  tests/unit/Slice08B0AdminMeasurementProtection.test.ts
07fd1c9d021ae1dc93aa84da840b2b7a9d318b352ad2a53113891c032ac27565  tests/unit/Slice08B1AdminRouteProtectionSweep.test.ts
346224d76ddbba0663f8f7ca87879e5ef0dd4376b20d39c461ce40727b593892  apps/web/src/utils/api-fetch.ts
10d0ad9866046c66de5fa528b6b3daeaa1f2ac27db3b7a9c04f6d1167273fbaa  apps/web/src/utils/date-format.ts
e9485c6c5b398b804814325cf24a3c7a031813230e46f3d9ac080290793acb5b  apps/web/src/components/recommendations/CartAddonRail.astro
56e6b3436e05e9cfaefe00f692d1f6e2a1852a8381eb0de951ab605ee1126c85  apps/web/src/components/recommendations/CategoryPopularRail.astro
a98a9e0d7b8b3c4919a016234f85df1b1bb7034509a35509cf26c6a217ca0b40  apps/web/src/components/recommendations/CompleteSetupRail.astro
477bc975c26527f92bda9fc4def6effea6255bef2c1a89c6975ea49fbeeffd53  apps/web/src/components/recommendations/PopularNowRail.astro
53771245cece04eb4371eae9eee491a4f877dd8fdf5b897313c12682a0827501  apps/web/src/components/recommendations/RecentlyViewedRail.astro
f59b84beb5e8849afc3c312525df321466eb132f41cd0d9315e5abb5a189eab8  apps/web/src/components/recommendations/RecommendationCard.astro
794336e82c585257a9db741b0630e944ef9c2517992cc405fa010e5068d992f6  apps/web/src/components/recommendations/RecommendationRail.astro
0a5e87745d378759ca9080765639d3e7ed3d44b8f69017afdba9b65e2e32f1a8  apps/web/src/components/recommendations/RecommendationRulePreviewPanel.astro
379330aa5598489cf1edec6d090c4be78d10b351d5632fe3385329f56b777395  apps/web/src/components/recommendations/RelatedProductsRail.astro
4677d380f298dd899537a7347a86b67c591a789cada522ff98ad3562434fa359  apps/web/src/lib/recommendation-display.ts
25abc73d63df1d5a320c329b8c368a961efba4bb4e71e367950e02915e452f2e  apps/web/src/lib/recommendations.ts
144da30e2af65292d80cc967cd35a7a0a2f213d80f5e4dd2fdb947e6cf48a097  apps/web/src/pages/admin/recommendations/preview.astro
043226131a7899fe6de8a30e9193069902c1467f5cfe1e757fee5e2222d3686c  apps/web/src/pages/products/[slug].astro
7075994dfae1392f36d7230ee8f42133486882377063df7a649a247c9a4e9a10  apps/web/src/components/ProductCard.astro
378c9322e73df16aa5c70dedabb9480a44d705f7c73c1a06004475d6d2efa463  apps/web/src/lib/product-discovery.ts
90f4f42a57ec564192b4b7381c2ed7b49923aa0316e4913feaa0070f874d424c  apps/web/src/pages/shop.astro
c0f1cb4ad35752421c8ccc07921283e7c9c493a7627b6216b4749252e1453ec8  apps/web/src/pages/checkout.astro
625c84e1111319fc057b52dd96d4352ab51053d47916f7db650ebbf1d37905da  apps/web/src/lib/checkout.ts
73881c2ccbc35362f40946a30928f94c4407becd65edcf8023be05545df994a1  apps/web/src/pages/support/index.astro
fa261f98b24e7ff8d17aa77ac2f640bb5c35be737e0c90ae15d2e4375a39e385  apps/web/src/pages/track-order.astro
1f2be873b2140489fa06a89bf709a61827cc058a97b7818236440510cf68d0e4  apps/web/src/pages/terms.astro
788ce88f9699a68009166d1b7ee6a7073cdcdaf07e583515977c0ed00576114e  apps/web/src/pages/privacy.astro
c1ab7ccf74f7b8b5fdf34e1162aae3f620ccf53da5d3a40a8f7ddbecfee18766  apps/web/src/pages/product-finder.astro
```

## Host-source hygiene and rollback register

- Host Git metadata remains `f69aa6e038fb1bd0964a1cf0cdb6e6ee0208a751`; the release branch remains source truth.
- Host/local utility hashes match exactly: `api-fetch.ts` is `346224d7...3892`; `date-format.ts` is `10d0ad98...fbaa`.
- The production checkout source pair remains at the established `ef36fa93...3794` and `eb82d89e...1005` hashes, differing from clean source but matching prior production evidence; checkout behavior remains `303`.
- Continue checksum-scoped overlays until a separately authorized host-source hygiene slice. Do not pull/reset production broadly.
- Verified backups: `/opt/goldplus/backups/slice-08-a-20260714T015400Z`, `/opt/goldplus/backups/slice-08-b0a-20260714T160333Z`, and `/opt/goldplus/backups/slice-08-b1-20260714T194055`.
- Both web replicas remain healthy at their 8-B1 creation timestamp `2026-07-14T16:42:29Z`; both API replicas remain healthy at `2026-07-13T21:20:09Z`. Slice 8-B deployed and restarted nothing.
- Slice 8-A rollback: restore scoped loyalty/admin files, remove recorded new paths, rebuild web, recreate web replicas only, and rerun public/admin smoke.
- Slice 8-B0A rollback: restore six Measurement routes, remove the two utilities only for a deliberate pre-8B0A return, rebuild web, recreate web replicas only, and rerun smoke.
- Slice 8-B1 rollback: restore five operational routes, rebuild web, recreate web replicas only, and rerun the complete admin/public crawl.
- Slice 8-B evidence rollback: revert its evidence-only commit; no runtime rollback is necessary.

The dirty original worktree was not used, inspected for contents, cleaned, stashed, or modified. Slice 9 was not started.
