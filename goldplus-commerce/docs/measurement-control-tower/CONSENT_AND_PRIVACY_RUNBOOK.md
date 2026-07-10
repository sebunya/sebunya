# Consent and Privacy Runbook

## Consent Safety Principles
All measurement events must pass through the `ConsentAwareMeasurementPolicy`. If consent is withdrawn, the event status becomes `CONSENT_BLOCKED`.

## Preference Centre Audit
Consent changes generate an audit trail. Raw contact data is explicitly omitted from these payloads.

## PII Redaction Rules
- `email`, `phone`, `customerEmail`, `customerPhone` are hashed or masked (`***`).
- Auth keys, `PESAPAL_SECRET`, `access_token` are replaced with `[REDACTED]`.
