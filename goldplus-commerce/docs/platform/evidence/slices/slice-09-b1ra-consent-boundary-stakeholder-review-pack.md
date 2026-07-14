# Slice 9-B1RA consent boundary stakeholder review pack

## 1. One-page executive summary

### Decision requested

GoldPlus asks eight accountable stakeholder groups to review the canonical consent boundary approved for design in Slice 9-B1R and decide whether Slice 9-B2 may begin as a **design-only** exercise. Reviewers may approve, approve with conditions, reject, request more information, or mark a genuinely irrelevant item not applicable.

GoldPlus is not asking to save customer preferences yet.

GoldPlus is not asking to send WhatsApp, email or SMS yet.

GoldPlus is not asking to activate loyalty, Memory Lane, personalised offers, utilisation-aware offers or discounts yet.

GoldPlus is asking reviewers to approve the boundary that will guide a future design-only persistence proposal.

### What approval means

Approval means the reviewer accepts the boundary, conditions, ownership, and questions that Slice 9-B2 may explore in documents, threat models, test plans, and rollback plans. It is not permission for schema design in this slice, migrations, live persistence, API mutation, identity matching, provider enforcement, customer communications, programme activation, deployment, or service restart.

### Authorization rule

Slice 9-B2 may proceed as design-only only if all required stakeholders are `approved` or `approved with conditions`, and every blocking question has a named owner and due date. Any `rejected`, `requires more information` without an owned due date, missing required reviewer, or unresolved red-line breach blocks authorization.

### Current recommendation

Convene the cross-functional review. Record decisions rather than infer them. Keep Slice 9-B2 unauthorized until the authorization checklist is complete. Provider delivery and persistence remain disabled regardless of a design-only approval.

## 2. Current state

- Source baseline: `9b92ca001bbbf01ac5dfe5007c131f8dc5157a6e`.
- Slice 9-B Preference Centre is public, static, read-only, and records no choices.
- Slice 9-B1 inventoried 22 surfaces and found no single cross-purpose consent authority.
- Slice 9-B1R approved twelve purposes, six channels, ten states, source precedence, immutable/tamper-evident audit requirements, and fail-closed provider-gate requirements for future design only.
- Legacy account flags persist broad settings but are not canonical purpose consent.
- Measurement consent governs Measurement destinations only; it is not messaging consent.
- No Slice 9-B1RA artifact changes runtime behavior.

## 3. What is being reviewed

Reviewers are deciding whether the 9-B1R boundary is suitable to govern a later design proposal:

1. Service, support, security, education, marketing, loyalty, research, Memory Lane, personalisation, and utilisation-aware purposes remain separate.
2. Channel choice is separate from purpose choice.
3. Identity and endpoint verification precede optional grants.
4. Checkout/order and support contexts remain purpose-limited.
5. Provider STOP, unsubscribe, policy blocks, and verified withdrawal outrank positive local settings.
6. Legacy flags migrate as ambiguous evidence, never automatic grants.
7. Optional delivery requires current purpose/channel consent plus every fail-closed provider gate.
8. Immutable or tamper-evident audit evidence is mandatory before persistence is design-approved.

## 4. What is not being approved

- Database or schema proposals in Slice 9-B1RA
- Migrations, tables, or persistence
- API commands or mutations
- Account or support preference updates
- Customer identity matching
- Provider callback ingestion or enforcement
- Email, SMS, WhatsApp, phone-campaign, push, or other customer sends
- Queue/outbox or External Delivery activation
- Checkout, payment, order, auth, or RBAC changes
- Loyalty ledger, rewards, quests, Memory Lane, personalisation, utilisation-aware offers, discounts, or coupons
- Legal advice, privacy compliance certification, security acceptance, or launch authorization
- Production deployment or service restart

## 5. Why this review exists

Consent becomes operational truth once it is stored or used to permit a message. A technically convenient choice—such as treating a checkout phone number or a broad email toggle as campaign permission—can create customer harm, provider-policy breaches, incomplete withdrawals, misleading preference UX, and an audit record that cannot explain why a message was sent. The review assigns accountable owners before engineering encodes those assumptions.

## 6. Customer-risk framing

The review must prevent:

- avoid treating checkout contact details as marketing consent
- avoid treating support conversations as campaign consent
- avoid treating broad account flags as purpose-specific consent
- avoid treating Measurement consent as messaging consent
- avoid treating loyalty interest as Memory Lane consent
- avoid treating Memory Lane consent as personalised offer consent
- avoid sending messages after withdrawal or provider STOP
- avoid building provider enforcement without audit trail and suppression controls
- avoid confusing a page visit, silence, interest, account membership, or channel availability with affirmative consent
- avoid allowing a manual operator action to bypass identity, role, audit, or suppression controls

## 7. Approved boundary from Slice 9-B1R

The design boundary comprises:

- Twelve distinct purposes: `service_order_updates`, `support_follow_up`, `warranty_product_care`, `product_education`, `marketing_offers_campaigns`, `loyalty_programme_updates`, `quest_progress_and_badges`, `memory_lane_annual_journey`, `personalised_product_guidance`, `utilisation_aware_offers`, `research_feedback_surveys`, and `account_security_notifications`.
- Six channels: WhatsApp, email, SMS, phone, in-account, and support-assisted.
- Ten states: unknown, not requested, requested support-assisted, pending verification, granted, withdrawn, expired, superseded, blocked by policy, and service only.
- A restrictive precedence order led by legal/policy block, provider STOP/unsubscribe, and verified withdrawal.
- Immutable or tamper-evident audit evidence.
- Provider enforcement that fails closed and remains disabled unless separately activated.

This review cannot broaden that boundary. Proposed changes must be logged and returned to boundary review.

## 8. Decisions reviewers must make

Each reviewer must record:

- status: `approved`, `approved with conditions`, `rejected`, `requires more information`, or `not applicable`
- scope approved and scope excluded
- conditions and red lines
- risks accepted and rejected
- evidence reviewed
- blocking questions
- owner and due date for every blocking question
- review expiry date
- effect on Slice 9-B2 design-only authorization

Silence, meeting attendance, or an unsigned draft is not approval.

## 9. Stakeholder-specific review sections

### Legal

Decide service/marketing/personalisation classifications, explicit-opt-in purposes, withdrawal rights, retention limits, copy evidence, privacy/terms updates, separate Memory Lane consent, and utilisation-aware personalised-offer policy.

Red lines: no persistence before purpose classification; no provider enforcement before withdrawal/suppression policy; no Memory Lane before privacy/legal review; no utilisation-aware offers before personalised-offer policy.

### Privacy and data protection

Decide identity assurance, minimisation, copy-version evidence, retention/deletion, support-assisted evidence, STOP/unsubscribe treatment, and data-subject update/removal processes.

Red lines: no persistence without identity verification model; no audit trail without copy version and source surface; no provider suppression without authenticity/freshness handling.

### Security

Decide mutation authentication, admin/support authorization, tamper evidence, callback verification, shared-endpoint and replay protection, audit security, and fraud/abuse controls.

Red lines: no API mutation without auth model; no callback ingestion without signature/freshness checks; no admin override without audit and role controls.

### Product

Decide the first editable preferences, support-assisted-only choices, pending-verification UX, service/marketing/loyalty/personalisation language, inactive-capability copy, and support fallback.

Red lines: no “saved” UX until persistence exists; no broad marketing toggle without purpose clarity; no reward or discount bait as consent capture.

### Operator/support

Decide verification, withdrawal recording, approved scripts, disputes, escalation, SLA, and manual-correction policy.

Red lines: no support-assisted updates before the workflow exists; no manual override without audit trail.

### Provider/channel owner

Decide WhatsApp templates, email unsubscribe, SMS opt-out, STOP capture, suppression enforcement, dry-run evidence, and provider-specific rates/caps.

Red lines: no WhatsApp send without explicit WhatsApp consent and approved template; no SMS marketing without SMS consent and opt-out handling; no email marketing without unsubscribe handling; no provider enforcement before dry-run gate.

### Data owner/analytics

Decide the canonical consent owner, purpose-taxonomy ownership, Measurement/messaging/personalisation separation, PII-safe reporting, conflict reporting, and canonical reporting view.

Red lines: no canonical persistence without an owner; no taxonomy change without versioning; no Measurement consent reuse for messaging consent.

### Business sponsor

Decide whether Slice 9-B2 may proceed as design-only, confirm implementation remains blocked, accept or reject conditions, fund/priority legal-security-operator work, and accept timeline consequences.

Red lines: no acceleration into implementation without legal, privacy, security, operator, provider, and data-owner sign-off; no live customer communications as a shortcut.

