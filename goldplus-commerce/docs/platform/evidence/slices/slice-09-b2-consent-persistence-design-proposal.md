# Slice 9-B2 consent persistence design proposal

## 1. Executive design summary

GoldPlus should later implement consent as an auditable projection over immutable evidence, keyed by verified subject, verified endpoint, purpose, and channel. A current state is never authority by itself: every decision must resolve identity, policy, withdrawals, provider suppressions, source precedence, copy version, and activation state. Only an exact, current `granted` state may contribute to optional eligibility, and every other gate must also pass.

This design proposes future implementation. It does not create migrations. It does not implement APIs. It does not persist preferences. It does not activate provider enforcement. It does not send customer communications.

## 2. Design-only authorization boundary

Slice 9-B1RC authorized proposals for logical schema, commands, identity, audit, migration, workflows, dry-run enforcement, tests, and rollback. The authority is sponsor-attributed and conditional. This proposal is not legal, privacy, security, provider/channel, operator/support, or data-owner implementation approval.

## 3. Non-authorized implementation boundary

No actual table, migration, Drizzle schema, endpoint, use case, repository, customer write, preference save, callback ingestion, provider decision, queue/outbox action, send, runtime page, checkout/payment change, auth/RBAC change, loyalty ledger, Memory Lane, personalisation, utilisation-aware offer, discount, coupon, deployment, or restart is authorized. Formal specialist approvals remain blockers.

This design proposes future implementation. It does not create migrations. It does not implement APIs. It does not persist preferences. It does not activate provider enforcement. It does not send customer communications.

## 4. Canonical consent domain model

### Aggregate and invariants

The future `ConsentDecisionAggregate` is identified by `customer_identity_ref + verified endpoint reference + purpose_key + channel_key`. It projects one of: `unknown`, `not_requested`, `requested_support_assisted`, `pending_verification`, `granted`, `withdrawn`, `expired`, `superseded`, `blocked_by_policy`, or `service_only`.

Invariants:

1. Optional eligibility requires exact purpose/channel `granted`, verified identity and endpoint, current copy/policy compatibility, no withdrawal, no policy block, no channel suppression, and explicit future provider activation.
2. `service_only` is context-bound and can never promote to optional marketing.
3. State changes append immutable/tamper-evident events; projections may change, evidence may not.
4. Purpose and channel are independent; broad channel flags cannot mint purpose consent.
5. A restrictive authoritative event wins; uncertainty resolves to `unknown` and deny.
6. Actor, source, copy, correlation, reason, prior/new state, and verification evidence are mandatory for a future write.

### Approved purpose and channel keys

Purpose keys: `service_order_updates`, `support_follow_up`, `warranty_product_care`, `product_education`, `marketing_offers_campaigns`, `loyalty_programme_updates`, `quest_progress_and_badges`, `memory_lane_annual_journey`, `personalised_product_guidance`, `utilisation_aware_offers`, `research_feedback_surveys`, `account_security_notifications`.

Channel keys: `whatsapp`, `email`, `sms`, `phone`, `in_account`, `support_assisted`.

## 5. Proposed future data model

Logical entities only; specialist approval is required before implementation of every entity.

