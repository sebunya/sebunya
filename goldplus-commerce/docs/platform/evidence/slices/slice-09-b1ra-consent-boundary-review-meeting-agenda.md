# Slice 9-B1RA consent boundary review meeting agenda

## Meeting purpose

Decide whether the Slice 9-B1R canonical consent boundary may govern a design-only Slice 9-B2. The meeting does not approve schema, migrations, persistence, API mutation, provider enforcement, customer communications, loyalty/Memory Lane/personalisation/utilisation-aware offers, runtime changes, or deployment. Provider delivery remains disabled.

## Required attendees

- Facilitator/governance recorder
- Legal decision owner
- Privacy and data-protection decision owner
- Security decision owner
- Product decision owner
- Operator/support decision owner
- Provider/channel decision owner
- Data/analytics decision owner
- Business sponsor

Delegates must have documented authority. Missing required decision owners may inform discussion but cannot produce authorization.

## Pre-read and preparation

- Read the Slice 9-B1R approval record and all six stakeholder workflow artifacts.
- Review assigned stakeholder row, blocking questions, acceptable conditions, and red lines.
- Propose decision status, approved/excluded scope, conditions, owners, due dates, and expiry.
- Submit new questions before the meeting where possible.
- Do not place credentials, customer PII, environment values, or real signatures in the pack.

## Recommended 60-minute version

| Time | Topic | Required outcome |
|---:|---|---|
| 0–5 | Purpose of meeting and authority boundary | Confirm design-only decision; state what is not being approved |
| 5–12 | Current state and customer-risk walkthrough | Shared understanding of checkout, support, legacy flags, Measurement, loyalty/Memory Lane and post-withdrawal harms |
| 12–20 | Purpose/channel boundary review | Record objections or conditional acceptance; no bundled purposes |
| 20–27 | Legacy surface and source-precedence decisions | Confirm service-only/support-only treatment and precedence order |
| 27–34 | Provider STOP/withdrawal decisions | Confirm STOP/unsubscribe and withdrawal outrank optional local preferences |
| 34–41 | Audit/tamper-evidence and identity decisions | Confirm immutable evidence, copy/source versions, verification and manual-override controls |
| 41–50 | Stakeholder-specific blockers | State status, blocking questions, owner and due date for legal/privacy/security/product/operator/provider/data reviews |
| 50–56 | Slice 9-B2 authorization decision | Business sponsor records approve/conditional/reject/more-information; implementation remains blocked |
| 56–60 | Owners, due dates, expiry and close | Read back actions, red-line status, next review and decision-log IDs |

## Recommended 90-minute version

| Time | Topic | Required outcome |
|---:|---|---|
| 0–7 | Purpose, decision rights and what is not being approved | Confirm quorum, authority and design-only boundary |
| 7–17 | Current state and customer-risk walkthrough | Agree facts and prevent inferred consent |
| 17–29 | Purpose classification review | Legal/product/privacy positions per purpose and service exception |
| 29–39 | Channel boundary review | WhatsApp/email/SMS/phone/in-account/support-assisted requirements |
| 39–49 | Legacy surfaces and identity | Checkout/service-only, support/follow-up, broad flags/unknown, endpoint verification |
| 49–58 | Source precedence, provider STOP and withdrawal | Approve restrictive order and fail-closed conflicts |
| 58–67 | Audit/tamper-evidence and security | Decide required evidence, copy/source versioning, callback/auth/role controls |
| 67–77 | Stakeholder decisions and conditions | Capture statuses, disagreements, blocking questions, owners and dates |
| 77–84 | Slice 9-B2 authorization decision | Business sponsor decides design-only go/no-go based on checklist |
| 84–90 | Decision read-back and close | Confirm log entries, expiry, unresolved red lines, follow-up meeting |

## Facilitator decision script

For each stakeholder ask:

1. What status do you assign?
2. What exact scope do you approve and exclude?
3. Which conditions are blocking?
4. Who owns each question or condition, and by what date?
5. Which red lines did you verify?
6. When does this review expire?
7. Does your decision authorize design-only, conditionally authorize it, or block it?

## Required decision topics

- Purpose/channel boundary review
- Legacy surface decisions
- Source precedence decisions
- Provider STOP/withdrawal decisions
- Audit/tamper-evidence decisions
- Identity and shared-endpoint decisions
- Manual override and operator-control decisions
- Stakeholder-specific blockers
- Slice 9-B2 authorization decision
- Owners and due dates

## Close conditions

The facilitator must not mark the checklist authorized unless every required stakeholder is approved or approved with conditions, every blocking question has an owner and due date, no red line is breached, and the business sponsor explicitly records design-only authorization. Otherwise record `blocked` and schedule the owned follow-up. No meeting outcome authorizes persistence or provider sends.
