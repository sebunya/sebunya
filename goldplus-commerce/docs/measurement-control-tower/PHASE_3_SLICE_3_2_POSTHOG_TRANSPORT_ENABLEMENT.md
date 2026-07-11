# Phase 3 Slice 3.2: PostHog Transport Enablement

## PostHog Integration Details
- **Endpoint Category**: capture
- **Target Provider**: posthog
- **One-Event Cap**: 1 event enforced at eligibility and transport level.
- **Destination Allowlist**: exactly `["posthog"]` checked.
- **Consent Rule**: Event must be consent-eligible (`consentStatus === 'granted'`).
- **PII Filtering**: Event payload scanned. Any occurrences of raw email (`@`), phone (`07...`), payment tokens, secrets, or keys trigger immediate transmission failure.
- **Outbound PostHog Payload**:
  - Contains `api_key` in payload.
  - Distinct ID generated dynamically using safe reference ID.
  - Contains only safe diagnostic properties.

## Required Environment Variables
- `POSTHOG_HOST`
- `POSTHOG_PROJECT_API_KEY`

## Redaction
- Raw response bodies and API tokens are never written to logs or evidence packs.
- Delivery attempts record redacted response summaries with status codes and reference IDs.

## Controlled Smoke Execution
- Real live sends are enabled only when both required env variables are present.
- Otherwise, the transport defaults to a safe `NOT_CONFIGURED` status to prevent failures.
