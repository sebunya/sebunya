# Slice 9-B1RA consent boundary decision log template

## Use and authority

Use one entry for one material decision under the Slice 9-B1R boundary at `9b92ca001bbbf01ac5dfe5007c131f8dc5157a6e`. Copy this blank section for each decision. This template records stakeholder judgment; it is not a signature, schema, API, persistence mechanism, runtime change, provider activation, or customer-send authorization. Provider delivery remains disabled.

Allowed decision statuses: `approved`, `approved with conditions`, `rejected`, `requires more information`, `not applicable`.

## Blank decision entry

| Field | Required entry |
|---|---|
| Decision ID | Stable identifier, for example `CONSENT-DEC-____` |
| Decision owner | Named accountable person or approved role |
| Stakeholder group | legal / privacy and data protection / security / product / operator-support / provider-channel / data owner-analytics / business sponsor |
| Decision area | One bounded purpose, channel, workflow, red line, or cross-cutting control |
| Date | ISO date and applicable timezone |
| Decision status | approved / approved with conditions / rejected / requires more information / not applicable |
| Approved scope | Exact future design boundary accepted |
| Excluded scope | Exact items not approved; implementation remains excluded by default |
| Conditions | Testable conditions, each with owner and due date |
| Risks accepted | Explicit risk, rationale, accountable acceptor, review expiry |
| Risks rejected | Risks the decision refuses to accept |
| Evidence reviewed | Versioned evidence paths, meeting record, policy/provider material |
| Open questions | Numbered questions; identify whether each is blocking |
| Follow-up owner | One accountable owner per condition/question |
| Due date | ISO date for each blocking condition/question |
| Review expiry date | Date when the decision must be revalidated |
| Implementation impact | Must state that implementation remains unauthorized unless separately approved |
| Slice 9-B2 impact | authorize design-only / authorize with conditions / block / no impact with rationale |

## Condition and question tracker

| Item ID | Related decision ID | Type | Description | Blocking? | Owner | Due date | Evidence required | Status |
|---|---|---|---|---|---|---|---|---|
| `COND-____` | `CONSENT-DEC-____` | condition / question / conflict |  | yes / no |  | YYYY-MM-DD |  | open / satisfied / rejected / expired |

## Conflict and supersession record

| Conflict ID | Decisions in conflict | Red line affected | Stronger current restriction | Resolution owner | Due date | Resolution decision ID |
|---|---|---|---|---|---|---|
| `CONFLICT-____` |  |  | Fail closed until resolved |  | YYYY-MM-DD |  |

| Superseded decision ID | Successor decision ID | Reason | Effective date | Evidence preserved? |
|---|---|---|---|---|
|  |  |  | YYYY-MM-DD | yes required |

## Decision quality checks

- [ ] The owner has authority for this decision area.
- [ ] Approved and excluded scope are both explicit.
- [ ] The decision does not waive a universal red line.
- [ ] Every blocking question and condition has an owner and due date.
- [ ] Evidence is versioned and linked.
- [ ] Risks accepted and rejected are explicit.
- [ ] Review expiry is set.
- [ ] Slice 9-B2 impact says design-only or blocked.
- [ ] No persistence, migration, mutation, provider enforcement, send, runtime change, deployment, or programme activation is implied.

## Aggregation rule

The authorization checklist may cite only completed decision entries. Meeting minutes, email assent, silence, or an unowned action do not substitute for a decision entry. `Approved with conditions` is valid for design-only authorization only when every blocking condition has an owner and due date. A later implementation gate must obtain fresh, explicitly scoped authority.
