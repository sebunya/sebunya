# Slice 9-B2 implementation readiness checklist

## Use and status rule

This checklist governs future implementation slices; it does not authorize implementation. `pending specialist approval` is blocking. Sponsor approval is limited to Slice 9-B2 design-only and cannot close specialist items. Every closure requires attributable evidence, owner, date, scope, conditions, and any condition owner/due date.

| Area | Readiness item | Status | Owner | Required evidence | Blocks future slice |
|---|---|---|---|---|---|
| Legal | Approve purpose classifications and service-necessity boundaries | pending specialist approval | Formal legal reviewer to be assigned by Robert Sebunya | Signed purpose matrix with legal basis, jurisdiction and exception limits | 9-B3, 9-B4, 9-B7, 9-B8 |
| Legal | Approve withdrawal rights, policy blocks, terms/privacy copy and retention | pending specialist approval | Formal legal reviewer to be assigned | Decision record and reviewed copy/retention schedule | 9-B3 onward |
| Privacy/data protection | Approve subject/endpoint identity assurance and shared-contact handling | pending specialist approval | Privacy reviewer to be assigned | Threat/privacy assessment and assurance matrix | 9-B3, 9-B4, 9-B5, 9-B7 |
| Privacy/data protection | Approve minimisation, retention/deletion, copy evidence and callback payload handling | pending specialist approval | Privacy reviewer to be assigned | Data inventory, retention schedule, deletion/rights flow and callback minimisation | 9-B3 onward |
| Security | Approve mutation authentication/authorization without auth/RBAC rewrite | pending specialist approval | Security reviewer to be assigned | Threat model, endpoint/command authz matrix and negative tests | 9-B4, 9-B5, 9-B7 |
| Security | Approve tamper evidence, callback verification, replay controls, encryption/redaction and dual control | pending specialist approval | Security reviewer to be assigned | Cryptographic design, callback profiles, abuse cases and key/access design | 9-B3, 9-B5, 9-B6, 9-B8 |
| Product | Approve unbundled purpose/channel copy and truthful pending/saved/withdrawn states | pending specialist approval | Robert Sebunya / delegated product reviewer | Versioned copy set, accessibility review and state/error journey | 9-B4, 9-B7 |
| Product | Confirm loyalty, Memory Lane, personalisation, utilisation offers and incentives remain inactive | pending specialist approval | Robert Sebunya | Signed non-activation boundary and regression evidence | 9-B3 through 9-B8 |
| Operator/support | Approve identity script, agent scope, SLA, dispute/escalation and manual-correction controls | pending specialist approval | Operator/support reviewer to be assigned | Reviewed scripts, training, role matrix, SLA and escalation runbook | 9-B5, 9-B7 |
| Provider/channel | Approve provider callback authenticity, STOP/unsubscribe scope and freshness SLA | pending specialist approval | Provider/channel reviewer to be assigned | Provider-specific callback contracts and replay/idempotency evidence | 9-B3, 9-B6, 9-B8 |
| Provider/channel | Approve WhatsApp templates, email unsubscribe/complaint/bounce, SMS opt-out and suppression behavior | pending specialist approval | Provider/channel reviewer to be assigned | Template/category decisions and channel suppression test plan | 9-B6, 9-B8 |
| Data-owner/analytics | Name canonical consent steward and approve taxonomy/version ownership | pending specialist approval | Data owner/analytics reviewer to be assigned | Operating model, RACI, taxonomy change control | 9-B3 onward |
| Data-owner/analytics | Approve reconciliation, legacy mappings, reporting boundaries and Measurement separation | pending specialist approval | Data owner/analytics reviewer to be assigned | Field inventory, versioned mapping, dry-run report and reporting specification | 9-B3, 9-B6, 9-B7 |
| Business sponsor | Authorize Slice 9-B2 design proposals only | sponsor-approved for design-only | Robert Sebunya | Slice 9-B1RC decision input and authorization assessment dated 2026-07-15 | Closed for 9-B2 only; does not unblock implementation |
| Business sponsor | Authorize each implementation/deployment slice after specialist closure | pending specialist approval | Robert Sebunya | Completed checklist, residual-risk decision, scope and rollback authorization | 9-B3 through 9-B8 |
| Engineering | Produce reviewed ADRs, migration plan, command contracts, ownership and capacity estimate | pending specialist approval | Engineering lead to be assigned | Approved ADR set, dependency map and delivery plan | 9-B3, 9-B4 |
| Engineering | Prove event/projection atomicity, idempotency, concurrency, recovery and zero-send isolation | pending specialist approval | Engineering lead to be assigned | Test results, failure injection and recovery rehearsal | 9-B3, 9-B4, 9-B6 |
| QA | Approve domain, migration, command, callback, workflow, accessibility and dry-run test plans | pending specialist approval | QA lead to be assigned | Traceability matrix covering every red line and failure mode | 9-B3 through 9-B8 |
| QA | Complete UAT with no provider sends and no production data leakage | pending specialist approval | QA lead to be assigned | Signed UAT evidence, defects resolved and no-send proof | 9-B7, 9-B8 |
| Release management | Approve environment, backup/restore, monitoring, feature-disable and rollback plans | pending specialist approval | Release manager to be assigned | Deployment checklist, rollback drill, observability and incident runbook | 9-B3 through 9-B8 |
| Release management | Verify separate live-readiness gate and explicit activation authority | pending specialist approval | Release manager + business sponsor | 9-B8 gate record proving dry-run, suppression freshness and canary/rollback readiness | Any later live activation slice |

## Non-waivable readiness checks

- Checkout contact is not marketing consent; support conversation is not campaign consent.
- Legacy broad flags, Measurement consent, loyalty interest, Memory Lane consent, and unknown intent cannot be repurposed into broader authority.
- Provider STOP/unsubscribe and verified withdrawal remain restrictive authorities.
- No persistence before approved identity and immutable/tamper-evident audit.
- No manual override without role, reason, evidence and audit.
- No provider sends before reviewed dry-run enforcement and a separate explicit live gate.

## Current conclusion

Slice 9-B2 design evidence is ready for review. All implementation slices remain blocked by pending specialist approvals and their engineering/QA/release evidence. No checklist item authorizes persistence, API mutation, preference saving, provider enforcement, customer communication, deployment, or service restart.