| Entity | Purpose | Key fields | Relationships | Immutability | PII handling | Retention | Index/search | Owner | Risk / required specialist approval |
|---|---|---|---|---|---|---|---|---|---|
| `consent_purposes` | Versioned purpose taxonomy and classification | `purpose_key`, policy version, classification, active window, `created_at`, `expires_at`, `superseded_by` | referenced by states, events, copies, blocks | versions immutable; supersede, never overwrite semantics | no customer PII | retain all versions while referenced plus approved legal period | unique purpose/version; active lookup | Data owner | Critical semantic drift; legal, privacy, product, data owner |
| `consent_channels` | Versioned channel capabilities and verification requirements | `channel_key`, verification policy, suppression scope, active window | referenced by states, suppressions, callbacks | channel policy versions immutable | no endpoint values | retain referenced versions | unique channel/version | Provider/channel owner | High; provider, security, privacy |
| `customer_consent_states` | Current projection for exact subject/endpoint/purpose/channel | `customer_identity_ref`, endpoint token/ref, `purpose_key`, `channel_key`, `identity_verification_level`, `state`, `source_surface`, `copy_version_id`, `effective_at`, `expires_at`, `superseded_by`, last event ref | derived from consent events; references purpose/channel/copy/source | projection mutable only transactionally from appended event; never source evidence | opaque refs/tokens; no raw contact in general query surface | projection lifetime plus tombstone per approved erasure model | unique aggregate key; state/expiry lookup; no broad PII search | Consent data steward | Critical identity and race risk; privacy, security, data owner |
| `consent_events` | Immutable evidence ledger for every transition/decision | `consent_event_id`, aggregate refs, `previous_state`, `new_state`, `actor_type`, `actor_id`, `reason`, `correlation_id`, refs, `created_at`, `effective_at`, `integrity_hash`/`tamper_evidence_ref` | parent evidence for state projection and receipts | append-only; corrections supersede by new event | opaque identity/actor refs; encrypted sensitive evidence; redacted reads | legal/privacy-approved schedule with holds; integrity metadata retained as approved | aggregate/time, correlation, event type; restricted actor search | Audit owner/data steward | Critical; legal, privacy, security, data owner |
| `consent_copy_versions` | Prove exact wording/purpose/channel shown | `copy_version_id`, purpose/channel applicability, locale, content hash, policy version, active window, `superseded_by` | referenced by grant/request/events | immutable version/content hash | copy only, no customer PII | retain while evidence can be relied upon plus approved period | version and content hash | Product/content owner | High evidence risk; legal, privacy, product |
| `consent_source_surfaces` | Registry of permitted evidence sources and assurance | source key, `source_surface`, actor class, verification floor, authority class, policy version | referenced by events/states/requests | versioned immutable policy | no customer PII | retain all referenced versions | source/version/authority | Data owner | High source inflation; privacy, security, data owner |
| `channel_suppressions` | Current restrictive projection for endpoint/channel/purpose or global channel | suppression ref, identity/endpoint ref, `channel_key`, optional `purpose_key`, scope, reason, source, `effective_at`, `expires_at`, last callback/event | derived from provider unsubscribe and policy events | projection mutable only from immutable evidence | tokenized endpoint; restricted lookup | provider/legal-approved duration; never silently expire STOP | endpoint token/channel/purpose, active status | Provider/channel owner | Critical missed STOP; provider, legal, privacy, security |
| `provider_unsubscribe_events` | Immutable authenticated STOP/unsubscribe/bounce/complaint evidence | provider event id/ref, `provider_callback_ref`, channel, endpoint token, purpose/scope, received/provider time, authenticity/freshness result, `correlation_id`, integrity ref | projects suppressions and consent events | append-only; duplicates linked, not deleted | minimize payload; encrypted quarantine for raw callback if approved | shortest approved raw retention; normalized evidence retained per policy | provider/ref idempotency, endpoint/channel, received time | Provider/channel owner | Critical forgery/replay; provider, security, privacy, legal |
| `support_assisted_preference_requests` | Track requests before verified authorized change | request id, `customer_identity_ref`, purpose/channel, requested state, verification level/status, `support_ticket_ref`, actor, script/copy version, expiry, `correlation_id` | may lead to verified command/event; never directly grants | request history append/supersede; resolution recorded | minimum support evidence; restricted agent access | support/privacy-approved SLA then minimize | ticket, identity ref, status/expiry | Operator/support owner | High impersonation/manual override; support, privacy, security |
| `legacy_preference_mappings` | Versioned interpretation rules and dry-run results for broad flags | mapping version, legacy system/field/value, target purpose/channel, proposed state, confidence, reason, review status, `superseded_by` | feeds migration dry-run only until approved | mappings versioned; result evidence immutable | no PII in rules; report uses pseudonymous refs | retain migration evidence through reconciliation/rollback window | source/field/version/review status | Data owner | Critical over-grant; legal, privacy, data owner, product |
| `consent_policy_blocks` | Authoritative legal/safety/jurisdiction/abuse/fairness block evidence | block id, identity or cohort scope, purpose/channel, `policy_block_reason`, authority, actor, `effective_at`, `expires_at`, `correlation_id`, integrity ref | highest-precedence input to projection/eligibility | append/supersede; no silent deletion | prefer policy/cohort refs; restrict customer-specific blocks | policy-approved duration and appeal history | active scope/purpose/channel/expiry | Legal/policy owner | Critical wrongful allow/deny; legal, privacy, security, sponsor |

Shared future field concepts include `purpose_key`, `channel_key`, `customer_identity_ref`, `identity_verification_level`, `state`, `source_surface`, `copy_version_id`, `previous_state`, `new_state`, `actor_type`, `actor_id`, `reason`, `correlation_id`, `provider_callback_ref`, `support_ticket_ref`, `policy_block_reason`, `created_at`, `effective_at`, `expires_at`, `superseded_by`, and `integrity_hash` or `tamper_evidence_ref`.

