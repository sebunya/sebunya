# Blockers (exact unlock actions)

| ID | Blocks | Missing | Work already done | Unlock action | Retest |
|---|---|---|---|---|---|
| B-001 (REVISED by D-010: not a blocker) | GP-CH, GP-CDC, GP-MEDIA, GP-MART — now a single-host scheduled profile to benchmark | ~~A separate analytics host~~ (suggest ≥ 4 vCPU / 16 GB / 200 GB SSD, same Hetzner region, private network to the commerce host) | Postgres event/ledger/delivery layer is the durable source ClickHouse will mirror | Owner approves the server; then provision + DNS-less private networking | CH-01..08, MED-*, dbt tests |
| B-002 | Every live ad-platform certification | Ad accounts, pixels/datasets, tokens (Meta needs a Business portfolio) | Adapters + admin + gates built (0138/0139) | Owner enters ids/tokens at Admin → Advertising platforms | DLV/provider test packs, canary |
| B-003 | Google Ads transport choice | Account + API entitlement (legacy uploadClickConversions vs Data Manager — dossier §7.5) | Legacy upload adapter built, version field explicit | Owner opens Google Ads; check entitlement; implement Data Manager if legacy not permitted | Google golden tests |
| B-004 | Production science results (attribution, experiments, MMM, CLV, optimiser) | Real delivered-order history (today: 38 test orders, 0 paid) | Runners/fixtures/readiness states | Time + real sales | MMM-01 readiness returns INSUFFICIENT_DATA until then |
| B-005 | Clarity | Project ID | Loader + masking + CSP | Owner creates a Clarity project, sends the ID | Browser QA of masking |
| B-006 | PostHog product analytics/experiments | Project key/host | Canary transport only | Owner decides whether PostHog is in scope | — |
