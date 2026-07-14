# Slice 8-B0 — Admin Measurement Protection Baseline

Date: 2026-07-14 (Africa/Kampala)

## Source baseline

- Repository: `goldplus-commerce`
- Branch: `phase-2-measurement-control-tower-completion`
- Starting commit: `073f6dbdd9ac9c068c1ceebf88dd700fd82b33b1`
- Remote commit before work: `073f6dbdd9ac9c068c1ceebf88dd700fd82b33b1`
- Ahead/behind: `0/0`
- Index and isolated worktree: clean
- Original dirty worktree: not used or modified

## Production blocker reproduced

Logged-out production requests returned `200` and rendered protected operational labels:

| Route | Status before repair | Protected UI markers |
| --- | ---: | ---: |
| `/admin/measurement` | 200 | 5 |
| `/admin/measurement/attribution` | 200 | 4 |
| `/admin/measurement/consent` | 200 | 4 |
| `/admin/measurement/dlq` | 200 | 4 |
| `/admin/measurement/control-tower/controlled-activation/live-review` | 200 | 4 |
| `/admin/login` | 200 | 0 |

The route source rendered `AdminLayout`, Measurement operational UI and client/server fetch bootstrapping without checking the established `goldplus_session` cookie first.

## Established safe pattern

Protected pages including `/admin`, `/admin/loyalty`, `/admin/recommendations/preview` and `/admin/measurement-control-tower` call `readSessionToken(Astro.request)` in Astro frontmatter and return a server-side `303` to `/admin/login` before rendering when the cookie is absent.

## Selected implementation shape

Add the same established server-side guard to every existing route under `apps/web/src/pages/admin/measurement/**`. The guard executes before any layout, protected content, server fetch, or emitted client script. No shared authentication contract, RBAC model, API, provider, destination, transport, queue, checkout, loyalty, recommendation or customer-communication behavior is changed.

Authenticated operator UAT is pending because no approved authenticated production session is used in this repair.
