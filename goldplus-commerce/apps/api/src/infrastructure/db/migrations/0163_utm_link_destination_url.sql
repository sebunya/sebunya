-- 0163 — Where a campaign UTM link points (2026-09-27).
--
-- utm_links stored only the tags (source, medium, campaign, content, term), so a
-- link saved from the UTM builder lost the landing page it was built for. The
-- builder and POST /admin/campaigns/:id/utm-links now record it.
--
-- Additive, nullable, idempotent. Rollback: drop the column.
ALTER TABLE utm_links ADD COLUMN IF NOT EXISTS destination_url text;