## 6. Proposed command model

Contracts only; these are not endpoints or implemented handlers.

| Command | Allowed actor | Required input | Validation and identity | Audit event | Failure/idempotency/auth | Red-line guard / approval dependency |
|---|---|---|---|---|---|---|
| `RequestPreferenceChange` | verified account subject; trained support agent initiating a request | subject/endpoint refs, purpose/channel, requested state, source/copy, correlation | taxonomy active; endpoint bound; account verified or support flow begins `requested_support_assisted` | `preference_change_requested` | reject ambiguity/invalid copy; client idempotency key; authenticated subject or scoped agent role | checkout/support contact cannot grant; privacy/product/security/support approval |
| `VerifyPreferenceChange` | subject verification service or authorized agent following approved script | request ref, challenge/evidence ref, result, time, correlation | freshness, attempts, binding to subject/endpoint/request | `preference_change_verified` | expired/replayed/mismatched challenge fails; verification idempotency; service/agent authorization | verification cannot bypass STOP/policy; security/privacy approval |
| `RecordConsentGrant` | verified account subject or approved support flow after verification | aggregate key, copy/source, explicit grant, verification evidence, reason, correlation | exact purpose/channel, active copy, required identity, no implicit inference | `consent_grant_recorded` | duplicate key returns prior receipt; authenticated/authorized; concurrent version conflict fails | no legacy/checkout/support/Measurement/interest inference; legal/privacy/security/data-owner approval |
| `RecordConsentWithdrawal` | verified subject, authenticated provider callback adapter, approved agent | aggregate/scope, withdrawal source, reason, evidence, correlation | authentic identity/callback; scope cannot broaden beyond evidence | `consent_withdrawal_recorded` | restrictive retry safe; idempotent per source event; least privilege | withdrawal wins over marketing; legal/privacy/security approval |
| `RecordProviderStopSignal` | verified provider callback adapter only | provider/ref, endpoint token, channel/scope, provider time, signature/freshness evidence | signature, timestamp window, replay/idempotency, provider mapping | `provider_stop_recorded` | quarantine invalid callback; provider event id idempotent; adapter credential/role | STOP overrides local optional preference; provider/security/privacy/legal approval |
| `RecordProviderUnsubscribeSignal` | verified provider callback adapter only | callback ref, endpoint/channel/purpose/global scope, reason, provider time | authenticity, freshness, scope mapping, minimal payload | `provider_unsubscribe_recorded` | duplicates safe; unknown mapping suppresses conservatively and escalates | unsubscribe wins; provider/security/privacy/legal approval |
| `ApplyPolicyBlock` | separately authorized policy controller | scope, reason/code, authority, effective/expiry, evidence, correlation | approved policy version and actor; no arbitrary free-form override | `policy_block_applied` | version conflict/revoked authority fails; idempotent block key; dual control if required | policy block highest precedence; legal/security/sponsor approval |
| `SupersedeConsentState` | projection/reconciliation service under controlled use case | prior/new event refs, reason, expected version, correlation | successor must exist and be more authoritative/current | `consent_state_superseded` | optimistic conflict fails; idempotent successor; service authorization | never delete or rewrite evidence; data-owner/security/privacy approval |
| `RecordSupportAssistedPreferenceRequest` | trained scoped support agent | ticket, subject/contact refs, purpose/channel, requested state, script version, reason | approved script; support identity verification; cannot mark granted | `support_assisted_request_recorded` | duplicate ticket/request safe; expired/unverified remains deny; agent role | no manual override without audit; support/privacy/security approval |
| `ResolveConsentConflict` | controlled reconciliation service; authorized reviewer for exceptional case | competing event refs, precedence rule/version, resolution, reason, expected version | deterministic precedence first; human action role/reason/audit; restrictive on uncertainty | `consent_conflict_resolved` | unresolved/invalid evidence yields `unknown`; resolution idempotency; dual control where required | withdrawal/STOP/policy cannot be downgraded manually; legal/privacy/security/data owner |
| `PreviewProviderEligibility` | authorized admin/operator or internal dry-run evaluator | subject/endpoint, purpose/channel, message/template/copy refs, as-of time, correlation | read-only evaluation of every gate; no transport call | `provider_eligibility_previewed` | missing data returns ineligible; request idempotency; redacted role-controlled response | unknown denies; provider delivery remains disabled; provider/security/privacy approval for 9-B6 |

