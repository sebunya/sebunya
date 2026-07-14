# Slice 9-B1RB stakeholder review cover memo

**Subject: Decision required — GoldPlus consent boundary review for design-only Slice 9-B2**

## Purpose

GoldPlus asks eight accountable reviewer groups to decide whether the approved consent boundary is clear and safe enough for Slice 9-B2 to proceed as design-only. This is a governance review, not implementation approval.

## What is being reviewed

Reviewers are assessing purpose and channel separation, source precedence, identity and audit prerequisites, withdrawal and suppression controls, stakeholder ownership, and the conditions that must govern any later design proposal.

## What is not being approved

This review does not authorize preference saving, provider sends, customer communications, loyalty activation, Memory Lane, personalised offers, utilisation-aware offers or discounts.

This review only determines whether Slice 9-B2 may proceed as design-only. It does not approve schema or API proposals in this slice, migrations, persistence, provider enforcement, runtime changes, deployment, checkout/payment changes, or auth/RBAC changes.

## Why this matters

Without an agreed boundary, transaction contact, support contact, broad legacy flags, analytics choices, or programme interest could be misread as permission. The result could be unwanted messages, ineffective withdrawal, provider-policy breaches, and evidence that cannot explain why a customer was contacted.

## Required reviewers

Legal; privacy and data protection; security; product; operator/support; provider/channel owner; data owner/analytics; and business sponsor.

## Decision statuses

Each required reviewer must record `approved`, `approved with conditions`, `rejected`, `requires more information`, or a justified `not applicable`, with approved/excluded scope, conditions, evidence, blocking questions, owners, due dates, and expiry.

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

## What happens after review

The facilitator records each decision in the decision log and capture tracker. Slice 9-B2 may be authorized as design-only only when all required groups are approved or approved with conditions, every blocker has an owner and due date, no red line is breached, and the business sponsor explicitly records design-only authorization.

## What remains blocked

Slice 9-B2 is currently unauthorized. Persistence, migrations, API mutations, provider enforcement, customer communications, programme activation, runtime changes, and deployment remain blocked even if design-only work is later authorized.
