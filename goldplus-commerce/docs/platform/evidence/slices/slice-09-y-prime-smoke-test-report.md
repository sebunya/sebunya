# Slice 9-Y PRIME smoke-test report

## Public and health routes

| Route | Result |
|---|---|
| `GET https://shopgoldplus.com/` | 200 |
| `GET https://shopgoldplus.com/shop` | 200 |
| `GET https://shopgoldplus.com/preferences` | 200 |
| Representative PDP `/products/goldplus-built-in-cable-power-bank-gp-pd-w3` | 200 |
| `GET https://api.shopgoldplus.com/health/live` | 200 |
| `GET https://api.shopgoldplus.com/health/ready` | 200 |

The authenticated account Preference Centre returned `303` to login when logged out. An unauthenticated canonical customer write returned `401`. Persistence and Preference Centre save gates were also false in the running API, so no broad customer save was available.

## Admin and support protection

Logged-out web requests to `/admin`, `/admin/measurement`, `/admin/external-delivery`, `/admin/settings/authentication` and `/admin/consent-operating` returned `303` to the admin login route. Unauthenticated API requests to consent readiness, overview and support-request routes returned `401`. No operational content was exposed.

## No-send readiness

The runtime evaluator reported:

- `provider_live_sends_enabled: false`
- `no_send_status: pass`
- `dry_run_readiness: available`
- `live_send_readiness: blocked`
- `commands_enabled: false`
- `preference_centre_save_enabled: false`
- `provider_suppression_intake_enabled: false`

The evaluator's `production_migration_required: true` field is a static P0 readiness marker rather than a database detector; the migration was independently verified through the production ledger and all 11 tables. This semantic limitation is recorded as a known risk and does not weaken the no-send gate.

## Legacy dry-run

Two synthetic, non-customer candidates were evaluated. Result: two rejected auto-grants, one `unknown`, one `requested_support_assisted`, redacted customer references, and zero writes. The database remained at zero legacy mappings, current states, grants and consent events after smoke.

## Provider eligibility dry-run

A synthetic/non-customer identity was evaluated for marketing email. Result: ineligible because consent was unknown, identity anonymous, copy/template/credential absent and provider delivery disabled. Output recorded `provider_transport_called: false` and `send_attempted: false`. No provider event, channel suppression, consent event or customer state was written.

## Command-write smoke decision

Command-write UAT was skipped. There is no synthetic-only guard, and safely enabling persistence would expose the authenticated customer command generally. The runbook directs keeping public persistence disabled rather than forcing an unsafe write smoke.

## Post-smoke database and service state

- Current states: 0
- Granted states: 0
- Consent events: 0
- Provider unsubscribe events: 0
- Channel suppressions: 0
- Legacy mapping rows: 0
- API replicas healthy: 2/2
- Web replicas healthy: 2/2
- Provider transports called: 0
- Customer communications sent: 0