## 7. Proposed audit event model

Immutable event types: `consent_grant_recorded`, `consent_withdrawal_recorded`, `preference_change_requested`, `preference_change_verified`, `provider_stop_recorded`, `provider_unsubscribe_recorded`, `policy_block_applied`, `consent_state_superseded`, `support_assisted_request_recorded`, `consent_conflict_resolved`, `provider_eligibility_previewed`.

Every future event envelope includes: `consent_event_id`, event type/version, `customer_identity_ref`, endpoint ref where applicable, `purpose_key`, `channel_key`, `state`, `source_surface`, `actor_type`, `actor_id`, timestamp, `copy_version_id`, `previous_state`, `new_state`, `reason`, `provider_callback_ref`, `support_ticket_ref`, `correlation_id`, `retention_policy`, and `integrity_hash` or `tamper_evidence_ref`. Nullability must be event-type constrained, not silently omitted.

No future persistence implementation is acceptable without immutable or tamper-evident audit events. Hashing must use canonical serialization and protected key/version metadata; verification failures fail closed and raise an operational alert. Corrections append compensating/superseding events.

## 8. Identity verification model

| Level | Future authority | Explicit restriction |
|---|---|---|
| `anonymous` | View public guidance; initiate non-authoritative flow | Anonymous cannot save consent or authorize a send |
| `checkout_contact_only` | Bounded order service context | Checkout contact only cannot authorize marketing |
| `support_verified_contact` | Request support-assisted change after approved verification | Cannot directly grant; must complete reviewed workflow |
| `verified_account` | Manage account-bound preferences once persistence is separately approved | Account login does not override endpoint, purpose, suppression, or policy checks |
| `provider_callback_verified` | Suppress channel or record authentic STOP/unsubscribe | Callback can restrict, never manufacture a broader grant |
| `admin_operator_confirmed` | Act with scoped role, reason, verification evidence, and immutable audit | No manual override; cannot defeat policy, withdrawal, STOP, or least privilege |

Endpoint ownership/possession and subject identity are separate assurances. Shared contacts, changed endpoints, account recovery, stale sessions, and cross-customer collisions must deny optional grants pending verification.

## 9. Source precedence and conflict resolution

Highest authority first:

1. legal/policy block
2. provider STOP or unsubscribe callback
3. verified withdrawal
4. verified customer account preference
5. verified support-assisted update
6. audited Preference Centre submission
7. service communication necessity from checkout/order
8. legacy newsletter interest
9. marketing campaign import
10. unknown or implicit intent

Resolution selects the most restrictive applicable current evidence at the highest level. Same-level conflicts use effective time only after authenticity, scope, and policy-version compatibility; unresolved conflicts become `unknown`. Withdrawal overrides optional marketing. Provider STOP suppresses the affected channel. Checkout contact is service-only. Support conversation is support-follow-up only. Legacy broad flags cannot become canonical consent without purpose decomposition. Measurement consent is not messaging consent. Loyalty consent is not Memory Lane consent. Memory Lane consent is not utilisation-aware offer consent. Unknown intent cannot authorize provider sends.

## 10. Legacy account flag migration design

Inventory broad fields from Slice 9-B1, including mixed account email/SMS/WhatsApp settings, newsletter interest, Product Finder interests, loyalty/programme readiness, and separate Measurement records. Produce a versioned, pseudonymous dry-run report containing source field/value, proposed purpose/channel, proposed state, confidence, evidence gap, count, and collision/conflict category.

Rules:

- Broad or ambiguous flags map to `unknown` or `requested_support_assisted` unless purpose-specific, channel-specific, current, verified evidence exists.
- No automatic marketing grant from legacy flags.
- No automatic Memory Lane grant from loyalty interest.
- No automatic provider enforcement from account interest flags.
- Measurement records remain Measurement-only; Product Finder remains interest-only.
- Customer re-confirmation uses truthful pending/no-save copy until a separately approved verified write flow exists.
- Admin review is read-only during dry-run; exceptions require versioned mapping review, never row-by-row grant overrides.
- Migration dry-run compares counts, evidence completeness, conflicts, restrictive outcomes, and sample integrity without writes.
- Rollback for later migration restores projection reads to pre-migration source while retaining immutable migration events; never delete withdrawals/suppressions.

## 11. Provider STOP/unsubscribe suppression design

