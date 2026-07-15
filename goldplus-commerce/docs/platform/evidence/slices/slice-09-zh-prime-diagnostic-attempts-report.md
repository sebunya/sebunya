# Slice 9-ZH PRIME diagnostic attempts report

## Attempt 1

- Correlation ID: `slice-09-zh-attempt-1-1784109404176`.
- Synthetic identity only; one allowlisted internal recipient, masked and not printed.
- Runner preflight: passed.
- Guard: passed.
- Pre-send audit: recorded.
- Provider request: one internal diagnostic request.
- Provider response: HTTP `429`; response received; no network error; no timeout.
- Classification: `rate_limited`; retryable provider condition.
- Post-response audit: recorded with redacted provider-code reference and summary only.
- Synthetic withdrawal: recorded.

## Attempt 2

Not executed. `rate_limited` is explicitly non-local-fixable for this slice. No retry was authorized.

Total diagnostic transport attempts: 1 of maximum 2.

Decision: `SLICE_9_ZH_PRIME_EMAIL_PROVIDER_FAILURE_CLASSIFIED`.
