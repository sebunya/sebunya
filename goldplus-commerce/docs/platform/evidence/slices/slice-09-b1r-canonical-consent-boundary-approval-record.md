# Slice 9-B1R canonical consent boundary approval record

## Record control

- Decision baseline: `c67ec7df6db3ccaf8bd33bf00a63da539221d39a`
- Source records reviewed: `slice-09-b1-preference-surface-discovery.md`, `slice-09-b1-consent-source-of-truth-blueprint.md`, `slice-09-b1-artifact-review.md`, `slice-09-b-consent-preference-centre-p0.md`, and `slice-09-b-consent-preference-centre-baseline.md`
- Approval type: architecture and design-boundary approval only
- Runtime authority granted: none
- Persistence authority granted: none
- Provider or customer-communication authority granted: none

## Executive decision

GoldPlus approves the Slice 9-B1 purpose, channel, state, precedence, audit, and fail-closed enforcement boundaries as the mandatory design contract for Slice 9-B2. This approval permits proposals and review artifacts only. It does not constitute legal advice, privacy approval, security approval, business launch approval, migration approval, persistence approval, provider activation, or permission to contact a customer.

The canonical unit is a verified subject + verified endpoint + channel + purpose + current state + source evidence + policy version. An account, contact detail, order, support conversation, interest, page visit, Measurement choice, general channel flag, or provider capability is never sufficient by itself.

### Approved boundary

- The twelve purposes and six channels below are approved as distinct future design dimensions.
- The ten consent states and ten-level source precedence order below are approved for future design.
- `service_only` is bounded to a specific necessary order, support, warranty/product-care, or security context; it cannot broaden into optional communications.
- Optional marketing, loyalty, quest, Memory Lane, personalisation, utilisation-aware offers, education, and research require purpose-specific, channel-specific, current, verified consent.
- Future audit must be immutable or tamper-evident and capable of explaining every state and delivery decision.
- Provider enforcement must fail closed and remain disabled until separately approved.

### Not-approved boundary

- No database table, migration, API mutation, live save, browser persistence, customer identity matching, provider enforcement, provider send, customer communication, or production deployment is approved.
- No existing legacy flag or contact record is approved as canonical marketing consent.
- No legal basis, retention period, age/jurisdiction rule, provider template, or programme activation is approved by this engineering record.
- No loyalty ledger, Memory Lane, personalisation, utilisation-aware pricing/offer, discount, coupon, checkout, payment, auth, or RBAC change is approved.

## Purpose approval matrix

All rows are explicitly **approved for future design only**. Persistence is not approved until the row's legal, security, product, and business conditions are signed off. Provider enforcement is prohibited now.

