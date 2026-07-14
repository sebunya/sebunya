# Slice 7-A production-shape rehearsal

Date: 2026-07-14 (Africa/Kampala)

## Rehearsal

- Built production server started locally from `apps/web/dist/server/entry.mjs` on loopback only.
- Logged-out `/admin`, `/admin/measurement-control-tower`, and `/admin/recommendations/preview` returned `303` redirects to the admin login flow.
- `/admin/login` returned `200`.
- A synthetic local-only session cookie rendered the trust-centre shell and the safe Measurement unavailable state without exposing the cookie value.
- The trust-centre shell contained all seven module labels, disabled-action reasons, and the admin readiness checklist.
- Negative assertions found no rendered session token, bearer header, API base URL, provider activation command, or payment-mutation command.
- Public rehearsal returned `200` for home, shop, search, an existing PDP, support, track-order, terms, privacy, robots, and sitemap; checkout retained its expected `303` behaviour.

The first sampled legacy PDP slug returned `404`; an existing product link was then read from the current shop output and its PDP returned `200`. No catalogue data was created or changed.

Decision: production shape rehearsed successfully for a scoped web-only rollout.
