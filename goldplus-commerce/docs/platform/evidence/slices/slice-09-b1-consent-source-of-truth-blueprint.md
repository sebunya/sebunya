# Slice 9-B1 future consent source-of-truth blueprint

## Status and boundary

This document is a future architecture contract, not an implementation. No canonical consent store, API, migration, provider enforcement, preference save, customer-specific automation, or send is activated by Slice 9-B1. The public `/preferences` page remains a static preview. Existing checkout, payment, auth/RBAC, loyalty, Measurement, notification, and provider behavior remains unchanged.

The future source of truth must answer one question reproducibly: **may this verified identity be contacted on this channel for this exact purpose now?** A channel address, an account, an order, a support conversation, an interest, or a general toggle cannot answer that question alone.

## Canonical purpose taxonomy

Each purpose is independently granted or withdrawn. Bundling is forbidden. Essential delivery of a contracted service is represented as `service_only`, never silently converted to optional consent.

| Canonical purpose | Plain-language scope | Default state | Allowed basis/readiness | Explicit non-equivalence |
|---|---|---|---|---|
| `service_order_updates` | Receipts and necessary order, payment, dispatch, collection, or delivery support updates | `service_only` for the specific transaction; otherwise `not_requested` | Verified order/contact context and approved service template | Checkout contact is not marketing consent |
| `support_follow_up` | Replies needed to resolve a customer-started support or safety request | `service_only` for the request | Verified support context, bounded retention, approved support template | A support conversation is not campaign consent |
| `warranty_product_care` | Requested warranty guidance, safety notices, and product-care help | `not_requested` | Explicit request or applicable service obligation with product/context proof | Does not authorize offers or unrelated education |
| `product_education` | Optional verification tips, compatibility guidance, and useful product education | `not_requested` | Explicit purpose-and-channel grant | Does not authorize offers, loyalty, or behavioral personalization |
| `marketing_offers_campaigns` | Optional promotions, product drops, dealer news, and campaigns | `not_requested` | Explicit verified opt-in, current suppression check, approved template | Never inferred from checkout, support, account presence, or interest |
| `loyalty_programme_updates` | Future programme launch, terms, and participation updates | `not_requested` | Programme live, separate explicit grant, approved rules | Loyalty participation does not grant Memory Lane or offers |
| `quest_progress_and_badges` | Future quest and badge progress messages | `not_requested` | Live programme, enrolment, separate grant, verified identity | No points, badge, or VIP status may be fabricated |
| `memory_lane_annual_journey` | Future annual journey and history-based reflection | `not_requested` | Explicit separate consent, privacy review, eligible verified history | Loyalty consent does not equal Memory Lane consent |
| `personalised_product_guidance` | Future customer-specific product guidance | `not_requested` | Explainability, fairness, eligible data, explicit separate consent | Product interests or Measurement personalization do not automatically grant messages |
| `utilisation_aware_offers` | Future governed offers informed by approved utilization signals | `not_requested` | Explicit separate consent, margin floors, budget caps, fairness and approved rules | Memory Lane or marketing consent does not automatically authorize it |
| `research_feedback_surveys` | Optional research, feedback, and service-quality surveys | `not_requested` | Explicit grant or narrowly justified post-service request under reviewed policy | Support contact is not standing survey permission |
| `account_security_notifications` | Necessary login, credential, fraud, or account-security alerts | `service_only` for the security event | Verified account/security event and approved security template | Cannot contain campaigns or optional promotions |

## Channel taxonomy