| Purpose | Classification | Approval status | Allowed channels for future design | Required identity level | Consent requirement | Withdrawal rule | Audit requirement | Provider enforcement status |
|---|---|---|---|---|---|---|---|---|
| `service_order_updates` | service | Approved for future design only; persistence blocked pending legal/security review | whatsapp, email, sms, phone, in_account, support_assisted | checkout contact only for the bounded order; verified account when account-linked | Not required only for strict service necessity; optional content prohibited | Service-limited exception; legal/policy block overrides; STOP blocks optional content but cannot erase a narrowly required legal/service notice | Copy version, source surface, actor, timestamp, previous/new state, order context, provider callback reference where applicable | Prohibited now; future dry-run only after design approval |
| `support_follow_up` | support | Approved for future design only; persistence blocked pending legal/security review | whatsapp, email, sms, phone, in_account, support_assisted | verified support-assisted or verified account | Not required only for customer-requested, case-bound follow-up; campaign content needs separate opt-in | Withdrawable/closable for follow-up; service-limited exception; legal/policy block overrides | Copy version, source surface, actor, timestamp, previous/new state, support ticket reference, callback reference | Prohibited now; future dry-run only after design approval |
| `warranty_product_care` | product education | Approved for future design only; persistence blocked pending legal/security/product policy | whatsapp, email, sms, phone, in_account, support_assisted | verified account or verified support-assisted; checkout contact only when tied to a valid service case | Verified preference required for optional care education; strict safety/warranty response remains service-limited | Withdrawable for optional education; legal/safety exception is purpose-limited; provider STOP overrides optional delivery | Copy version, source surface, actor, timestamp, previous/new state, product/case context, callback reference | Prohibited now; future dry-run only after legal/product approval |
| `product_education` | product education | Approved for future design only; not approved for persistence yet | whatsapp, email, sms, in_account, support_assisted | verified account, verified support-assisted, or provider-callback-verified endpoint | Explicit opt-in required for each channel | Withdrawable; provider STOP and legal/policy block override | Copy version, source surface, actor, timestamp, previous/new state, callback reference | Prohibited now; future dry-run only after approval |
| `marketing_offers_campaigns` | marketing | Approved for future design only; blocked pending legal/privacy, security, template, suppression, and business policy | whatsapp, email, sms, phone, in_account | verified account, provider callback verified, or verified support-assisted with endpoint verification | Separate purpose-specific explicit opt-in required per channel | Withdrawable immediately; provider STOP overrides; legal/policy block overrides | Copy version, source surface, actor, timestamp, previous/new state, campaign purpose, callback/suppression reference | Prohibited now; future dry-run only; live gate requires separate activation approval |
| `loyalty_programme_updates` | loyalty | Approved for future design only; blocked until programme and legal terms exist | whatsapp, email, sms, in_account, support_assisted | verified account or verified support-assisted | Separate purpose-specific consent required | Withdrawable; provider STOP and legal/policy block override; withdrawal does not silently cancel contractual rights | Copy version, source surface, actor, timestamp, previous/new state, programme version, callback reference | Prohibited now; future dry-run only after programme approval |
| `quest_progress_and_badges` | loyalty | Approved for future design only; blocked until programme, ledger, fairness, and policy approval | whatsapp, email, in_account | verified account | Separate purpose-specific consent required in addition to programme participation | Withdrawable; provider STOP and policy block override optional updates | Copy version, source surface, actor, timestamp, previous/new state, programme/quest version | Prohibited now; future dry-run only after programme approval |
| `memory_lane_annual_journey` | personalisation | Approved for future design only; blocked pending privacy, history eligibility, retention, and fairness review | email, in_account, support_assisted | verified account | Separate purpose-specific consent required; loyalty consent is insufficient | Withdrawable; policy block overrides; withdrawal stops future optional processing/delivery under approved retention rules | Copy version, source surface, actor, timestamp, previous/new state, eligibility/policy version | Prohibited now; future dry-run only after separate Memory Lane approval |
| `personalised_product_guidance` | personalisation | Approved for future design only; blocked pending explainability, data, fairness, and legal review | whatsapp, email, in_account, support_assisted | verified account | Separate purpose-specific consent required; interests and Measurement consent are insufficient | Withdrawable; provider STOP and legal/policy block override | Copy version, source surface, actor, timestamp, previous/new state, model/rule and explanation version | Prohibited now; future dry-run only after separate personalisation approval |
| `utilisation_aware_offers` | personalisation | Approved for future design only; blocked pending consent, fairness, margin, budget, capacity, and pricing policy | whatsapp, email, sms, in_account | verified account | Separate purpose-specific consent required; Memory Lane or marketing consent is insufficient | Withdrawable; provider STOP, margin floor, budget/capacity, and legal/policy blocks override | Copy version, source surface, actor, timestamp, previous/new state, rule, margin/budget, and offer-policy versions | Prohibited now; future dry-run only; no price/discount application authorized |
| `research_feedback_surveys` | research | Approved for future design only; blocked pending research purpose, sampling, retention, and legal review | whatsapp, email, sms, phone, in_account, support_assisted | verified account, verified support-assisted, or provider-callback-verified endpoint | Explicit opt-in required unless a narrowly reviewed service-feedback exception is approved later | Withdrawable; provider STOP and legal/policy block override | Copy version, source surface, actor, timestamp, previous/new state, study version, callback reference | Prohibited now; future dry-run only after research approval |
| `account_security_notifications` | security | Approved for future design only; persistence blocked pending security/legal review | whatsapp, email, sms, phone, in_account, support_assisted | verified account; admin/operator confirmed only for documented recovery; provider callback verified where applicable | Not required only for strict account-security necessity | Service-limited exception; channel invalidity and legal/policy blocks override; optional content forbidden | Copy version, source surface, actor, timestamp, previous/new state, security-event context, callback reference | Prohibited now; future dry-run only after security approval |

