# Slice 10-D DEPLOY R2 PERFECT post-deploy verification

Production source reached clean `13f282969aa2faf162fb3e4e3437a47f4e6de231`. Both API and both web replicas initially became healthy on the exact-source images.

The initial checks returned storefront `200`, API live health `200`, Preference Centre `200`, logged-out Control Room `303`, and logged-out summary API `401`. A later verification caught API `503`; both API replicas had exited. The bounded failure evidence was `TypeError: client.unsafe(...).values is not a function`, followed by an unhandled PostgreSQL UUID-input rejection and graceful shutdown. No live repair or feature change was attempted.

The fresh API/web rollback tags were restored immediately. After rollback, all four API/web replicas are healthy, storefront/API/Preference Centre return `200`, and both Control Room routes return the pre-10-D `404`. The Control Room is therefore not claimed as deployed.

Caddy retained ID `6f6e517ee9d0`, start time `2026-07-15T14:30:06.898875595Z`, and zero restarts. PostgreSQL retained `ebb57744324c`, `2026-07-12T20:33:46.62170169Z`, zero restarts. Redis retained `32c8a2475394`, `2026-07-13T03:34:44.34918138Z`, zero restarts.
