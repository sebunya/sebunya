-- Organic pilot gates G3 (funnel alive) and G5 (commercial): docs/growth/README.md §8.
-- Read-only, aggregates only. Run 14 and 30 days after PR #190 is live, in the production database:
--   docker exec -i goldplus-commerce-postgres-1 sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -X -q -P pager=off' < funnel-check.sql
-- Events without a session are excluded: before #190 every finder event had none, and the relay now
-- records nothing without one, so "with session" = real browsers since the deploy.

\echo === G3. finder events, last 14 days (with / without a session) ===
select event_type, count(*) filter (where session_hash is not null) as with_session, count(*) filter (where session_hash is null) as without
from battery_finder_events where occurred_at > now() - interval '14 days' group by 1 order by 1;

\echo === G3b. funnel by browser, last 14 days: viewed a phone page -> opened a battery -> added to basket ===
with s as (
  select session_hash,
         min(occurred_at) filter (where event_type = 'RESULT_VIEWED') as viewed,
         min(occurred_at) filter (where event_type = 'PRODUCT_VIEWED') as opened,
         min(occurred_at) filter (where event_type = 'ADDED_TO_CART') as added
  from battery_finder_events
  where session_hash is not null and occurred_at > now() - interval '14 days'
  group by 1)
select count(*) filter (where viewed is not null) as viewed_phone_page,
       count(*) filter (where viewed is not null and opened >= viewed) as then_opened_battery,
       count(*) filter (where viewed is not null and added >= viewed) as then_added_to_basket,
       count(*) filter (where added is not null and viewed is null) as added_without_phone_page
from s;

\echo === G3c. phone pages viewed most, last 14 days ===
select d.brand, d.model, count(*) as views, count(distinct e.session_hash) as browsers
from battery_finder_events e join devices d on d.id = e.device_id
where e.event_type = 'RESULT_VIEWED' and e.session_hash is not null and e.occurred_at > now() - interval '14 days'
group by 1,2 order by 3 desc limit 20;

\echo === G5. GA4: sessions and purchases that LANDED on a phone page, last 30 days ===
select left(dimension, 70) as landing_page, sum(sessions) as sessions, sum(engaged_sessions) as engaged, sum(purchases) as purchases, sum(purchase_revenue_minor) as revenue_minor
from measurement.ga4_daily_series
where report = 'landing_page' and day > current_date - 30 and (dimension like '/phone-batteries/%' or dimension in ('/phone-batteries', '/battery-finder'))
group by 1 order by 2 desc limit 30;
select sum(sessions) as phone_page_landings, sum(purchases) as purchases_from_them
from measurement.ga4_daily_series where report = 'landing_page' and day > current_date - 30 and dimension like '/phone-batteries/%';

\echo === Business layer: paid orders containing a battery (a product with a battery record), last 30 days ===
select count(distinct o.id) as orders_with_a_battery, sum(oi.quantity) as batteries
from order_items oi join orders o on o.id = oi.order_id join battery_profiles bp on bp.product_id = oi.product_id
where o.created_at > now() - interval '30 days' and o.payment_status in ('paid','confirmed','settled');
