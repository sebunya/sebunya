# First-Party Data & Server-Side Tracking

GoldPlus captures customer interactions **server-side, on our own API**, with no
third-party cookies, pixels, or external trackers. This is the foundation of the
first-party data strategy: every downstream capability (experimentation KPIs,
loyalty analytics, segmentation, personalisation) reads from this one event store.

## How it works

1. The web app loads `public/js/gp-track.js` (wired in `BaseLayout.astro`).
   - The visitor id is a random UUID kept in **localStorage** (`gp_vid`) — first-party storage only.
   - The session id lives in **sessionStorage** (`gp_sid`).
   - **Do Not Track / Global Privacy Control are honoured**: if either is set, the script sends nothing.
2. Events POST to `POST /events/track` on the API.
3. The `RecordActivityEventUseCase` validates the payload against a **closed event
   vocabulary** and persists it to the `activity_events` table.
4. Server-to-server callers (or the API itself) can also record events, passing
   `visitorId` explicitly. If no visitor id is supplied at all, the API mints one
   and sets a first-party `gp_vid` cookie (HttpOnly, SameSite=Lax).

## Data dictionary — event types

Unknown event types are **rejected**, so this list is the complete vocabulary:

| Event type            | Meaning                                    | Typical `entity`/`entityId`   |
|-----------------------|--------------------------------------------|-------------------------------|
| `PAGE_VIEW`           | Any page render                            | — (uses `path`)               |
| `PRODUCT_VIEW`        | Product detail page viewed                 | `product` / product id        |
| `SEARCH`              | Shop search executed                       | — (`properties.query`)        |
| `ADD_TO_CART`         | Item added to cart                         | `product` / product id        |
| `REMOVE_FROM_CART`    | Item removed from cart                     | `product` / product id        |
| `CHECKOUT_STARTED`    | Checkout begun                             | `cart` / cart id              |
| `CHECKOUT_COMPLETED`  | Order placed                               | `order` / order id            |
| `ORDER_TRACKED`       | Customer viewed order tracking             | `order` / order id            |
| `EXPERIMENT_EXPOSURE` | Visitor assigned to an experiment variant  | `experiment` / experiment key |

Each event stores: `visitorId`, `sessionId?`, `userId?` (when logged in),
`eventType`, `path?`, `entity?`, `entityId?`, `properties` (max 20 scalar
key–values, strings truncated at 500 chars), `createdAt`.

## API

### `POST /events/track`

```json
{
  "visitorId": "optional — cookie fallback, else minted",
  "sessionId": "optional",
  "eventType": "PRODUCT_VIEW",
  "path": "/products/solar-panel-450w",
  "entity": "product",
  "entityId": "3f7b…",
  "properties": { "source": "shop_grid" }
}
```

Returns `201` with `{ eventId, visitorId }`, or `400` with
`MISSING_VISITOR` / `UNKNOWN_EVENT_TYPE` / `BAD_PROPERTIES`.

### `GET /admin/analytics/engagement?days=7`

Admin-only (permission `reports.read`). Returns event counts by type over the
window (1–90 days) — the starting point for engagement reporting.

### Client helper

`window.gpTrack(eventType, { entity, entityId, properties })` is exposed by the
tracker for feature code (e.g. add-to-cart buttons) to reuse.

## Privacy & governance

- No third-party destinations; data stays in the GoldPlus Postgres database.
- DNT/GPC signals suppress collection entirely at the client.
- The event vocabulary is closed and documented here (data-dictionary rule);
  schema lives in `apps/api/src/infrastructure/db/schema/engagement.ts`.
- `userId` is only attached for authenticated sessions; guests are pseudonymous
  visitor UUIDs that a user can clear by clearing site data.
- Property values are validated and truncated server-side to prevent free-form
  PII dumping into the event store.