| Channel | Canonical key | Verification expectation | Suppression/withdrawal expectation | Notes |
|---|---|---|---|---|
| Email | `email` | Ownership verification appropriate to risk; verified account email is not itself consent | Provider unsubscribe and hard-bounce suppression checked before optional send | Service and marketing templates must be distinct |
| SMS | `sms` | Verified E.164-compatible phone ownership | STOP and carrier/provider suppression override optional sends | Checkout phone is service context only |
| WhatsApp | `whatsapp` | Verified phone plus approved WhatsApp identity/channel policy | Provider STOP/block/opt-out overrides optional sends | A support click or Channel follow is not a general campaign grant |
| Phone call | `phone_call` | Agent verifies identity and records purpose | Do-not-call request blocks optional calls | Support call context remains purpose-bound |
| In-account | `in_account` | Authenticated account/session | Customer control plus policy; security notices may be service-only | Must not weaken route protection |
| Support-assisted | `support_assisted` | Trained operator verifies requester and authority | Operator records withdrawal or request with receipt | It is a capture source, not a delivery provider |

No future channel should be considered “enabled” globally. Eligibility is calculated for a tuple of subject, verified channel endpoint, purpose, jurisdiction/policy context, and time.

## Consent state model

| State | Meaning | Can authorize optional send? | Valid transitions/notes |
|---|---|---|---|
| `unknown` | Legacy or external evidence exists but cannot be safely interpreted | No | Reconcile or request a new choice |
| `not_requested` | No request has been presented or recorded | No | May move to requested/pending/granted through approved capture |
| `requested_support_assisted` | Customer asked support to help set a preference | No | Requires identity, authority, purpose, and channel confirmation |
| `pending_verification` | Choice captured but channel/identity verification incomplete | No | Grant only after successful verification; expire stale challenges |
| `granted` | Current, verified, purpose-specific affirmative choice | Yes, only if every enforcement gate also passes | May be withdrawn, expired, superseded, or blocked |
| `withdrawn` | Customer or authoritative provider withdrew permission | No | Overrides marketing; a new grant requires a new valid event |
| `expired` | Grant exceeded its approved validity or policy window | No | Requires renewal; never silently extend |
| `superseded` | A newer authoritative event replaced this record | No for the old record | Retain immutable history and pointer to successor |
| `blocked_by_policy` | Internal safety, legal, age, jurisdiction, abuse, capacity, or programme policy blocks use | No | Policy block wins even if a grant exists |
| `service_only` | Contact is allowed only for a bounded transaction, support, warranty, or security need | No for optional communications | Purpose and context ID required; expires/closes with context policy |

Terminal history is immutable. “Current state” is a projection of ordered evidence, never an overwritten audit record. Unknown or conflicting evidence fails closed.

## Source precedence and conflict model

Precedence is evaluated per subject + endpoint + purpose + channel. Higher-priority restrictive evidence wins. A lower-priority source cannot broaden a higher-priority restriction.

1. Legal/policy prohibition, verified abuse/safety block, or channel invalidity produces `blocked_by_policy`.
2. Provider STOP, unsubscribe, block, do-not-call, or authoritative suppression overrides optional marketing.
3. A verified customer withdrawal overrides marketing sends, regardless of older grants.
4. A newer verified purpose-specific choice supersedes an older choice only for the same purpose, channel, endpoint, and subject.
5. An expired grant cannot authorize a send.
6. A support-assisted request remains pending until identity, authority, purpose, and channel are verified.
7. Legacy account flags and imported records remain `unknown` until mapped with evidence; they cannot mint a grant.
8. Checkout phone/email is `service_only` for its order and is not marketing consent.
9. A support conversation is `service_only` for its case and is not campaign consent.
10. Loyalty consent does not equal Memory Lane consent.
11. Memory Lane consent does not equal utilization-aware offer consent.
12. Product Finder interests, browsing, purchase history, silence, pre-ticked boxes, and Measurement consent never create messaging consent.

Conflict examples:

| Evidence A | Evidence B | Effective result |
|---|---|---|
| Older marketing email grant | Provider email unsubscribe | `withdrawn`; optional email blocked |
| Checkout phone | No SMS marketing grant | `service_only`; order SMS only if approved service contract passes |
| Support WhatsApp conversation | Campaign request | No campaign grant; explicit verified opt-in required |
| Loyalty updates granted | Memory Lane not requested | Loyalty purpose only; Memory Lane blocked |
| Memory Lane granted | Utilization-aware offers not requested | Memory Lane only; offers blocked |
| Legacy email=true | New verified marketing withdrawal | `withdrawn`; legacy flag cannot override |
| Measurement personalization granted | Personalized product messages not requested | Measurement destination only; messages blocked |
| Marketing grant current | Margin/policy block | `blocked_by_policy`; send blocked |

