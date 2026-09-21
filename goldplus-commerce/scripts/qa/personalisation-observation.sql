-- Personalisation release observation (runbook: docs/personalisation/R0_ARCHITECTURE_PACKET.md §18.7, §23).
-- READ-ONLY. Compares the window since a deploy with the same-length window before it.
--
-- Usage (on the host, 20 s statement bound):
--   docker exec -i goldplus-commerce-postgres-1 psql -U goldplus -d goldplus -q \
--     -v deploy="'2026-09-20 18:53Z'" < scripts/qa/personalisation-observation.sql
--
-- Reading the counters (learned 2026-09-21): the two "must be 0" counters can be non-zero purely
-- from the roll window (old runtime still serving before the new containers took over). Bucket
-- by minute before calling either a failure. An overnight zero looks identical to a broken relay:
-- find a real visitor (x-forwarded-for in the api logs, no gp_probe cookie) and trace their rows.
SET statement_timeout = '20s';
SET default_transaction_read_only = on;

\echo '== events since deploy vs the same window before (system exposure vs visitor action)'
WITH w AS (SELECT timestamptz :deploy AS d, now() AS n)
SELECT CASE WHEN created_at >= w.d THEN 'after' ELSE 'before' END AS win,
       event_type IN ('RECOMMENDATION_RESPONSE','RECOMMENDATION_ERROR','RECOMMENDATION_IMPRESSION','RECOMMENDATION_VIEWED') AS system_exposure,
       count(*)
FROM recommendation_events, w
WHERE created_at >= w.d - (w.n - w.d) AND created_at < w.n
GROUP BY 1,2 ORDER BY 1,2;

\echo '== RESPONSE rows after deploy, by minute (must be 0 once the new api is serving)'
SELECT to_char(created_at,'YYYY-MM-DD HH24:MI') m, count(*)
FROM recommendation_events WHERE event_type='RECOMMENDATION_RESPONSE' AND created_at >= :deploy
GROUP BY 1 ORDER BY 1;

\echo '== event types after deploy'
SELECT event_type, count(*) FROM recommendation_events WHERE created_at >= :deploy GROUP BY 1 ORDER BY 2 DESC;

\echo '== new profiles after deploy without any visitor-action event, by minute (must be 0 after the roll)'
SELECT to_char(p.first_seen_at,'YYYY-MM-DD HH24:MI') m, count(*)
FROM experience_profiles p
WHERE p.first_seen_at >= :deploy
  AND NOT EXISTS (SELECT 1 FROM recommendation_events e WHERE e.profile_id = p.id
                  AND e.event_type NOT IN ('RECOMMENDATION_RESPONSE','RECOMMENDATION_ERROR','RECOMMENDATION_IMPRESSION','RECOMMENDATION_VIEWED'))
GROUP BY 1 ORDER BY 1;

\echo '== new profiles per hour after deploy (every one should carry a visitor action)'
SELECT to_char(date_trunc('hour', first_seen_at),'MM-DD HH24') h, count(*)
FROM experience_profiles WHERE first_seen_at >= :deploy GROUP BY 1 ORDER BY 1;

\echo '== visitor actions per hour after deploy'
SELECT to_char(date_trunc('hour', created_at),'MM-DD HH24') h, count(*)
FROM recommendation_events
WHERE created_at >= :deploy
  AND event_type NOT IN ('RECOMMENDATION_RESPONSE','RECOMMENDATION_ERROR','RECOMMENDATION_IMPRESSION','RECOMMENDATION_VIEWED')
GROUP BY 1 ORDER BY 1;

\echo '== automation signal: profiles after deploy with a single PRODUCT_VIEWED and nothing else'
SELECT count(*) FROM (
  SELECT p.id FROM experience_profiles p JOIN recommendation_events e ON e.profile_id = p.id
  WHERE p.first_seen_at >= :deploy GROUP BY p.id HAVING count(*) = 1 AND max(e.event_type) = 'PRODUCT_VIEWED') s;

\echo '== serving counter per placement (responses / empty / fallback / hours) — proves rails still render'
SELECT placement, sum(responses) responses, sum(empty) empty, sum(fallback_served) fallback, count(*) hours
FROM recommendation_serving_hourly WHERE hour >= date_trunc('hour', timestamptz :deploy) GROUP BY 1 ORDER BY 1;

\echo '== hero / nav beacons per hour after deploy (browser JS; exposure rows may carry no profile)'
SELECT h, sum(hero) hero, sum(nav) nav FROM (
  SELECT to_char(date_trunc('hour', created_at),'MM-DD HH24') h, count(*) hero, 0 nav FROM hero_events WHERE created_at >= :deploy GROUP BY 1
  UNION ALL
  SELECT to_char(date_trunc('hour', created_at),'MM-DD HH24'), 0, count(*) FROM nav_events WHERE created_at >= :deploy GROUP BY 1) s
GROUP BY h ORDER BY h;

\echo '== orders: after vs before window (sparse — read with care)'
WITH w AS (SELECT timestamptz :deploy AS d, now() AS n)
SELECT CASE WHEN created_at >= w.d THEN 'after' ELSE 'before' END, count(*)
FROM orders, w WHERE created_at >= w.d - (w.n - w.d) GROUP BY 1;

\echo '== events + new profiles per day, last 7 days'
SELECT d, sum(all_events) all_events, sum(visitor_actions) visitor_actions, sum(new_profiles) new_profiles FROM (
  SELECT date_trunc('day', created_at)::date d, count(*) all_events,
         count(*) FILTER (WHERE event_type NOT IN ('RECOMMENDATION_RESPONSE','RECOMMENDATION_ERROR','RECOMMENDATION_IMPRESSION','RECOMMENDATION_VIEWED')) visitor_actions,
         0 new_profiles
  FROM recommendation_events WHERE created_at > now() - interval '7 days' GROUP BY 1
  UNION ALL
  SELECT date_trunc('day', first_seen_at)::date, 0, 0, count(*) FROM experience_profiles WHERE first_seen_at > now() - interval '7 days' GROUP BY 1) s
GROUP BY d ORDER BY d;

\echo '== database size and the two telemetry tables'
SELECT pg_size_pretty(pg_database_size(current_database())) db,
       pg_size_pretty(pg_total_relation_size('recommendation_events')) recommendation_events,
       pg_size_pretty(pg_total_relation_size('experience_profiles')) experience_profiles;
