# Phase 3 Slice 3.1: One-Event Live Canary Smoke

## Provider Selection Decision
- **Selected Provider**: PostHog
- **Decision Status**: BLOCKED
- **Reason**: No safe server-side capture transport class or HTTP client method exists in the current codebase for PostHog or any other measurement provider. The existing mappers only format payload structures but do not execute outbound requests.

## Missing Transport Integration Details
- **Missing Class**: `PostHogHttpClient` or `PostHogTransport` implementing HTTP requests.
- **Required Env Variables**: `POSTHOG_API_KEY`, `POSTHOG_HOST`
- **File to be Implemented**: A new `apps/api/src/infrastructure/measurement/destinations/PostHogTransport.ts` client layer.
- **Verification**: No event was sent to prevent fake delivery mapping or unsafe configuration.
