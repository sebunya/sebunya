# Slice 9-X PRIME Consent Operating Layer P0

## Combined scope

Starting baseline: `93856c6c0fc50276b5669a5327537f9184eff629`. This slice combines the locally safe, gated P0 work for consent commands, admin/support workflows, provider dry-runs, authenticated Preference Centre persistence wiring, legacy reconciliation dry-run, verified suppression intake, and no-send readiness.

## Implemented operating layer

| Area | P0 implementation |
|---|---|
| Repositories | Consent operating contract plus Drizzle adapter for catalogues, current state, immutable events, transactional projections, copy references, suppressions, provider evidence, support requests, legacy mapping results, policy blocks, timelines and eligibility inputs |
| Commands | Eleven named consent commands validate actor, identity, purpose/channel, correlation ID, idempotency key, reason and red-line constraints |
| Audit | State mutation uses a deterministic idempotent event ID, immutable envelope, SHA-256 integrity hash and event/projection transaction |
| Feature gates | Eight local gates exist and every gate defaults to disabled |
| Customer API | Authenticated current-state read and exact purpose/channel save command; customer identity is derived from the session |
| Preference Centre | Authenticated purpose-specific form is disabled unless both persistence and save gates are enabled; success copy requires a durable API success receipt |
| Admin/support | Existing admin authentication and permissions protect overview, timeline, support queue, conflict preview/resolve, correction, suppression, dry-run and readiness routes |
| Legacy | Pure dry-run maps ambiguity to `unknown` or `requested_support_assisted`, rejects automatic grants and returns redacted samples |
| Provider suppression | Verified internal callback shape records restrictive evidence and channel suppression; missing authenticity/freshness fails closed |
| Eligibility | Read-only evaluation uses current state, suppression, withdrawal, policy block and copy presence; configured delivery remains disabled |
| Readiness | Reports all gates and fails no-send readiness if the live-send flag is set |

## Red lines enforced

- Anonymous and checkout-contact-only identities cannot grant optional marketing.
- A support conversation can create a reviewed request but cannot silently grant campaign consent.
- Legacy broad flags, Measurement consent, loyalty interest, Memory Lane consent and unknown intent cannot mint broader permission.
- Provider STOP/unsubscribe and withdrawal are restrictive; policy block has strongest precedence.
- Admin correction requires existing admin protection, actor identity, reason, correlation ID, idempotency key and immutable audit. It cannot create a grant.
- Customer omission or ambiguity never defaults to a grant.

## Enabled and disabled state

No gate is enabled by code default. Runtime enablement requires explicit environment configuration outside this commit. `CONSENT_PROVIDER_LIVE_SENDS_ENABLED` exposes no transport capability and is treated as an unsafe readiness failure when true.

No provider client, notification router, queue/outbox, email, SMS or WhatsApp adapter is injected into the consent runtime. No customer communication, provider call, provider response message, campaign dispatch, External Delivery activation or Measurement provider activation occurred.

## Preserved systems

Checkout, payment, PesaPal, order state, auth/RBAC definitions, Credential Vault, secrets, loyalty ledger, Memory Lane, personalisation, utilisation-aware offers, rewards, discounts and coupons are unchanged. The existing admin protection contract remains intact. The existing legacy preference surface is clearly labelled non-canonical and remains separate.

Production migration execution: none. Deployment: none. Services restarted: none.
