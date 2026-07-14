# Slice 9-B1RB stakeholder decision capture tracker

## Authorization rule

Slice 9-B2 remains unauthorized until all required stakeholder groups are approved or approved with conditions and all blocking questions have owners and due dates. No red line may remain breached or unresolved, and the business sponsor must explicitly authorize design-only work.

Valid final statuses are `approved`, `approved with conditions`, `rejected`, `requires more information`, and justified `not applicable`. Every row starts `pending review`; silence and attendance are not approval.

| Stakeholder group | Owner/name | Decision status | Conditions | Blocking questions | Owner for blockers | Due date | Evidence reviewed | 9-B2 impact |
|---|---|---|---|---|---|---|---|---|
| Legal | To assign | pending review | — | — | — | — | — | blocked pending review |
| Privacy and data protection | To assign | pending review | — | — | — | — | — | blocked pending review |
| Security | To assign | pending review | — | — | — | — | — | blocked pending review |
| Product | To assign | pending review | — | — | — | — | — | blocked pending review |
| Operator/support | To assign | pending review | — | — | — | — | — | blocked pending review |
| Provider/channel owner | To assign | pending review | — | — | — | — | — | blocked pending review |
| Data owner/analytics | To assign | pending review | — | — | — | — | — | blocked pending review |
| Business sponsor | To assign | pending review | — | — | — | — | — | blocked pending review |

## Mandatory red lines

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

This tracker records review evidence only. It does not authorize preference saving, schema/API work in this slice, provider sends, customer communications, runtime changes, or deployment.
