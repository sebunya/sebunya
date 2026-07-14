# Slice 9-B1 artifact review

## Decision scope

Slice 9-B1 is an evidence-and-contract slice at starting baseline `6afc99838545ed6e38d6cf3db9e23bf6e8a0d223`. The only permitted artifacts are the two substantive evidence records, this artifact review, and one unit contract. Deployment is forbidden.

## Allowed artifact set

1. `docs/platform/evidence/slices/slice-09-b1-preference-surface-discovery.md`
2. `docs/platform/evidence/slices/slice-09-b1-consent-source-of-truth-blueprint.md`
3. `docs/platform/evidence/slices/slice-09-b1-artifact-review.md`
4. `tests/unit/Slice09B1PreferenceSurfaceReconciliation.test.ts`

Any other path is out of scope and must block staging.

## Review findings

| Review question | Result | Evidence |
|---|---|---|
| Does this slice add preference persistence? | No | No application, API, schema, migration, browser-storage, or runtime file is allowed |
| Does it save or claim to save a customer preference? | No | The artifacts describe current behavior and future contracts only |
| Does it activate email, SMS, WhatsApp, phone, provider, queue, or outbox delivery? | No | Provider delivery is explicitly disabled pending a separate activation |
| Does it change checkout, payment, PesaPal, cart, or order state? | No | These are inventory inputs only; no runtime path is edited |
| Does it change auth or RBAC? | No | Existing account and admin guards are evidence only |
| Does it change Measurement behavior? | No | Existing Measurement consent is documented as a bounded authority only |
| Does it activate loyalty, Memory Lane, personalization, or utilization-aware offers? | No | Each remains future-only and separately consented |
| Does it create a migration or data model? | No | The blueprint names future logical entities and explicitly says they are not approved migrations |
| Does it send customer communications? | No | No production execution or provider call occurs |
| Does it deploy or restart a service? | No | Deployment is forbidden for Slice 9-B1 |
| Does it expose secrets or inspect secret-like files? | No | Source/path and contract review only; no credentials or environment contents are included |
| Does it alter the public Slice 9-B Preference Centre? | No | `/preferences` and `/consent` remain unchanged |

## Copy safety review

The public Preference Centre remains honest: it says the centre is being prepared, no marketing messages are sent from the page, verification may be required, support can help, and future programmes are inactive. The footer newsletter says email updates are opening soon and has no form.

The authenticated legacy account preference page says a successful update is “saved and audited.” Source tracing found an authenticated PUT, preference upsert, and audit write before the success response; the statement is therefore not demonstrably false. It remains high risk because its channel descriptions bundle service, support, optional offers, and Measurement purposes. This slice documents that risk without silently changing customer-facing behavior.

Checkout and support copy does not establish marketing consent. Checkout contact is bounded service/order intent. The support issue form expressly limits supplied contact details to support follow-up. The blueprint makes both non-equivalences mandatory.

## Source-of-truth conclusion

No single canonical cross-purpose consent source exists today. Current authority is partitioned among service records, legacy account preference JSON, Measurement consent, and future provider STOP/unsubscribe state. The proposed model reconciles rather than overwrites those sources and fails closed on ambiguity.

## Safety invariants reviewed

- Purpose and channel are separate dimensions.
- Service contact cannot become optional marketing consent.
- Support contact cannot become campaign consent.
- Product interests cannot become communication consent.
- Loyalty, Memory Lane, personalization, and utilization-aware offers require separate choices.
- Provider STOP/unsubscribe and verified withdrawal override marketing.
- Unknown, pending, expired, superseded, policy-blocked, or unverified state cannot authorize an optional send.
- Provider adapters require a current decision receipt and remain disabled until separately activated.
- Audit evidence is immutable, access-controlled, redacted, and required before optional delivery.
- The legacy persistence stack is an input to future reconciliation, not silently declared canonical.

## Verification plan

The focused test validates the inventory schema and required surfaces, all twelve purposes, all ten consent states, channel coverage, precedence statements, audit fields, provider enforcement gates, non-implementation declarations, exact allowed artifact set, and absence of runtime changes. Protected regression suites, secret scan, typecheck, lint, build, and the full suite must pass before the evidence-only commit.

## Gate results

| Gate | Result |
|---|---|
| Slice 9-B1 focused contract | Passed: 89/89 tests |
| Slice 9-B Preference Centre regression | Passed: 84/84 tests |
| All other explicitly protected regression files | Passed |
| Secret scan | Passed: 874 source/config files checked; values were not printed |
| Typecheck | Passed |
| Lint | Passed with zero errors; baseline warnings remain |
| Build | Passed; no Sentry release or source-map upload occurred because no auth token was configured |
| Full suite | Passed: 141 files, 1,085 tests |
| Production deployment | None |
| Service restart | None |
| Provider/send action | None |

## Staging and release discipline

Stage only the four allowed paths by an explicit allowlist. Verify cached names, cached stat, cached whitespace, and exact allowlist equality. Commit with `Slice 9-B1: reconcile preference surfaces`. Push only that verified commit to `origin/phase-2-measurement-control-tower-completion`. Do not deploy.

## Rollback

Because this slice changes evidence and tests only, rollback is a normal revert of its single commit. No database, provider, runtime, customer state, or production rollback is required. The pre-slice source baseline is `6afc99838545ed6e38d6cf3db9e23bf6e8a0d223`.
