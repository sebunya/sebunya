# Slice 9-B1RB meeting pack index

## Read first

| Document path | Audience | When to use it | Decision supported |
|---|---|---|---|
| `docs/platform/evidence/slices/slice-09-b1rb-stakeholder-review-cover-memo.md` | All reviewers and sponsor | First pre-read | Understand the narrow design-only decision and exclusions |
| `docs/platform/evidence/slices/slice-09-b1rb-stakeholder-one-page-briefs.md` | Each accountable reviewer | Before individual review | Identify owned decisions, questions, red lines and blockers |

## Send to reviewers

| Document path | Audience | When to use it | Decision supported |
|---|---|---|---|
| `docs/platform/evidence/slices/slice-09-b1rb-stakeholder-review-email.md` | All required reviewers | Distribution | Request a consistent, owned response |
| `docs/platform/evidence/slices/slice-09-b1ra-consent-boundary-stakeholder-review-pack.md` | Reviewers needing full context | Pre-read/reference | Review the complete boundary and customer-risk framing |

## Use in meeting

| Document path | Audience | When to use it | Decision supported |
|---|---|---|---|
| `docs/platform/evidence/slices/slice-09-b1ra-consent-boundary-review-meeting-agenda.md` | Facilitator and attendees | During 60/90-minute review | Sequence decisions and close with owners/dates |
| `docs/platform/evidence/slices/slice-09-b1rb-stakeholder-decision-capture-tracker.md` | Recorder and decision owners | Live in meeting | Capture status, conditions, blockers, evidence and 9-B2 effect |

## Use for decisions

| Document path | Audience | When to use it | Decision supported |
|---|---|---|---|
| `docs/platform/evidence/slices/slice-09-b1ra-consent-boundary-decision-log-template.md` | Decision owners and recorder | One entry per material decision | Preserve approved/excluded scope, expiry and supersession |
| `docs/platform/evidence/slices/slice-09-b1ra-stakeholder-decision-matrix.md` | Facilitator and sponsor | Before final status | Confirm RACI, evidence, risk and required output |

## Source evidence

| Document path | Audience | When to use it | Decision supported |
|---|---|---|---|
| `docs/platform/evidence/slices/slice-09-b1-preference-surface-discovery.md` | All reviewers | Validate current-state claims | Distinguish bounded authorities and legacy risks |
| `docs/platform/evidence/slices/slice-09-b1-consent-source-of-truth-blueprint.md` | Legal, privacy, security, data owner | Boundary reference | Review taxonomy, state, precedence and enforcement concepts |
| `docs/platform/evidence/slices/slice-09-b1r-canonical-consent-boundary-approval-record.md` | All decision owners | Authoritative pre-read | Confirm the approved design boundary under review |

## Red-line controls

Use `docs/platform/evidence/slices/slice-09-b1ra-consent-red-line-register.md` throughout review. Its universal controls are:

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

## Slice 9-B2 authorization gate

Use `docs/platform/evidence/slices/slice-09-b1ra-slice-9-b2-authorization-checklist.md` only after decision-log entries and the capture tracker are complete. Slice 9-B2 remains unauthorized unless all required groups are approved or approved with conditions, every blocker has an owner and due date, no red line is unresolved, and the sponsor explicitly authorizes design-only work.

This index does not authorize preference saving, provider sends, customer communications, runtime changes, or deployment.