Future callback ingestion requires provider-specific signature/credential verification, timestamp freshness, nonce/event-id replay protection, strict payload limits, idempotency, endpoint tokenization, scope mapping, quarantine for invalid callbacks, and redacted audit. Suppression is channel-specific and purpose-specific when the provider supplies reliable purpose scope; a global channel stop suppresses all optional purposes on that channel.

Provider STOP/unsubscribe wins over local optional marketing preference for the affected channel. A later local grant does not clear suppression. Clearing requires an approved provider/channel process with authoritative evidence and a new event. Every callback yields an immutable provider event and restrictive consent/suppression projection. Live enforcement remains disabled.

## 12. Admin/operator workflow design

Future read/control surfaces: consent review dashboard, support-assisted request queue, role-controlled manual correction request, dispute workflow, condition-owner and due-date tracker, immutable audit viewer, conflict-resolution panel, provider-suppression viewer, and dry-run eligibility preview.

All reads are redacted and deny-by-default. A manual correction is a reviewed command producing a new event—not an edit—and requires role, subject verification, reason, ticket/case evidence, prior/new state, expected version, and dual control for high-risk cases. No operator can clear STOP, withdrawal, or policy block through a general override.

## 13. Support-assisted update workflow design

1. Open a ticket-bound request; show the approved script and purpose/channel choices.
2. Verify subject and endpoint using the approved risk-tiered method; record evidence reference, not unnecessary secrets.
3. Record `requested_support_assisted` or `pending_verification`; do not claim saved/granted.
4. Present exact copy version and capture the customer’s explicit choice.
5. Submit a separately authorized command with agent role, reason, ticket, correlation, and idempotency key.
6. Reconcile policy, withdrawal, STOP, conflicts, and optimistic version.
7. Append immutable event and only then project state in a future implementation.
8. Provide a truthful receipt; escalate disputes; expire incomplete requests by SLA.

## 14. Provider enforcement dry-run design

The future dry-run is read-only and transport-free. It checks: purpose allowed; channel allowed; exact current grant; verified subject and endpoint; no active withdrawal; no suppression; category matches purpose; required template approved; copy version compatible; rate/cap respected; audit event could be written; provider credential configured without exposure; and provider delivery explicitly enabled for future live mode.

Output: `eligible`/`ineligible`, ordered reasons, missing gates, suppression status/scope/freshness, consent state and evidence refs used, policy/copy/template versions, identity level, audit-event preview, correlation id, and `provider_delivery_remains_disabled: true`. Missing or errored checks produce `ineligible`. No live send and no provider transport call.

## 15. Privacy/security/legal review blockers

- Legal: purpose classification, lawful/service boundaries, withdrawal rights, retention, terms/privacy copy, jurisdiction and policy-block authority.
- Privacy: identity assurance, minimisation, retention/deletion, copy evidence, callback payload handling, subject rights and shared endpoints.
- Security: authentication/authorization, callback verification, replay controls, audit tamper evidence, agent abuse/dual control, encryption and redaction.
- Product: truthful states/copy, unbundled choices, verification UX and no incentive manipulation.
- Operator/support: approved scripts, SLA, escalation/dispute handling, training and manual-correction control.
- Provider/channel: templates, STOP/unsubscribe/bounce/complaint semantics, callback SLA, suppression scope and dry-run evidence.
- Data owner: canonical ownership, taxonomy/versioning, event stewardship, reconciliation and reporting boundaries.

All remain implementation blockers with owners and due dates tracked by the readiness checklist.

## 16. Implementation slice plan

