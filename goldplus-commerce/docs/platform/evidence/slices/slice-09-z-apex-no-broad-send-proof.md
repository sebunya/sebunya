# Slice 9-Z APEX no-broad-send proof

## Structural proof

- The guard has no HTTP route, admin toggle, queue consumer, campaign integration or public entry point.
- Authorization requires `internal_canary: true`, an allowed provider, exactly one allowlisted internal/sandbox recipient, recipient binding, a correlation ID, pre-recorded audit, passed eligibility, no suppression, no withdrawal, no policy block, fixed copy/template version and provider credentials.
- Customer, prospect, checkout, order, support, legacy and unknown recipient classes are rejected.
- Campaign IDs, newsletter IDs, multiple recipients and the broad live-send flag are rejected.
- Authorization objects are runtime-unforgeable, one-shot and consumed before transport.
- The email payload is fixed, non-promotional and tracking-disabled.

## Runtime proof

After the one-off process exited:

| Gate/state | Result |
|---|---|
| `NOTIFICATIONS_LIVE_SEND_ENABLED` | not true |
| `CONSENT_PROVIDER_LIVE_SENDS_ENABLED` | false |
| `CONSENT_PERSISTENCE_COMMANDS_ENABLED` | false |
| `CONSENT_PREFERENCE_CENTRE_SAVE_ENABLED` | false |
| `CONSENT_INTERNAL_CANARY_EMAIL_ENABLED` in API service | absent |
| No-send readiness | pass |
| Live-send readiness | blocked |
| Public customer write | unavailable |
| Provider suppression intake | disabled |

Exactly one internal email transport attempt occurred and it failed. There were no confirmed sends, no retries, no other provider attempts, no customers targeted, no queue/outbox activation, and no campaign, newsletter, audience, advertising or analytics dispatch.

## Preserved systems

Checkout/payment, PesaPal, orders, auth/RBAC, Credential Vault schema, External Delivery broad activation, Measurement broad activation, loyalty, Memory Lane, personalisation, utilisation-aware offers, rewards, discounts and coupons were not changed.
