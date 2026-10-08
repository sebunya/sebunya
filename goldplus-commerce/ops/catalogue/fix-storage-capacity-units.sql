-- Storage capacity units (2026-10-08 SEO audit).
--
-- The Storage Devices "Capacity" attribute carries ONE unit for every product
-- (attributes.unit = 'MB'), so a 32 GB flash drive read "Capacity: 32 MB" on its
-- page and in its structured data — 18 of 19 storage products. The one product
-- that really is megabytes is the 128MB memory card.
--
-- Fix: each value takes the unit printed in its own product name ("32 GB",
-- "128 MB"), and the shared unit is cleared only when no bare number is left.
-- A value is rewritten only when its number equals the number in the name.
-- One transaction: it either fully applies or changes nothing.
--
-- Run (from the repo root on your Mac):
--   ssh goldplus-prod 'cd /opt/goldplus/app/goldplus-commerce && set -a && . ./.env.production && set +a && docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' < goldplus-commerce/ops/catalogue/fix-storage-capacity-units.sql

\echo '== before'
SELECT p.name, v.value, a.unit
  FROM product_attribute_values v
  JOIN products p ON p.id = v.product_id
  JOIN attributes a ON a.id = v.attribute_id
  JOIN categories c ON c.id = a.category_id
 WHERE c.slug = 'storage-devices' AND a.name = 'Capacity'
 ORDER BY p.name;

BEGIN;

UPDATE product_attribute_values v
   SET value = m.r[1] || ' ' || upper(m.r[2]), updated_at = now()
  FROM products p, attributes a, categories c,
       LATERAL regexp_match(p.name, '([0-9]+)\s*(GB|MB|TB)', 'i') AS m(r)
 WHERE v.product_id = p.id
   AND v.attribute_id = a.id
   AND a.category_id = c.id
   AND c.slug = 'storage-devices'
   AND a.name = 'Capacity'
   AND a.unit = 'MB'
   AND m.r IS NOT NULL
   AND v.value = m.r[1];

UPDATE attributes a
   SET unit = NULL
  FROM categories c
 WHERE a.category_id = c.id
   AND c.slug = 'storage-devices'
   AND a.name = 'Capacity'
   AND a.unit = 'MB'
   AND NOT EXISTS (SELECT 1 FROM product_attribute_values v WHERE v.attribute_id = a.id AND v.value ~ '^[0-9.]+$');

COMMIT;

\echo '== after'
SELECT p.name, v.value, a.unit
  FROM product_attribute_values v
  JOIN products p ON p.id = v.product_id
  JOIN attributes a ON a.id = v.attribute_id
  JOIN categories c ON c.id = a.category_id
 WHERE c.slug = 'storage-devices' AND a.name = 'Capacity'
 ORDER BY p.name;
