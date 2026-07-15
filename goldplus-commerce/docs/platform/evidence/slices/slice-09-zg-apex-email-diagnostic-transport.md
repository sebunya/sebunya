# Slice 9-ZG APEX email diagnostic transport

## Baseline and deployment

- Starting local/remote commit: `0acf318002e919fb689efd4591ece7420f1fbafe`.
- Branch: `phase-2-measurement-control-tower-completion`.
- Scoped API overlay: `TransactionalEmailFailureForensics`, `InternalEmailDiagnosticCanaryGuard`, and `ZeptoInternalConsentCanaryTransport` only.
- No web overlay, migration, environment-file change, secret change, or unrelated system change.

## Response capture

The transport now returns provider family, transport name, HTTP status, provider status, redacted provider-code reference, bounded error category, retryability, response/network/timeout booleans, and a redacted summary. Non-success JSON responses are classified without preserving raw response text. Authorization headers, tokens, full request bodies and private recipients are never returned.

Unknown provider shapes retain the HTTP status and `unknown` category. The fixed diagnostic copy is: `GoldPlus internal consent delivery diagnostic canary. No customer action required.`

## Diagnostic outcome

The guarded operational attempt reached pre-send audit, but the one-off TypeScript runner loaded duplicate module instances and failed before provider transport with `invalid_or_consumed_internal_canary_authorization`. This is classified as `transport_adapter_bug`; no provider HTTP request was made. A post-response audit records that classification without raw details.

Decision: `SLICE_9_ZG_APEX_EMAIL_DIAGNOSTIC_CANARY_FAILED_CLASSIFIED`.
