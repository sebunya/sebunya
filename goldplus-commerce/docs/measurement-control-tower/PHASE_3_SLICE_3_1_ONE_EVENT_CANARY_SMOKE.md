# Phase 3 Slice 3.1: One-Event Live Canary Smoke

## Provider Selection Decision
- **Selected Provider**: PostHog
- **Decision Status**: resolved in Slice 3.2
- **Reason**: The safe server-side capture transport for PostHog is implemented. Outbound transport is code-ready but runtime-blocked if env variables are not configured in the host environment.


## Missing Transport Integration Details
- **Missing Class**: `PostHogHttpClient` or `PostHogTransport` implementing HTTP requests.
- **Required Env Variables**: `POSTHOG_API_KEY`, `POSTHOG_HOST`
- **File to be Implemented**: A new `apps/api/src/infrastructure/measurement/destinations/PostHogTransport.ts` client layer.
- **Verification**: No event was sent to prevent fake delivery mapping or unsafe configuration.
