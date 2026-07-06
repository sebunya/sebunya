# Loyalty Programme (Gamification Foundation)

An append-only points ledger that rewards successfully **paid** orders. This is
the gamification foundation — spin-and-win, badges, and leaderboards can layer
on top of the same ledger (see `docs/ROADMAP.md`).

## Rules (customer-explainable, no dark patterns)

- **Earn**: 1 point per 1,000 UGX paid (`UGX_PER_POINT` in
  `apps/api/src/domain/loyalty/Loyalty.ts`). Remainders round down.
- **Tiers** (by lifetime *earned* points): MEMBER (0+), SILVER (1,000+), GOLD (5,000+).
- **Ledger**: positive entries = earned, negative = redeemed. Balance is the sum.
- Redemption mechanics are not enabled yet; `REDEMPTION` entries are supported
  by the ledger so no migration is needed when they land.

## When points are awarded

On the first successful payment webhook per order
(`POST /webhooks/payment/:provider` → `AwardOrderLoyaltyPointsUseCase`):

- **Idempotent** — a unique `(order_id, reason)` index plus a use-case pre-check
  means webhook replays never double-credit.
- **Non-blocking** — a loyalty failure is logged but never rejects the payment webhook.
- Guest orders (no `userId`) are still recorded against the order, so points can
  be attached retroactively if the customer later creates an account (roadmap).

## Customer API

```
GET /account/loyalty        (Bearer session token)
```

```json
{
  "balance": 1100,
  "lifetimeEarned": 1200,
  "tier": "SILVER",
  "recent": [ { "orderId": "…", "points": 250, "reason": "ORDER_PAID", "createdAt": "…" } ]
}
```

## Data

Table `loyalty_ledger` — see
`apps/api/src/infrastructure/db/schema/engagement.ts` and migration
`0005_stale_firelord.sql`. Reasons: `ORDER_PAID`, `MANUAL_ADJUSTMENT`, `REDEMPTION`.