## Channel approval matrix

| Channel | Approved future use cases | Not-approved use cases | Template/approval requirements | Provider dependency | STOP/unsubscribe handling | Identity requirement | Audit requirement | Future enforcement gate | Current activation status |
|---|---|---|---|---|---|---|---|---|---|
| `whatsapp` | Bounded service/support and separately consented education, marketing, loyalty, research, or future programme messages | Any inferred, bundled, or unverified marketing; support click treated as campaign consent | Approved purpose-classified WhatsApp template where required; WhatsApp marketing requires explicit WhatsApp consent and approved template | Approved WhatsApp provider, configured credential, disabled-by-default transport | Provider STOP/block/opt-out overrides local optional marketing preference | Verified endpoint and subject; checkout number is order-service only | Full consent event, template version, decision receipt, provider callback | All provider gates below plus channel-specific suppression freshness | Disabled; no send authorized |
| `email` | Bounded service/support and separately consented optional communications | Checkout email, account email, newsletter interest, or legacy flag treated as marketing consent | Service/marketing separation; approved versioned template; email marketing requires email consent and unsubscribe handling | Approved email provider and isolated credential | Unsubscribe, hard bounce, complaint, and suppression override optional delivery | Verified email endpoint for optional use | Full consent event, copy/template version, decision and callback receipts | All provider gates below; unsubscribe check required | Disabled for consent-authorized sending; no send authorized by this record |
| `sms` | Bounded necessary service/support and separately consented optional communications | Checkout phone, support phone, or broad SMS flag treated as marketing consent | Short, purpose-specific approved template; SMS marketing requires explicit SMS consent and opt-out handling | Approved SMS provider and isolated credential | STOP/carrier/provider suppression overrides optional delivery | Verified phone endpoint for optional use | Full consent event, template version, decision and callback receipts | All provider gates below; STOP check required | Disabled; no send authorized |
| `phone` | Customer-requested support, warranty/product-care, security recovery, and separately approved research/marketing calls | Phone support follow-up treated as campaign consent; unverified campaign calls | Approved agent script, purpose disclosure, do-not-call and escalation policy | Trained operator or separately approved calling provider | Do-not-call and withdrawal override optional calls | Verified support-assisted or verified account; operator confirmation recorded | Actor, script/copy version, purpose, verification, outcome, withdrawal | Operator access, identity, purpose, do-not-call, audit, and policy gates | Support contact remains case-bound; campaigns disabled |
| `in_account` | Authenticated service/security notices and separately consented future programme guidance | Using authentication as automatic consent; weakening admin/account route protection | Approved accessible copy and purpose classification | No external provider required, but authenticated delivery boundary required | Customer withdrawal controls optional content; policy block applies | Verified account and valid session | Copy version, purpose, state/decision, display/dismissal policy | Authentication, purpose, state, audit, frequency, and policy gates | No new capability authorized |
| `support_assisted` | Capture a request, explain choices, verify identity, and record a future reviewed update | Treated as a delivery provider, automatic grant, or provider enforcement | Approved operator script, role/access policy, confirmation receipt | Human support workflow; provider only if a later message is sent | Agent must record withdrawal and check provider suppressions; cannot override STOP | Verified support-assisted; admin/operator confirmed with least privilege | Actor ID, case reference, script/copy version, evidence, previous/new state | RBAC, verification, purpose, dual-control where required, immutable audit | Request source only; no update or send authorized now |

## Legacy surface reconciliation decisions

