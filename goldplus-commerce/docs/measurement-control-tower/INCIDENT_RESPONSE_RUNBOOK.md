# Incident Response Runbook

## Suspected PII Leak
1. Check `DefaultReleaseEvidenceRedactor` logs.
2. Confirm `PreferenceRedactor` was active.
3. Verify test fixtures weren't accidentally migrated to DB.

## Paid-Social Misrouting
If an event fires when blocked, check `ConsentAwareMeasurementPolicy` bypasses. (Bypasses are architecturally forbidden in Phase 2).

## Admin Access Issue
Review the `DefaultReleaseReadinessAccessPolicy`.
