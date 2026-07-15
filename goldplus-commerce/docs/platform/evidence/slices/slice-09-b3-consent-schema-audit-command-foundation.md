# Slice 9-B3 consent schema, audit, and command-guard foundation

## Decision scope

Starting baseline: `99891c60b7f25b847b62e255fcb994e2f3954faf`. Slice 9-B3 adds an isolated, additive, unexposed internal foundation. It does not authorize or implement customer writes, provider enforcement, customer communications, deployment, or production migration execution.

## Foundation delivered

| Area | Result |
|---|---|
| Schema foundation | Eleven purpose, channel, copy, source, current-state, audit, suppression, callback, support-request, legacy-mapping, and policy-block tables are represented |
| Drizzle schema | Isolated schema definitions and four constrained enums are registered for migration tracking; no repository or route uses them |
| Canonical state | Unknown, request/verification, grant, withdrawal, expiry, supersession, policy block, and service-only states are explicit |
| Identity | Anonymous and checkout-contact-only identities are structurally prevented from qualifying as the prohibited grants |
| Audit | Immutable audit-envelope construction and deterministic SHA-256 hashing are pure; audit tables require integrity evidence and reject update/delete |
| Guards | Pure fail-closed guards protect identity, checkout-contact, legacy-mapping, suppression, withdrawal, and policy precedence boundaries |
| Preview | A deterministic, read-only eligibility evaluator reports failed gates and delivery mode without a transport or side effect |

## Preserved boundaries

- Checkout contact is not marketing consent; a support request is not a direct grant.
- Legacy broad flags cannot map automatically to `granted`.
- Measurement consent, loyalty interest, Memory Lane consent, and unknown intent do not authorize messaging.
- Provider STOP/unsubscribe is representable as channel suppression and outranks a local optional-marketing preference.
- Withdrawal wins over a local grant; an active policy block is strongest.
- No manual override exists. Any future operator command still requires attributable identity, reason, evidence, and immutable audit.
- No provider send can occur from the preview. Disabled delivery remains disabled and failed gates remain visible.

## Runtime and persistence status

The migration was generated and reviewed but was not run against development, staging, or production. No API mutation, customer preference write, repository, provider callback handler, transport, queue/outbox activation, runtime UX, checkout/payment, auth/RBAC, loyalty, offer, discount, coupon, or deployment behavior changed.

No email, WhatsApp, SMS, push notification, or other customer communication was sent. Specialist legal, privacy/data-protection, security, provider/channel, and data-owner approval remains required before customer writes, enforcement, provider calls, or sends.

Explicit evidence: the audit envelope foundation, pure command guards, and pure provider eligibility preview are implemented. No customer preference writes were implemented. No customer communications were sent. No runtime UX changed. No production migration was run.

## Implementation boundary

This slice ends at internal schema definitions and pure functions. Slice 9-B4 and every later activation slice require their own authority, artifact review, tests, and release decision.
