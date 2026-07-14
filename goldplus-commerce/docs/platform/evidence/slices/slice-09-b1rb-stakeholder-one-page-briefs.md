# Slice 9-B1RB stakeholder one-page briefs

## Shared authority boundary

These briefs support a decision on design-only Slice 9-B2. Approval means the reviewer accepts the boundary and documented conditions for design exploration. Approval does not mean permission to save preferences, propose schema in this slice, mutate APIs, activate providers, send communications, change runtime, or deploy.

### Legal

- **What you are reviewing:** purpose classification, service versus optional contact, withdrawal rights, retention, copy evidence, and separate programme purposes.
- **Decisions you own:** lawful/service boundaries, explicit-choice requirements, policy updates, expiry, and prohibited reuse.
- **Red lines you must protect:** all universal red lines below, especially checkout/support limits and separate Memory Lane/utilisation purposes.
- **Questions to answer:** Which purposes require explicit choice? What retention and withdrawal rules apply? Which copy/policy changes are prerequisites?
- **What approval means:** legal accepts a documented design boundary and conditions for design-only analysis.
- **What approval does not mean:** legal advice completion, compliance certification, persistence, sends, or launch approval.
- **Blockers that stop 9-B2:** unclassified purposes, unresolved withdrawal rules, missing owners/dates, or any red-line conflict.

### Privacy and data protection

- **What you are reviewing:** identity assurance, minimisation, copy/source evidence, retention/deletion, rights, and support-assisted proof.
- **Decisions you own:** required verification, evidence fields, bounded retention, rights workflow, and source precedence.
- **Red lines you must protect:** no persistence before identity/audit and no inferred permission from legacy, Measurement, loyalty, or silence.
- **Questions to answer:** How is endpoint ownership verified? How are shared endpoints handled? What evidence is necessary and for how long?
- **What approval means:** privacy accepts the design questions and mandatory safeguards.
- **What approval does not mean:** DPIA completion, live data collection, persistence, enforcement, or communications.
- **Blockers that stop 9-B2:** unidentified data owner, excessive evidence, unresolved identity/rights, or red-line breach.

### Security

- **What you are reviewing:** future mutation authentication, roles, tamper evidence, callback authenticity/freshness, replay, and manual override.
- **Decisions you own:** assurance levels, least privilege, audit integrity, fail-closed behavior, and threat-model requirements.
- **Red lines you must protect:** no manual override without audit; no persistence without identity/audit; no provider sends before dry-run enforcement.
- **Questions to answer:** Who may change state? How are callbacks verified? How are replay, insider action, and shared endpoints controlled?
- **What approval means:** security accepts the design-only control requirements.
- **What approval does not mean:** auth/RBAC changes, callback ingestion, API mutation, provider activation, or production acceptance.
- **Blockers that stop 9-B2:** missing threat owner, unverifiable identity, mutable evidence, or unowned security questions.

### Product

- **What you are reviewing:** understandable purpose/channel choices, pending verification, truthful inactive states, accessibility, and support fallback.
- **Decisions you own:** first design scope, language principles, excluded claims, and acceptance criteria.
- **Red lines you must protect:** no bundled marketing toggle, false saved state, reward bait, or reuse across loyalty/Memory Lane/utilisation purposes.
- **Questions to answer:** Which choices should be designed first? Which remain support-assisted? What must pending/error copy say?
- **What approval means:** product accepts a narrow, truthful design-only scope.
- **What approval does not mean:** a production UX, saved state, programme activation, or release authorization.
- **Blockers that stop 9-B2:** ambiguous choices, manipulative copy, inaccessible withdrawal, or unresolved ownership.

### Operator/support

- **What you are reviewing:** agent verification, scripts, withdrawal recording, disputes, escalation, corrections, and SLA.
- **Decisions you own:** support-assisted boundaries, evidence, role controls, escalation path, and accountable operating owner.
- **Red lines you must protect:** support conversation is not campaign consent and no manual override without audit.
- **Questions to answer:** How will identity be checked? Who may correct a choice? How are disputes and urgent withdrawals handled?
- **What approval means:** operations accepts the workflow requirements for later design.
- **What approval does not mean:** agent mutation access, live scripts, sends, or a manual bypass.
- **Blockers that stop 9-B2:** no verification path, no escalation owner/SLA, or unaudited override expectations.

### Provider/channel owner

- **What you are reviewing:** STOP/unsubscribe, suppressions, channel-specific consent, templates, callbacks, caps, and dry-run evidence.
- **Decisions you own:** channel constraints, provider precedence, enforcement prerequisites, and activation separation.
- **Red lines you must protect:** provider STOP overrides local optional marketing preference; no sends before dry-run enforcement.
- **Questions to answer:** How is STOP authenticated and synchronized? Which templates/categories require approval? What evidence proves fail-closed delivery?
- **What approval means:** the owner accepts a future dry-run design boundary.
- **What approval does not mean:** credentials, transport changes, provider enforcement, queue activation, or sends.
- **Blockers that stop 9-B2:** missing suppression contract, unverified callback rules, or provider-state precedence gaps.

### Data owner/analytics

- **What you are reviewing:** canonical ownership, taxonomy/version stewardship, source reconciliation, reporting provenance, and PII minimisation.
- **Decisions you own:** named data owner, version/change control, reporting view, conflict visibility, and Measurement separation.
- **Red lines you must protect:** Measurement consent is not messaging consent and legacy broad flags are not canonical purpose consent.
- **Questions to answer:** Who owns each concept? How are conflicts and supersession reported? Which source proves each decision?
- **What approval means:** data governance accepts the ownership and evidence requirements for design.
- **What approval does not mean:** schema design in this slice, migration, canonical storage, analytics activation, or consent inference.
- **Blockers that stop 9-B2:** no named steward, unversioned taxonomy, hidden conflicts, or unclear provenance.

### Business sponsor

- **What you are reviewing:** all stakeholder decisions, residual blockers, ownership, resourcing, dates, and design-only go/no-go.
- **Decisions you own:** whether the checklist authorizes design-only Slice 9-B2 and whether conditions are adequately owned.
- **Red lines you must protect:** every universal red line; deadlines cannot waive safeguards or turn interest into consent.
- **Questions to answer:** Are all required approvals valid? Are conditions funded and dated? Is implementation still explicitly blocked?
- **What approval means:** a narrow authorization for documents, proposals, threat models, test plans, and rollback planning in a later slice.
- **What approval does not mean:** persistence, migration, mutation, provider enforcement, customer communication, activation, runtime change, or deployment.
- **Blockers that stop 9-B2:** any rejection, missing reviewer, unresolved red line, unowned/undated blocker, or absent sponsor decision.

## Universal red lines

- Checkout contact is not marketing consent.
- Support conversation is not campaign consent.
- Legacy broad flags are not canonical purpose consent.
- Measurement consent is not messaging consent.
- Loyalty interest is not Memory Lane consent.
- Memory Lane consent is not utilisation-aware offer consent.
- Provider STOP overrides local optional marketing preference.
- Withdrawal wins over marketing.
- Unknown intent cannot authorize provider sends.
- No provider sends before dry-run enforcement.
- No persistence before identity and audit model.
- No manual override without audit.