| Surface class | Future role | Slice 9-B2 design | Slice 9-B2 implementation | Copy risk | Identity risk | Migration risk | Required next action |
|---|---|---|---|---|---|---|---|
| Public `/preferences` | Canonical entry-point candidate and current non-authoritative guidance | Yes | No | Low | Low today; high once personalized | Low | Design verified capture, explicit purpose/channel copy, receipts, errors, withdrawal, and accessibility; retain no-save truth until implemented |
| `/consent` alias | Deprecated/duplicate-state prevention; stable redirect only | Yes | No | Low | Low | Low | Preserve one canonical route and no duplicate state |
| Legacy authenticated account preferences | Legacy input to migrate and account-bound preference candidate | Yes | No | High | Medium | High | Decompose broad channel flags by purpose; map existing values to `unknown`, never automatic grant; preserve audit evidence |
| Newsletter/footer interest area | Non-authoritative guidance and future acquisition candidate | Yes | No | Low | High if activated | Medium | Design explicit email purpose choice, verification, unsubscribe, suppression, receipt, and copy versioning |
| Checkout contact collection | Service-contact only | Yes | No | Medium | High | High | Keep order context and `service_only`; checkout contact is service-only and cannot broaden into marketing |
| Support contact/follow-up path | Support-assisted request source and support-follow-up only | Yes | No | Low | Medium | Medium | Support conversation is support-follow-up only; design verification, bounded context, operator script, withdrawal, and audit |
| Privacy/terms preference language | Non-authoritative guidance | Yes | No | Medium | Low | Low | Legal review, versioning, rights/withdrawal procedure, retention, and canonical-centre linkage |
| Measurement consent references | Measurement-only consent dependency | Yes | No | Medium | Medium | High | Measurement consent is not messaging consent; define explicit mapping boundary and prohibit equivalence |
| External Delivery/provider references | Provider suppression dependency only | Yes | No | Medium | High | High | Design callback normalization, suppression freshness, decision receipts, credential isolation, and disabled-by-default dry-run |
| Loyalty readiness references | Non-authoritative guidance | Yes | No | Medium | Medium | Medium | Loyalty consent is not Memory Lane consent; design separate programme purpose and terms only |
| Memory Lane readiness references | Non-authoritative guidance | Yes | No | Medium | High | High | Require separate explicit consent, eligible history, privacy/retention/fairness review |
| Personalisation/utilisation-aware readiness | Non-authoritative guidance | Yes | No | High | High | High | Memory Lane consent is not utilisation-aware offer consent; separate purposes, data boundaries, explainability, fairness, margin and budget controls |
| Admin readiness evidence | Evidence-only and future protected operator review candidate | Yes | No | Low | High | Medium | Preserve deny-by-default routes; design redaction, roles, no-mutation preview, provenance, and dual control |
| Tests and evidence | Evidence only | Yes | No | Low | Low | Low | Expand contracts before implementation; preserve no-runtime-change and fail-closed assertions |

## Approved source precedence

The future current-state projection must apply this order, from strongest to weakest. A restrictive higher source cannot be broadened by a lower source.

1. **Legal/policy block**
2. **Provider STOP or unsubscribe callback**
3. **Verified withdrawal**
4. **Verified customer account preference**
5. **Verified support-assisted update**
6. **Audited Preference Centre submission**
7. **Service communication necessity from checkout/order**
8. **Legacy newsletter interest**
9. **Marketing campaign import**
10. **Unknown or implicit intent**

Withdrawal wins over marketing. Provider STOP wins over local marketing preference for that channel. Service messages must stay purpose-limited. Checkout contact cannot broaden into marketing. Support contact cannot broaden into campaigns. Legacy newsletter interest cannot override withdrawal. Legacy account channel flags require purpose decomposition. Unknown intent cannot authorize provider sends.

Account, support, and Preference Centre sources are authoritative only after the future identity, endpoint, purpose, channel, copy-version, and audit requirements pass. Campaign imports can never mint consent. Conflicts and unavailable precedence dependencies fail closed.

## Approved consent states

