-- Read-only: who changes level at the first loyalty sweep after
-- "every point counts" ships (computeLifetimePoints, LoyaltyLedger.ts).
-- Compares each account's CURRENT assigned level with the level its lifetime
-- points reach under the new rule. Reductions (refund reversals, negative
-- corrections) count only from 2026-10-06T21:00Z (7 Oct, Kampala), as in code.
-- Run:  psql "$DATABASE_URL" -f ops/loyalty/tier-preview.sql
with per_account as (
  select la.id as account_id,
    greatest(0, coalesce(sum(le.points) filter (where
      (le.type in ('earn','adjustment') and (le.points > 0 or le.created_at >= timestamptz '2026-10-06T21:00:00Z'))
      or (le.type = 'reversal' and rt.type in ('earn','adjustment')
          and (rt.points > 0 or rt.created_at >= timestamptz '2026-10-06T21:00:00Z')
          and (le.points > 0 or le.created_at >= timestamptz '2026-10-06T21:00:00Z'))
    ), 0)) as new_lifetime
  from loyalty_accounts la
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
