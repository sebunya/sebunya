# Slice 9-ZH PRIME runner isolation fix

## Root cause

The 9-ZG one-off runner imported `InternalEmailDiagnosticCanaryGuard` through an explicit absolute `.ts` source specifier while the transport resolved `InternalConsentCanaryGuard` through a relative specifier. The TypeScript runner created duplicate module instances, so the transport rejected the authorization before HTTP with `invalid_or_consumed_internal_canary_authorization`.

## Fix

Added one canonical `EmailDiagnosticRunner` entrypoint. It constructs exactly one guard and one transport and uses extensionless canonical relative imports. Added `EmailDiagnosticRunnerIntegrity` to detect duplicate logical paths, mixed source/dist imports, mixed alias/relative imports, and missing dependency groups before authorization.

No runtime monkey patching, framework change, broad refactor, or unrelated system change was made.