| State | Plain meaning | Future creator | Provider enforcement use | Marketing use | Audit required | Verification | Terminal/reversible |
|---|---|---|---|---|---|---|---|
| `unknown` | Evidence is absent, ambiguous, conflicting, or unsafe to interpret | Import/reconciliation process or fail-closed projection | Deny only | No | Yes when derived or reconciled | Required before any grant | Reversible through a new verified event |
| `not_requested` | No approved choice was requested or recorded | Initial projection | Deny only | No | Projection provenance required | Required for later grant | Reversible |
| `requested_support_assisted` | Customer asked support to help but authority is not verified | Future trained support workflow | Deny only | No | Yes | Required | Reversible; expires or advances |
| `pending_verification` | Choice captured but subject or endpoint verification is incomplete | Future approved capture surface | Deny only | No | Yes | Required | Reversible; expires, grants, or withdraws |
| `granted` | Current affirmative purpose-and-channel choice from a verified source | Future verified account, support-assisted, Preference Centre, or provider-confirmed flow | May allow only after every other gate passes | Yes only for the exact optional purpose/channel and current version | Yes | Already verified and periodically revalidated | Reversible by withdrawal; expirable/supersedable/blockable |
| `withdrawn` | Customer or authoritative provider revoked optional permission | Future customer, verified agent, or provider callback | Deny | No | Yes | Source authenticity required | Restrictive current state; reversible only through a new valid grant |
| `expired` | Former grant exceeded its approved validity | Policy/expiry processor | Deny | No | Yes | Renewal requires verification | Reversible only through a new valid grant |
| `superseded` | A newer authoritative event replaced this historical event | State projector | Historical evidence only; deny if no current successor | No by itself | Yes | Successor determines | Historical/terminal event, projection remains reversible |
| `blocked_by_policy` | Legal, safety, jurisdiction, abuse, capacity, fairness, margin, or other approved policy blocks use | Authorized policy control | Deny | No | Yes | Control authorization required | Reversible only by an authorized policy event |
| `service_only` | Contact may be used only for a bounded necessary service context | Future order, support, warranty, or security context adapter | May allow only an approved necessary service message | No | Yes | Context and endpoint assurance required | Expires/closes with context; never promotes to marketing |

Only `granted`, purpose-specific, channel-specific, verified, current consent may contribute to a future optional marketing or personalisation allow decision, and it still cannot bypass suppression, policy, template, audit, or explicit provider activation gates.

## Approved audit requirements

No future persistence design is approved unless it includes immutable or tamper-evident audit events. At minimum every applicable event and decision must record:

- `consent_event_id`
- `customer_id` or verified identity reference
- `purpose`
- `channel`
- `state`
- `source_surface`
- `actor_type`
- `actor_id` if internal
- `timestamp`
- `copy_version_shown`
- an approved IP/user-agent handling policy that minimizes and protects data
- `previous_state`
- `new_state`
- `reason`
- `support_ticket_reference` when applicable
- `provider_callback_reference` when applicable
- `correlation_id`
- `retention_policy`
- integrity/hash-chain or equivalent immutable-log approach

Audit reads must be access-controlled, redacted by default, purpose-limited, and able to reconstruct the winning precedence event. Audit write or durable approved queue failure blocks optional delivery. Raw credentials and unnecessary PII are forbidden in audit records.

## Approved provider enforcement gate — design only

A future delivery decision must fail closed unless all of the following pass:

1. Purpose allowed.
2. Channel allowed.
3. Channel consent current for the exact purpose and endpoint.
4. Identity verified to the required assurance level.
5. Withdrawal respected.
6. Internal and provider suppression checked.
7. Message category matches purpose; service templates contain no campaign content.
8. Template approved where required.
9. Customer copy version compatible with the policy and requested message.
10. Support exception policy passes for a necessary service communication.
11. Rate, frequency, quiet-hours, budget, margin, fairness, and capacity caps pass where applicable.
12. Audit log written or durably queued under an approved fail-closed contract.
13. Provider credential configured and isolated.
14. Provider delivery explicitly enabled by a separate reviewed activation.

Provider enforcement remains disabled. No WhatsApp, email, SMS, phone campaign, provider send, or customer communication is authorized by Slice 9-B1R. A dry-run design may return an allow/deny explanation but may not enqueue, call a provider, mutate consent, or contact a customer.

## Slice 9-B2 permission boundary

Slice 9-B2 may design, document, threat-model, and test proposals for:

- database schema proposal
- API command proposal
- identity verification approach
- audit trail design
- consent copy versioning design
- source precedence implementation plan
- migration plan for legacy account flags
- provider enforcement dry-run interface design
- admin review workflow design
- support-assisted update workflow design
- test plan
- rollback plan

