# Slice 6-A customer support and order confidence P0

Date: 2026-07-14 EAT

Implementation shape: web-only.

- `/support` now presents a clear order-help route, existing product-issue routes, a link-only WhatsApp CTA, qualified returns/warranty guidance, terms guidance, privacy guidance and truthful support expectations.
- `/track-order` is now an honest order-help page. It tells customers to prepare an order reference and checkout contact, but does not collect or submit either value.
- The order-help page explicitly says it is not live courier tracking and does not confirm payment, availability, dispatch, delivery status or arrival time.
- WhatsApp support remains an outbound `wa.me` anchor with `target="_blank"` and `rel="noopener noreferrer"`; no message is sent automatically.
- No invented warranty duration, free returns, replacement guarantee, ETA, courier timeline, paid state, confirmation state, dispatch state or customer communication was added.
- Mobile/accessibility provisions include semantic headings, labelled navigation and ordered guidance, visible focus rings, minimum-height CTAs, responsive grids and stacked mobile actions.
- Tests: Slice 6 passed 7 tests; Slice 2 passed 2; Slice 3 checkout passed 7; Slice 3-B auth passed 2; Slice 4 PDP passed 4; Slice 5 discovery passed 10. Secret scan, workspace typecheck, lint and build passed. Lint had existing warnings and zero errors.
- Full `pnpm test` suite: skipped; no full-suite pass is claimed.
