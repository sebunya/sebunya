# Slice 9-ZG APEX diagnostic attempt report

## Readiness

Boolean readiness passed for credential, sender, host, allowlisted internal recipient, payload, copy, audit table, suppression, withdrawal, policy, and broad-send lockdown. Synthetic consent was granted in a one-off gated process and provider eligibility was evaluated in dry-run mode.

## Attempt

- Correlation ID: `slice-09-zg-diagnostic-1784107698441`.
- Identity: synthetic only; `uat_synthetic_slice_09_zg_…`.
- Recipient: one internal allowlisted address; never printed and not delivered.
- Pre-send audit: recorded.
- Guard authorization: passed.
- Provider HTTP request: not issued; transport invocation failed locally with `invalid_or_consumed_internal_canary_authorization` due duplicate module loading in the operational runner.
- Post-response audit: recorded with `transport_adapter_bug`, `response_received=false`, and no raw error.
- Synthetic withdrawal: recorded; final synthetic state is withdrawn.
- Retries: zero.

Decision: `SLICE_9_ZG_APEX_EMAIL_DIAGNOSTIC_CANARY_FAILED_CLASSIFIED`.
