# Slice 9-B1RA Slice 9-B2 authorization checklist

## Authorization boundary

This checklist determines only whether Slice 9-B2 may begin as design-only under the Slice 9-B1R boundary at `9b92ca001bbbf01ac5dfe5007c131f8dc5157a6e`. It cannot authorize schema implementation, migration, persistence, API mutation, provider enforcement, customer communication, runtime changes, or deployment. Provider delivery remains disabled.

Allowed stakeholder status values:

- `approved`
- `approved with conditions`
- `rejected`
- `requires more information`
- `not applicable` — written rationale and sponsor/facilitator acceptance required

## Required stakeholder reviews

| Required stakeholder | Decision-log IDs | Status | Conditions | Blocking questions | Owners assigned? | Due dates assigned? | Review expiry | Red lines checked | Valid for design-only authorization? |
|---|---|---|---|---|---|---|---|---|---|
| Legal |  | requires more information |  |  | no | no |  | no | no |
| Privacy and data protection |  | requires more information |  |  | no | no |  | no | no |
| Security |  | requires more information |  |  | no | no |  | no | no |
| Product |  | requires more information |  |  | no | no |  | no | no |
| Operator/support |  | requires more information |  |  | no | no |  | no | no |
| Provider/channel owner |  | requires more information |  |  | no | no |  | no | no |
| Data owner/analytics |  | requires more information |  |  | no | no |  | no | no |
| Business sponsor |  | requires more information |  |  | no | no |  | no | no |

The initial state is intentionally unauthorized. Do not replace it with assumed approval.

## Minimum authorization rule

Slice 9-B2 may proceed as design-only only if all required stakeholders are `approved` or `approved with conditions`, and all blocking questions have owners and due dates.

Additionally:

- Every condition has a named owner, due date, required evidence, and review expiry.
- Every `not applicable` has a specific rationale accepted by the business sponsor and facilitator; it cannot hide a required review.
- No stakeholder decision is expired, superseded without a successor, or unsupported by a decision-log entry.
- No red line is waived, contradicted, unresolved, or marked not applicable.
- Legal/privacy/security conditions are compatible; the stricter restriction wins a conflict.
- The business sponsor explicitly states that implementation and sends remain blocked.
- The authorized Slice 9-B2 scope matches the design-only permission below.

Any `rejected`, `requires more information`, missing review, missing owner/due date, unresolved conflict, expired decision, or red-line breach results in `NOT AUTHORIZED`.

## Design-only permission if authorized

Slice 9-B2 may document and review proposals for:

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

Slice 9-B2 must remain design-only unless explicitly reauthorized. It must not implement migrations, live persistence, API mutations, identity matching, provider sends/enforcement, customer communications, loyalty, Memory Lane, personalisation, utilisation-aware offers, discounts/coupons, checkout changes, auth/RBAC changes, runtime edits, deployments, or service restarts.

## Blocking-question tracker

| Question ID | Stakeholder | Question | Why blocking | Owner | Due date | Evidence required | Status |
|---|---|---|---|---|---|---|---|
|  |  |  |  |  | YYYY-MM-DD |  | open |

## Condition tracker

| Condition ID | Decision ID | Condition | Owner | Due date | Evidence | Verification owner | Status |
|---|---|---|---|---|---|---|---|
|  |  |  |  | YYYY-MM-DD |  |  | open |

## Red-line confirmation

- [ ] Checkout contact is not marketing consent.
- [ ] Support conversation is not campaign consent.
- [ ] Legacy broad flags are not canonical purpose consent.
- [ ] Measurement consent is not messaging consent.
- [ ] Loyalty interest is not Memory Lane consent.
- [ ] Memory Lane consent is not utilisation-aware offer consent.
- [ ] Provider STOP overrides local optional marketing preference.
- [ ] Withdrawal wins over marketing.
- [ ] Unknown intent cannot authorize provider sends.
- [ ] No provider sends before dry-run enforcement.
- [ ] No persistence before identity and audit model.
- [ ] No manual override without audit.

## Facilitator validation

| Check | Result |
|---|---|
| Eight stakeholder reviews present and current | no |
| All required statuses approved or approved with conditions | no |
| Every blocking question has owner and due date | no |
| Every condition has owner, due date and evidence | no |
| All red lines confirmed without waiver | no |
| Business sponsor explicitly authorizes design-only | no |
| Implementation remains explicitly blocked | yes |
| Provider delivery remains disabled | yes |
| Persistence remains unauthorized | yes |

## Authorization decision

Current decision: `NOT AUTHORIZED — STAKEHOLDER REVIEW PENDING`.

Future completed decision must record:

- Decision: `AUTHORIZED FOR SLICE 9-B2 DESIGN ONLY` or `NOT AUTHORIZED`
- Business sponsor decision-log ID
- Facilitator name/role
- Decision date and review expiry
- Conditions summary
- Blocking questions summary
- Explicit statement: persistence, runtime implementation, provider enforcement, sends, deployment, and programme activation remain unauthorized

No real signatures are required by this template. Governance identity and evidence must be recorded through the approved decision process.
