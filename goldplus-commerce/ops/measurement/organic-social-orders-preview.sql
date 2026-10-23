-- Orders whose recorded source says "paid_social" only because the landing link carried a social network's own click id
-- (fbclid / twclid / epik) and no campaign tags. No ad has ever run (owner, 2026-10-23): these were shares. Read-only.
-- Run: docker exec -i goldplus-commerce-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < ops/measurement/organic-social-orders-preview.sql
select o.order_number, o.created_at::date as day, a.source, a.medium, a.campaign,
       (select string_agg(k, ',') from jsonb_object_keys(coalesce(a.click_ids, '{}'::jsonb)) k) as click_ids
from order_attribution a join orders o on o.id = a.order_id
where a.medium = 'paid_social' and coalesce(a.campaign, '') = ''
  and not (coalesce(a.click_ids, '{}'::jsonb) ?| array['ttclid','ScCid','sccid','li_fat_id','gclid','gbraid','wbraid','msclkid','clickid','click_id'])
order by o.created_at desc;
