-- Relabel the orders the preview lists: medium paid_social -> social (their source, facebook / x / pinterest, stays).
-- One transaction; prints how many rows changed. Run only after reading organic-social-orders-preview.sql's output.
begin;
update order_attribution a set medium = 'social'
where a.medium = 'paid_social' and coalesce(a.campaign, '') = ''
  and not (coalesce(a.click_ids, '{}'::jsonb) ?| array['ttclid','ScCid','sccid','li_fat_id','gclid','gbraid','wbraid','msclkid','clickid','click_id']);
select count(*) as now_social_from_click_id from order_attribution where medium = 'social';
commit;
