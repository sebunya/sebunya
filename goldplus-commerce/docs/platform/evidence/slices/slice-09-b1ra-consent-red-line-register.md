# Slice 9-B1RA consent red-line register

## Authority

These red lines protect the Slice 9-B1R boundary at `9b92ca001bbbf01ac5dfe5007c131f8dc5157a6e`. They are mandatory restrictions, not optional conditions. A breach blocks Slice 9-B2 design-only authorization until resolved through an explicit boundary review. No runtime change is authorized. They do not authorize persistence, provider delivery, customer communication, or deployment. Provider delivery remains disabled.

## Register

| ID | Domain | Red line | Harm prevented | Accountable reviewer | Evidence required to close concern | Consequence of breach |
|---|---|---|---|---|---|---|
| RL-CC-01 | Customer consent | Checkout contact is not marketing consent | Campaign use of transaction-required contact without a choice | Legal + privacy + product | Purpose-limited service classification and tests | Block authorization |
| RL-CC-02 | Customer consent | Support conversation is not campaign consent | Reusing help requests for promotions | Legal + operator/support | Support-follow-up-only workflow boundary | Block authorization |
| RL-CC-03 | Customer consent | Legacy broad flags are not canonical purpose consent | Grandfathering mixed channel booleans as grants | Data owner + privacy | Purpose decomposition plan; ambiguous values remain `unknown` | Block authorization |
| RL-CC-04 | Customer consent | Unknown intent cannot authorize provider sends | Sending based on silence, page visits, interest or ambiguity | Privacy + provider/channel | Fail-closed decision rules and negative tests | Block authorization |
| RL-CC-05 | Customer consent | Withdrawal wins over marketing | Contact after a verified customer revocation | Legal + privacy | Precedence decision and withdrawal test plan | Block authorization |
| RL-PR-01 | Privacy | Measurement consent is not messaging consent | Reusing analytics/ad choices for customer messages | Privacy + data owner | Explicit taxonomy/source separation | Block authorization |
| RL-PR-02 | Privacy | Loyalty interest is not Memory Lane consent | Using programme interest for history-based processing | Legal + privacy + product | Separate purpose and copy decision | Block authorization |
| RL-PR-03 | Privacy | Memory Lane consent is not utilisation-aware offer consent | Reusing annual-journey consent for personalised offers | Legal + privacy + product | Separate purpose, policy and fairness decision | Block authorization |
| RL-PR-04 | Privacy | No persistence before identity and audit model | Saving choices without knowing whose choice or how it was evidenced | Privacy + security + data owner | Approved identity assurance and immutable/tamper-evident audit design | Block authorization and later persistence |
| RL-PR-05 | Privacy | No audit trail without copy version and source surface | Inability to prove what was shown or where choice arose | Privacy + data owner | Required audit fields and versioning controls | Block authorization |
| RL-SE-01 | Security | No API mutation without authentication and authorization model | Forged or unauthorized consent changes | Security | Threat model and auth/RBAC design requirements | Block authorization |
| RL-SE-02 | Security | No provider callback ingestion without signature and freshness checks | Forged STOP/grant, replay and stale state | Security + provider/channel | Callback authentication, replay/idempotency and freshness plan | Block authorization |
| RL-SE-03 | Security | No manual override without audit | Insider or agent bypass of customer choice | Security + operator/support | Role controls, actor evidence, reason, prior/new state and immutable event | Block authorization |
| RL-SE-04 | Security | No raw provider credentials or unnecessary PII in decision/audit evidence | Credential compromise and privacy leakage | Security + data owner | Redaction, isolation and access-control requirements | Block authorization |
| RL-PC-01 | Provider/channel | Provider STOP overrides local optional marketing preference | Post-STOP messages caused by stale internal state | Provider/channel + privacy | Callback/suppression precedence and freshness SLA | Block authorization |
| RL-PC-02 | Provider/channel | No provider sends before dry-run enforcement | Live delivery before consent/suppression/audit gates are proven | Provider/channel + security | Reviewed dry-run evidence and separate activation gate | Block live work; no sends authorized now |
| RL-PC-03 | Provider/channel | No WhatsApp marketing without explicit WhatsApp consent and approved template | Platform-policy breach and unexpected messages | Provider/channel + legal | Channel consent and template-category decisions | Block authorization |
| RL-PC-04 | Provider/channel | No SMS marketing without explicit SMS consent and opt-out handling | Unwanted messages without STOP path | Provider/channel + legal | SMS consent, STOP and suppression design | Block authorization |
| RL-PC-05 | Provider/channel | No email marketing without consent and unsubscribe handling | Campaign email without a valid opt-out | Provider/channel + legal | Email consent, unsubscribe, complaint/bounce suppression design | Block authorization |
| RL-PX-01 | Product/UX | No “saved”, “updated”, or active-state claim before persistence exists | Misleading customers about state | Product | Truthful inactive/pending/error copy | Block customer-facing design approval |
| RL-PX-02 | Product/UX | No broad marketing toggle without purpose clarity | Bundled consent | Product + legal + privacy | Unbundled purpose/channel copy | Block authorization |
| RL-PX-03 | Product/UX | No reward, discount, VIP or urgency bait as consent capture | Manipulative consent | Product + legal | Copy principles and review criteria | Block authorization |
| RL-OS-01 | Operator/support | No support-assisted update before verification workflow and approved script | Unauthorized or inconsistent changes | Operator/support + privacy | Identity script, agent scope, confirmation and SLA | Block authorization |
| RL-OS-02 | Operator/support | No manual override without audit and role controls | Untraceable agent action | Operator/support + security | Actor, role, reason, evidence, dual control where required | Block authorization |
| RL-DG-01 | Data governance | No canonical persistence without a named owner | Competing or ownerless sources of truth | Data owner + business sponsor | Named steward and operating model | Block authorization |
| RL-DG-02 | Data governance | No purpose taxonomy change without versioning and review | Semantic drift invalidating old evidence | Data owner + legal/privacy | Version/change-control process | Block authorization |
| RL-DG-03 | Data governance | No campaign import, inferred interest or Product Finder behavior may mint consent | Behavioral inference converted into permission | Data owner + privacy | Source classification and reconciliation tests | Block authorization |
| RL-BG-01 | Business governance | No acceleration into implementation without legal, privacy, security, operator, provider and data-owner sign-off | Deadline pressure bypassing controls | Business sponsor | Completed authorization and later implementation gate | Block implementation |
| RL-BG-02 | Business governance | No live customer communications as a shortcut | Operational launch without consent controls | Business sponsor + provider/channel | Separate explicit activation approval | Block authorization and delivery |
| RL-BG-03 | Business governance | Approved-with-conditions requires owners and due dates for every blocker | Conditions silently ignored | Business sponsor + facilitator | Complete condition tracker | Block Slice 9-B2 |

## Non-waiver rule

No meeting participant may waive a universal red line through a note, verbal agreement, generic risk acceptance, timeline pressure, or “not applicable” status. A proposed exception requires a new versioned boundary review with accountable legal, privacy, security, and business decisions. Until then the most restrictive safe outcome applies.

## Review status

All red lines are adopted as review criteria. They are not evidence that implementation controls exist. No provider sends before dry-run enforcement, no persistence before identity and audit model, and no manual override without audit remain current prohibitions.
