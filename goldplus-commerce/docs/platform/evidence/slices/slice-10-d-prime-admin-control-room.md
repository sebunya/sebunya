# Slice 10-D PRIME admin control room

The protected page is `/admin/consent-operations`. It performs a server-side session guard before fetching data and redirects unauthenticated requests. Its API dependency is `GET /api/admin/consent/operations/summary`.

The page presents Pilot State, Ledger Health, No-Send Sentinel, Preference Centre Safety, Incidents and Recommended Actions, and the Operator Runbook. It renders only aggregate counts and gate state. It does not render raw identities, secrets, environment values, or event payloads.

There are no mutating buttons or write endpoints. Pause, resume, force-read-only, and enable-send capabilities remain false. The existing navigation inventory now identifies the control room as read-only.

The UI fails closed: an unavailable summary produces a red posture and an escalation instruction rather than a green or unknown-safe state.