## Audit trail requirements

Every capture, verification, import, withdrawal, expiry, supersession, policy block, reconciliation, decision, and provider acknowledgement must be append-only. A future audit event requires:

| Field group | Required fields |
|---|---|
| Identity | Stable pseudonymous subject ID, identity type, account ID only when applicable, verified endpoint reference not plaintext where avoidable |
| Choice | Purpose, channel, endpoint reference, prior state, resulting state, legal/policy basis |
| Source | Source type, surface ID, route/application, provider, campaign/form identifier, actor type and actor ID where authorized |
| Evidence | Exact copy/version, locale, affirmative action, verification method/result/time, service context ID where applicable |
| Time | Event time, received time, effective time, expiry time where applicable, monotonic sequence/version |
| Provenance | Correlation ID, idempotency key, parent/superseded event ID, import batch and legacy source where relevant |
| Policy | Policy version, purpose taxonomy version, retention class, jurisdiction/market, block reason code |
| Delivery decision | Requested message category, template/version, decision result, every gate result, suppression snapshot/reference |
| Provider result | Provider request reference, acceptance/delivery status where enabled, unsubscribe/STOP/bounce event reference |
| Integrity | Immutable event ID, checksum/signature strategy, writer/service version, access/redaction classification |

Audit reads must be access-controlled, redact contact/PII by default, and support a chronological explanation of why a particular message was allowed or blocked. Failed or unavailable audit writing must fail closed for optional sends; queueing an approved audit record is acceptable only under an explicitly reviewed durable-queue contract.

## Provider enforcement contract

No email, SMS, WhatsApp, phone campaign, or other optional customer delivery may be attempted unless a single decision service returns an auditable `allow`. The adapter must prove all of the following immediately before enqueue/send:

1. The exact **purpose is allowed** and active.
2. The **channel consent is current** for the exact endpoint and purpose.
3. The **identity is verified** to the required assurance level.
4. Every **withdrawal is respected**.
5. Internal and provider **suppression is checked**.
6. The **message category matches the purpose**; service templates cannot carry campaigns.
7. The **template is approved where required**, versioned, and appropriate to the channel.
8. An **audit log is written or durably queued** under an approved fail-closed contract.
9. The **provider credential is configured** and accessed only by the authorized delivery boundary.
10. **Provider delivery remains disabled unless explicitly enabled** by a separate reviewed activation.
11. Programme, policy, jurisdiction, frequency, quiet-hours, capacity, budget, fairness, and margin gates pass where applicable.
12. A stable idempotency key prevents duplicate delivery.

The decision response should contain `decisionId`, `allowed`, `reasonCodes`, `subjectRef`, `endpointRef`, `purpose`, `channel`, `stateVersion`, `policyVersion`, `suppressionVersion`, `templateVersion`, `expiresAt`, and `auditEventId`. Raw credentials and unnecessary PII must never appear in the response or logs.

Fail-closed outcomes include missing state, unknown purpose, unverified endpoint, stale grant, conflicting identity, unavailable suppression check, absent template approval, audit failure, disabled provider, and purpose/category mismatch.

## Data model readiness

These are future logical entities, not approved migrations:

| Future entity | Responsibility | Minimum uniqueness/invariant |
|---|---|---|
| `consent_subject` | Stable customer/person reference independent of provider endpoint | No raw provider credential; identity links versioned |
| `channel_endpoint` | Email/phone/account endpoint and verification state | Normalized fingerprint unique per channel/tenant; encrypted/redacted contact handling |
| `consent_event` | Immutable choice/state evidence | Append-only; idempotency key unique per source; purpose and channel required |
| `consent_current_state` | Rebuildable projection | Unique subject + endpoint + channel + purpose; points to winning event |
| `service_contact_context` | Bounded order/support/warranty/security authority | Context ID, purpose, endpoint, start/expiry; never promotes to marketing |
| `suppression_event` | Internal/provider withdrawal, STOP, bounce, block | Append-only; restrictive precedence; provider reference retained |
| `preference_capture_surface` | Versioned wording and UI/source metadata | Stable surface ID + copy/policy version |
| `identity_verification` | Verification challenge and assurance result | Expiring, single-purpose, rate-limited; secrets never stored in audit |
| `consent_decision_receipt` | Immutable allow/deny explanation used by delivery | Decision version/idempotency unique; every gate recorded |
| `provider_delivery_receipt` | Provider acceptance/delivery/failure and feedback | Links decision, template, provider event, suppression feedback |

### Legacy reconciliation mapping

| Legacy source | Initial future interpretation | Automatic grant allowed? | Reconciliation action |
|---|---|---|---|
| `customer_preferences.channels.*` | `unknown` evidence of a broad account setting | No | Ask for purpose-specific verified choice; preserve original audit |
| Legacy analytics/advertising/personalization | Existing Measurement authority only | No for messaging | Keep Measurement mapping; obtain separate communication choice |
| Product Finder interests | Interest/provenance signal | No | Keep outside consent state; apply retention/erase controls |
| Checkout phone/email | `service_only` for order context | No for marketing | Create bounded context; do not import as grant |
| Support contact | `service_only` for ticket/report | No for campaigns | Create bounded context; close/expire by support policy |
| Provider STOP/unsubscribe | `withdrawn` or suppression for matching endpoint/channel/purpose scope | Restrictive only | Import with highest marketing precedence and immutable provider evidence |
| Public `/preferences` visit | No state | No | Do not track or infer a choice |

## API and command readiness

A later approved API should use explicit commands, not a free-form preference blob:

- `RequestConsentChoice(subject, purpose, channel, endpoint, surfaceVersion)`
- `VerifyConsentChoice(challenge, evidence)`
- `WithdrawConsent(subject, purposeScope, channelScope, endpoint, source)`
- `RecordServiceContext(subjectOrGuest, contextType, contextId, purpose, endpoint, expiry)`
- `RecordProviderSuppression(provider, endpoint, eventType, effectiveAt, evidenceRef)`
- `EvaluateDelivery(subject, endpoint, purpose, channel, messageCategory, templateVersion)`
- `GetConsentSummary(subject)` and `GetConsentAudit(subject)` with strict authorization/redaction

Commands require idempotency, optimistic state versioning, explicit actor/source, schema validation, rate limits, CSRF protections where browser-authenticated, and fail-closed authorization. No generic “save preferences” command may silently alter multiple purposes.

## Launch readiness gates

- Legal/privacy review approves purpose wording, lawful/service bases, retention, age/jurisdiction, and rights procedure.
- Security review approves identity linking, verification, encryption, access control, redaction, CSRF/rate limiting, and incident handling.
- Data review approves canonical schema, immutable audit, projection rebuild, migrations, reconciliation, deletion/retention, and rollback.
- Product review approves unbundled copy, accessibility, no pre-ticked options, receipts, error/pending states, and support fallback.
- Provider review proves STOP/unsubscribe/bounce ingestion, suppression freshness, template classification, credential isolation, and disabled-by-default activation.
- Operations review approves agent scripts, manual correction/withdrawal, escalation, audit access, and reconciliation monitoring.
- Test review proves source precedence, identity conflicts, expiry, duplicate requests, provider outages, audit outages, and service/marketing separation.
- Deployment review uses explicit allowlists, backup, rehearsal, checksum verification, smoke tests, and rollback.
- Marketing/provider delivery remains disabled until a separate explicit activation decision.

## Non-implementation declaration

Slice 9-B1 creates evidence and tests only. It does not endorse the legacy account flags as canonical consent, does not alter their behavior, and does not create the future entities or commands above. The next safe step is an implementation design/review slice that selects a minimal canonical boundary and migration strategy without activating sends.
