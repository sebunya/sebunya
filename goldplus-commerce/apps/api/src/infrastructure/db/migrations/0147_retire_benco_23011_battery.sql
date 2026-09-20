-- Owner decision 2026-09-20: remove the "BENCO 23011" battery from the shop.
-- The supplier could not say which phones it fits, and a battery nobody can
-- match is not one to sell. It has no orders and sits in no basket.
--
-- Retired, not hard-deleted: it disappears from the storefront, search, the
-- finder and the merchant feed (all read active products only), while its
-- stock-ledger and import history stay intact — deleting those would rewrite
-- inventory records. Idempotent; matches by SKU, so it is a no-op anywhere the
-- product does not exist.
-- Rollback: UPDATE products SET active = true WHERE sku = 'GP-BAT-BENCO23011';
--           UPDATE battery_profiles SET lifecycle_status = 'REVIEW', archived_at = NULL WHERE canonical_code = 'BENCO 23011';
UPDATE "products" SET "active" = false, "updated_at" = now() WHERE "sku" = 'GP-BAT-BENCO23011' AND "active" = true;
--> statement-breakpoint
UPDATE "battery_profiles" SET "lifecycle_status" = 'ARCHIVED', "archived_at" = coalesce("archived_at", now()), "updated_at" = now()
WHERE "canonical_code" = 'BENCO 23011' AND "lifecycle_status" <> 'ARCHIVED';