## 10. Red lines

The complete red-line register is a separate controlled artifact. The following are universal blockers:

1. Checkout contact is not marketing consent.
2. Support conversation is not campaign consent.
3. Legacy broad flags are not canonical purpose consent.
4. Measurement consent is not messaging consent.
5. Loyalty interest is not Memory Lane consent.
6. Memory Lane consent is not utilisation-aware offer consent.
7. Provider STOP overrides local optional marketing preference.
8. Withdrawal wins over marketing.
9. Unknown intent cannot authorize provider sends.
10. No provider sends before dry-run enforcement.
11. No persistence before identity and audit model.
12. No manual override without audit.

## 11. Open decisions

| Decision area | Required owner | Current status | Required output |
|---|---|---|---|
| Purpose classifications and lawful/service basis | Legal | Not reviewed | Signed decision-log entry with conditions and expiry |
| Identity, minimisation, rights, retention | Privacy/data protection | Not reviewed | Approved requirements and blocking questions |
| Auth, roles, callbacks, tamper evidence | Security | Not reviewed | Threat-model decision and mandatory controls |
| Customer controls, copy, pending/error UX | Product | Not reviewed | Prioritised first-scope decision and prohibited claims |
| Agent verification, withdrawal, disputes, SLA | Operator/support | Not reviewed | Workflow requirements and accountable owner |
| Templates, suppressions, STOP, dry-run | Provider/channel owner | Not reviewed | Channel-specific gate requirements |
| Canonical ownership, versioning, reporting | Data owner/analytics | Not reviewed | Named owner and reporting/reconciliation rules |
| Design-only go/no-go, funding and priority | Business sponsor | Not reviewed | Explicit authorization or rejection |

## 12. Slice 9-B2 authorization criteria

Authorization requires all of the following:

- Every required stakeholder has a valid status.
- Every required stakeholder is `approved` or `approved with conditions`.
- Every condition has an accountable owner, due date, and verification evidence.
- Every blocking question has an owner and due date.
- No red line is waived, contradicted, or unresolved.
- Business sponsor explicitly authorizes design-only work and acknowledges implementation remains blocked.
- The authorized scope is limited to documentation, threat models, interface/schema proposals, test plans, migration plans, and rollback plans defined by Slice 9-B1R.
- No runtime file, migration, API mutation, persistence, provider enforcement, send, deployment, or programme activation is authorized.

## 13. Sign-off sequence

1. Facilitator distributes this pack and evidence at least two working days before review.
2. Data owner validates taxonomy and current-source facts.
3. Legal and privacy review purpose, lawful/service boundaries, rights, and retention.
4. Security reviews identity, authorization, callbacks, audit integrity, and abuse.
5. Product and operator/support align customer and agent workflows.
6. Provider/channel owner confirms channel constraints, STOP/unsubscribe, templates, and dry-run evidence.
7. Data owner records canonical ownership and reconciliation/reporting conditions.
8. Business sponsor reviews all decisions and determines design-only authorization.
9. Facilitator validates owners, due dates, expiry dates, red lines, and checklist completeness.
10. Any later implementation requires a new explicit approval gate.

## 14. How to use the decision log

- Create one entry per material decision; do not combine unrelated purposes or channels.
- Give each entry a stable ID and link the evidence reviewed.
- Record approved and excluded scope equally clearly.
- Convert conditions and questions into named actions with due dates.
- Record expiry/review dates so stale approval cannot silently persist.
- Cross-reference disagreements and superseded decisions rather than deleting them.
- Update the authorization checklist only from completed decision-log entries.
- No real signature is required in this template, but the accountable approver must be identifiable through the approved governance process.

## 15. Appendix: source evidence

- `docs/platform/evidence/slices/slice-09-b1r-canonical-consent-boundary-approval-record.md`
- `docs/platform/evidence/slices/slice-09-b1-consent-source-of-truth-blueprint.md`
- `docs/platform/evidence/slices/slice-09-b1-preference-surface-discovery.md`
- `docs/platform/evidence/slices/slice-09-b-consent-preference-centre-p0.md`
- `docs/platform/evidence/slices/slice-09-b1r-artifact-review.md`

All evidence remains design guidance. Provider delivery remains disabled, no runtime changes are made, and no production deployment occurs in Slice 9-B1RA.
