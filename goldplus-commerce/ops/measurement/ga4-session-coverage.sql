-- How much of what we send GA4 belongs to a GA4 visit (read-only).
-- Before the 2026-10-23 attribution fix: browsing events WITHOUT a GA4 session id are the ones GA4 counted as users
-- with no session and no source ("Direct", neither new nor returning). After it, they are no longer sent to GA4.
-- Run on the host:
--   docker exec -i goldplus-commerce-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < ops/measurement/ga4-session-coverage.sql
\echo '--- browsing events (last 7 days, by day): with a GA4 session / without'
select date_trunc('day', created_at)::date as day,
       count(*) filter (where coalesce(p->'user_data'->>'ga_session_id', '') <> '') as with_session,
       count(*) filter (where coalesce(p->'user_data'->>'ga_session_id', '') = '') as without_session,
       round(100.0 * count(*) filter (where coalesce(p->'user_data'->>'ga_session_id', '') = '') / greatest(count(*), 1), 1) as pct_without
from (select created_at, case jsonb_typeof(payload) when 'string' then (payload #>> '{}')::jsonb else payload end as p
      from outbox_events where event_type = 'TELEMETRY_DISPATCH' and created_at > now() - interval '7 days') e
where p->>'event_name' <> 'page_seen'
group by 1 order by 1;
\echo '--- which events arrive without a session (last 7 days)'
select p->>'event_name' as event, count(*) as without_session
from (select case jsonb_typeof(payload) when 'string' then (payload #>> '{}')::jsonb else payload end as p
      from outbox_events where event_type = 'TELEMETRY_DISPATCH' and created_at > now() - interval '7 days') e
where p->>'event_name' <> 'page_seen' and coalesce(p->'user_data'->>'ga_session_id', '') = ''
group by 1 order by 2 desc;
\echo '--- orders (last 30 days): GA4 session captured at checkout'
select count(*) as orders,
       count(*) filter (where a.ga_session_id is not null) as with_session,
       count(*) filter (where a.order_id is null) as no_attribution_row
from orders o left join order_attribution a on a.order_id = o.id
where o.created_at > now() - interval '30 days';
