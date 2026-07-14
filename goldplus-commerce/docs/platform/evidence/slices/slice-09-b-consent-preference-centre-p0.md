# Slice 9-B Consent Preference Centre P0

## Implementation

- Public `/preferences` page with required communication, service/order support, product education, loyalty, Memory Lane, personalisation, utilisation-aware offer, channel, data-use, inactive-capability, risk, readiness and support sections.
- `/consent` is a simple server-side 303 alias to `/preferences`; it duplicates no preference logic.
- `apps/web/src/lib/preference-centre.ts` is immutable static configuration with no import-time effects, API calls, customer state, cookies or browser storage.
- Minimal footer integration makes the centre discoverable from Customer Service and legal navigation.
- No admin page was added. The static operator-readiness rows contain no PII or mutation control, while the 49-page deny-by-default admin route contract remains unchanged.

## Truth and consent status

- Preference Centre: preview only; no changes are recorded.
- Marketing sends: disabled from this page.
- Customer-specific preference persistence: disabled.
- WhatsApp, email and SMS marketing: not active.
- Support-assisted preference guidance: available without claiming that support contact automatically changes a record.
- Loyalty participation, Memory Lane, personalisation and utilisation-aware offers: readiness concepts only, not active.
- No subscribed/unsubscribed, saved, updated, enabled, joined, unlocked or opted-in customer-state claims are rendered.

## Safety model

The helper declares purpose separation, data minimisation, identity verification, withdrawal/change paths, audit and retention requirements. Fifteen risk controls block unconsented sends, hidden or bundled consent, pre-ticked choices, provider activation and future programme activation without required policy and governance. Twenty-one launch gates remain incomplete planning requirements, not controls that activate anything.

## Tests and gates

- Focused contract: 84/84 tests passed.
- Protected regressions: all 13 requested suites passed.
- Secret scan: passed; 873 source/config files checked, values not printed.
- Typecheck: passed.
- Lint: passed with 598 pre-existing warnings and zero errors.
- Build: passed; API and web workspaces built, with expected missing Sentry upload-token warnings only.
- Full suite: 140 files / 996 tests passed.

## What remains

There is no preference data model, account verification workflow, persistence, audit store, provider mapping, suppression enforcement, unsubscribe automation, loyalty consent, Memory Lane history, personalisation, or utilisation-aware offer activation. Those require separately authorized design, privacy/legal review and production gates.
