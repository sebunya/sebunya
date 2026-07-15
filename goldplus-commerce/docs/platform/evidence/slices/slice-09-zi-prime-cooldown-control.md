# Slice 9-ZI PRIME cooldown control

The cooldown service refuses retries for HTTP 429 until a valid Retry-After or provider reset timestamp has elapsed. Invalid or missing metadata yields `unknown` and defers by default. A budget of zero, a non-internal recipient, or an enabled broad-send gate also blocks eligibility.

The deferred status is restricted to internal readiness/admin consumers and contains only booleans, timestamps when safely derived, category, reason and remaining budget. Secrets, raw response bodies, credentials, full recipients and headers are excluded.