| Future slice | Scope | Non-scope | Risk | Required approvals | Tests | Deployment expectation | Rollback |
|---|---|---|---|---|---|---|---|
| `9-B2A — Specialist Review Closure Pack` | Resolve open questions; approve purpose, identity, retention, audit, callbacks, workflows | No code, migration, writes, sends | Critical governance gaps | All specialists and sponsor | evidence completeness/red-line contract | None | supersede decisions; no runtime rollback |
| `9-B3 — Schema and Audit Migration Implementation, no provider sends` | Implement approved schema, immutable events, projection transaction, migration dry-run | No public mutation, preference UX, provider enforcement/sends | Critical data/audit migration | 9-B2A, legal/privacy/security/data owner, sponsor | migration up/down, integrity, isolation, concurrency, retention, zero-send | Controlled DB deploy only if separately authorized | forward fix/approved down path; preserve restrictive evidence |
| `9-B4 — Write Command Implementation, no provider sends` | Implement application commands/ports and verified write APIs under existing auth boundaries | No provider eligibility/enforcement/send; no auth/RBAC rewrite | Critical forged/incorrect writes | security/privacy/legal/product/data owner | command validation, authz, identity, idempotency, conflict, audit | API deploy only if separately authorized | disable routes/feature flag; retain audit; reconcile projections |
| `9-B5 — Admin/Support Review Workflow P0` | Implement deny-by-default reviewed queues, verification and audit views | No general override, provider send, checkout change | High insider/impersonation | operator, security, privacy, product | route protection, redaction, scripts, dual control, SLA | Web/API only if separately authorized | disable workflow; preserve requests/events |
| `9-B6 — Provider Enforcement Dry-Run, no sends` | Read-only eligibility evaluator and evidence reports | No transport invocation or live enforcement | Critical false eligibility/credential leak | provider, security, privacy, legal | every gate, failures deny, no-fetch/transport spy, redaction | Internal dry-run only | disable evaluator; reports are non-authoritative |
| `9-B7 — Preference Centre Persistence UAT, no sends` | UAT verified customer flows against approved persistence | No provider send or live campaign | Critical identity/copy/state truth | product, privacy, security, legal, QA | accessibility, identity, copy version, grants/withdrawals, receipts, rollback | UAT environment only | feature disable; reconcile test data per policy |
| `9-B8 — Provider Enforcement Live Readiness Gate` | Evidence-only go/no-go for later explicit activation | No live send in the gate | Critical customer/provider harm | all specialists, sponsor, release management | dry-run evidence, suppression freshness, rollback drill, canary plan | None | remain disabled |

## 17. Test strategy

- Domain/property tests: purpose/channel isolation, restrictive precedence, state transitions, expiry/supersession, service-only confinement.
- Command contract tests: input schemas, identity floors, authz, idempotency, optimistic concurrency, red-line negatives, audit emission.
- Audit tests: append-only behavior, canonical hashing/tamper detection, correction by supersession, redaction, retention metadata.
- Callback tests: authentic/invalid/stale/replayed/duplicate/out-of-order/provider-unknown callbacks, global vs purpose suppression.
- Migration tests: every legacy flag classification, ambiguous-to-unknown, zero automatic grants, dry-run totals, rollback/reconciliation.
- Workflow tests: deny-by-default routes, least privilege, script version, dual control, ticket binding, truthful copy, dispute path.
- Dry-run tests: each gate independently fails closed, deterministic reason ordering, no transport invocation, credentials never returned.
- Integration/UAT: transactional event+projection integrity, concurrent withdrawal vs grant, account/shared endpoint isolation, backup/restore rehearsal.
- Regression: Preference Centre remains no-save until approved; checkout/support/Measurement/loyalty/admin boundaries remain unchanged.

## 18. Rollback and failure strategy

Future writes must use one transaction for event append, projection compare-and-set, and outbox evidence where later approved; failure rolls back the projection and exposes no success. If audit append or integrity generation fails, deny the write. If projection rebuild disagrees, quarantine the aggregate and deny optional eligibility. Provider callback outages preserve provider-side suppression assumptions and fail eligibility closed. Migration runs begin report-only, then cohort/canary, with reversible read switching and reconciliation checkpoints. Rollback never deletes restrictive evidence or resurrects a grant superseded by STOP/withdrawal/policy.

This slice’s rollback is documentation/test commit reversion only; there is no runtime, data, provider, or deployment rollback.

## 19. Open questions

1. Which named specialists and canonical data steward accept each implementation condition?
2. What legal basis and exact service exception applies per purpose/jurisdiction?
3. What retention/deletion/hold schedule applies to raw callbacks, normalized events, identity evidence, and copy versions?
4. What assurance method proves subject and endpoint ownership for each channel and recovery scenario?
5. What tamper-evidence construction, key custody, verification cadence, and breach response are approved?
6. Which provider callbacks, signatures, STOP scopes, unsubscribe/bounce/complaint semantics, and freshness SLAs are authoritative?
7. Which legacy fields exist in production, and is any evidence sufficiently specific to avoid `unknown`?
8. Which admin/support roles and dual-control thresholds can be implemented without auth/RBAC redesign?
9. When do grants expire or require re-confirmation by purpose/channel?
10. What reporting can be produced without leaking identity, contact, or sensitive policy-block reasons?
11. What copy/template version compatibility rules and accessibility/localisation approvals apply?
12. What separate evidence would ever authorize 9-B8 and a later live activation slice?

This design proposes future implementation. It does not create migrations. It does not implement APIs. It does not persist preferences. It does not activate provider enforcement. It does not send customer communications.