Slice 9-B2 must remain design-only. It must not implement:

- migrations
- live persistence
- API mutation
- provider sends
- provider enforcement
- customer communications
- loyalty activation
- Memory Lane activation
- personalisation activation
- discount or coupon activation
- checkout mutation
- auth/RBAC rewrite

It also may not edit runtime files, deploy, restart services, activate queues/outbox, import customer data, expose secrets, or declare legal/security approval. Any expansion requires a new explicit authorization.

## Open review items and mandatory checklists

### Legal/privacy review — pending

- [ ] Approve plain-language purpose copy and service-versus-optional classification.
- [ ] Approve lawful/service basis, consent validity/expiry, withdrawal timing, and evidence standard.
- [ ] Approve retention/deletion, data-subject rights, children/age, jurisdiction, and cross-border rules.
- [ ] Approve separate loyalty, Memory Lane, personalisation, utilisation-aware offer, and research boundaries.
- [ ] Approve provider terms, template categories, STOP/unsubscribe semantics, and privacy/terms versions.

### Security review — pending

- [ ] Approve subject/endpoint identity model, assurance levels, account linking, guest handling, and recovery.
- [ ] Approve encryption, hashing/tokenization, key isolation, redaction, access control, and least privilege.
- [ ] Approve CSRF, replay/idempotency, rate limiting, abuse controls, callback authentication, and incident response.
- [ ] Approve immutable/tamper-evident audit design, monitoring, backup, recovery, retention, and deletion boundaries.
- [ ] Threat-model account takeover, shared phones/emails, forged callbacks, stale suppressions, insider abuse, and race conditions.

### Product/operator/business sign-off — pending

- [ ] Business owner approves every purpose, channel, service exception, default, and launch sequence.
- [ ] Product and accessibility owners approve unbundled copy, no pre-ticked consent, pending/error states, receipts, and withdrawal UX.
- [ ] Support owner approves identity script, authority limits, correction/withdrawal workflow, escalation, and training.
- [ ] Provider owner approves templates, suppressions, dry-run evidence, credentials, caps, monitoring, and disabled-by-default posture.
- [ ] Data owner approves legacy mapping to `unknown`, reconciliation evidence, no automatic grant, and rollback.
- [ ] Release owner confirms gates, allowlists, rehearsal, backup, smoke, rollback, and separate activation decision.

No unchecked item blocks this documentation-only gate; every unchecked item blocks relevant persistence, migration, enforcement, or activation work.

## Risk register

| Risk | Severity | Approval response | Residual status |
|---|---|---|---|
| Legacy channel flags are grandfathered as marketing consent | Critical | Mandatory purpose decomposition; initial interpretation `unknown`; no automatic grant | Blocked pending migration design/review |
| Checkout or support contact broadens into campaigns | Critical | `service_only` and support-follow-up-only decisions | Must be enforced and tested in future design |
| Provider STOP loses to internal preference | Critical | Provider callback precedence above local preferences; suppression gate required | Callback authenticity/freshness design pending |
| Measurement consent becomes messaging consent | Critical | Explicit non-equivalence | Mapping boundary design pending |
| Distinct future programmes are bundled | High | Separate loyalty, quest, Memory Lane, personalisation, and utilisation purposes | Legal/product review pending |
| Unverified or shared endpoint grants another person's preference | High | Endpoint/subject verification and pending state required | Identity design pending |
| Audit cannot explain an allow decision | High | Immutable/tamper-evident event and decision receipt required | Data/security design pending |
| Service exception carries marketing content | High | Category/purpose/template gate and approved service exception policy | Template governance pending |
| Provider dependency fails open | Critical | Unknown/unavailable suppression, audit, credential, or policy denies delivery | Dry-run contract and outage tests pending |
| Engineering record is mistaken for legal approval | High | Explicit design-only scope and pending checklists | Requires disciplined governance |

## Approval outcome

The canonical consent boundary is approved for Slice 9-B2 design only. Persistence, migrations, API mutation, provider enforcement, provider sends, customer communications, and programme activation remain unapproved. The next permitted action is a separate evidence-only Slice 9-B2 design proposal that stays within the permission boundary above.
