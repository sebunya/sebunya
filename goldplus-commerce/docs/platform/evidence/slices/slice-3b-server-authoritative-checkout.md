# Slice 3B — Server-authoritative checkout, Uganda location persistence, delivery fee zones

Date: 2026-07-15 · Branch: `phase-2-measurement-control-tower-completion`

## Defect repaired (pre-existing, UNSAFE)

`POST /commerce/orders/create` accepted client-supplied `price` per line item and
computed order totals from it — a direct API caller could buy at any price. The
browser total was effectively authoritative, violating the Slice 3 invariant.

## What changed (extension of existing modules — no new engines)

| Layer | Change |
|---|---|
| Domain | `domain/commerce/DeliveryFee.ts` (new, pure): zone types, `normalizeDistrict`, `resolveDeliveryFee`, `validateDeliveryZoneInput`. `Order` gains optional `deliveryLocation` + `deliveryFeeConfirmed` (backward-compatible positional tail params). |
| Use case | `CheckoutUseCase` now takes `IProductRepository` + `IDeliveryZoneRepository`; prices/sku/name resolved from the public catalogue only (`retailPriceUgx` — dealer pricing untouched); quantity bounds 1–99, ≤50 lines; idempotent on `clientOrderKey`; delivery fee from enabled configured zone else truthful 0/unconfirmed. `DeliveryZoneAdminUseCases` (list/upsert/delete). |
| Port | `IDeliveryZoneRepository` (new); `IOrderRepository.save` gains optional `{clientOrderKey}`; `findByClientKey`. |
| Infra | `DrizzleDeliveryZoneRepository` (new); `DrizzleOrderRepository` persists/hydrates the new columns and key. Registry wires all. |
| Schema | Migration `0023_steady_stellaris.sql` (additive): `delivery_zones` table; `orders.delivery_location jsonb`, `orders.delivery_fee_confirmed`, `orders.client_order_key` + unique index. Also reconciles drift: `controlled_live_canary*` tables from the prior canary slice had schema files but no generated migration because `db:generate` was broken by one `.js`-suffixed source import (`activation-live-canary.ts` — fixed to match every sibling schema file; guarded `IF NOT EXISTS`). |
| Route | `/commerce/orders/create` validates with Zod (only productId+quantity accepted per item; structured `deliveryLocation` bounded; `clientOrderKey` 8–80 chars); `/admin/delivery-zones` (GET/PUT/DELETE) behind `pricing.manage`, all mutations audit-logged. |
| Web | `lib/checkout.ts` no longer sends prices; passes structured Uganda location (from existing `UgandaLocationPicker`) + idempotency key; `checkout.astro` hidden `clientOrderKey`; admin page `admin/pricing/delivery-zones.astro` (list/upsert/delete, truthful empty/error states). |
| Tests | `Slice03BServerAuthoritativeCheckout.test.ts` (12 tests): price-injection impossible, unknown/unpriced product rejected, quantity bounds, zone fee applied, unconfigured district stays truthful, idempotent replay, wholesale review routing, fee validation. Existing `Checkout.test.ts` / `Slice03…P0.test.ts` updated to the no-client-price contract. |

## Invariants held

- Browser total never authoritative (now enforced, not just displayed).
- Redirect never marks paid (payment flow untouched).
- Duplicate submission never duplicates orders (`clientOrderKey` unique index + replay).
- No invented delivery fees: unconfigured districts report fee unconfirmed.
- Dealer pricing never read in the public checkout path.

## Gates

Focused: 5 files / 36 tests pass. Full suite, lint, build, typecheck, secret scan,
architecture tests: see commit message (run at commit time).

## Deployment

Source-only. Production migration `0023` requires operator approval (BLOCKED_EXTERNAL).
