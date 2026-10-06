-- Read-only: who changes level at the first loyalty sweep after
-- "every point counts" ships (computeLifetimePoints, LoyaltyLedger.ts).
-- Compares each account's CURRENT assigned level with the level its lifetime
-- points reach under the new rule. Reductions (refund reversals, negative
-- corrections) count only from loyalty_config.lifetime_reductions_from, which
-- migration 0174 stamps at deploy. BEFORE the deploy that column does not
-- exist yet, so the preview uses now(): "if it shipped this minute".
-- Run:  psql "$DATABASE_URL" -f ops/loyalty/tier-preview.sql
with cfg as (
  -- Read through to_jsonb so the query also runs before 0174 adds the column.
  select coalesce(
    (select (to_jsonb(c) ->> 'lifetime_reductions_from')::timestamptz from loyalty_config c where c.singleton = 'config' limit 1),
    now()) as reductions_from
), per_account as (
  select la.id as account_id,
    greatest(0, coalesce(sum(le.points) filter (where
      (le.type in ('earn','adjustment') and (le.points > 0 or le.created_at >= cfg.reductions_from))
      or (le.type = 'reversal' and rt.type in ('earn','adjustment')
          and (rt.points > 0 or rt.created_at >= cfg.reductions_from)
          and (le.points > 0 or le.created_at >= cfg.reductions_from))
    ), 0)) as new_lifetime
  from loyalty_accounts la
  cross join cfg
  join loyalty_ledger_entries le on le.account_id = la.id
    or le.account_id in (select m.merged_account_id from loyalty_account_merges m where m.survivor_account_id = la.id)
  left join loyalty_ledger_entries rt on rt.id = le.reversed_entry_id
  where la.id not in (select merged_account_id from loyalty_account_merges)
  group by la.id
), placed as (
  select p.account_id, p.new_lifetime,
    cur.name as current_tier, cur.rank as current_rank,
    (select t.name from loyalty_tiers t where t.active and t.threshold_lifetime_points <= p.new_lifetime order by t.rank desc limit 1) as new_tier,
    (select t.rank from loyalty_tiers t where t.active and t.threshold_lifetime_points <= p.new_lifetime order by t.rank desc limit 1) as new_rank
  from per_account p
  left join loyalty_tier_assignments a on a.account_id = p.account_id
  left join loyalty_tiers cur on cur.code = a.tier_code
)
select case
         when new_rank is null then 'no level'
         when current_rank is null then 'UP: first level (welcome message)'
         when new_rank > current_rank then 'UP (welcome message)'
         when new_rank < current_rank then 'DOWN (level-down message)'
         else 'same'
       end as move,
       coalesce(current_tier, '-') || ' -> ' || coalesce(new_tier, '-') as change,
       count(*) as customers
from placed
group by 1, 2
order by 1, 2;
