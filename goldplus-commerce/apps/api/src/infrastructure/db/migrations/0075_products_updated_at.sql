-- U6 §17 — products.updated_at for real sitemap lastmod (AC2).
--
-- WHY
-- The sitemap set lastmod to now() on every request, which trains Google to
-- ignore lastmod. AC2 requires lastmod to reflect actual entity modification
-- time, but products had no updated_at column (the P0-2 assumption was wrong —
-- verified against HEAD). This adds it, backfilled from created_at so existing
-- rows carry an honest (not fabricated-recent) timestamp.
--
-- LOCK RISK: additive column with a metadata-only default; backfill is a single
-- bounded UPDATE. Safe online for a single-shop catalogue.

ALTER TABLE products ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
UPDATE products SET updated_at = created_at;
