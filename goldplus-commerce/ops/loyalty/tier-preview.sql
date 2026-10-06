-- Read-only: which customers change level when "every point counts" ships.
-- old = order earns only (what production uses today); new = computeLifetimePoints.
with per_account as (
  select la.id as account_id, la.user_id,
    coalesce(sum(le.points) filter (where le.type = 'earn'), 0) as old_lifetime,
    greatest(0, coalesce(sum(le.points) filter (where le.type in ('earn','adjustment')
      or (le.type = 'reversal' and rt.type in ('earn','adjustment'))), 0)) as new_lifetime
  from loyalty_accounts la
  join loyalty_ledger_entries le on le.account_id = la.id
    or le.account_id in (select m.merged_account_id from loyalty_account_merges m where m.survivor_account_id = la.id)
  left join loyalty_ledger_entries rt on rt.id = le.reversed_entry_id
  where la.id not in (select merged_account_id from loyalty_account_merges)
  group by la.id, la.user_id
), placed as (
  select p.*,
    (select t.name from loyalty_tiers t where t.active and t.threshold_lifetime_points <= p.old_lifetime order by t.rank desc limit 1) as old_tier,
    (select t.rank from loyalty_tiers t where t.active and t.threshold_lifetime_points <= p.old_lifetime order by t.rank desc limit 1) as old_rank,
    (select t.name from loyalty_tiers t where t.active and t.threshold_lifetime_points <= p.new_lifetime order by t.rank desc limit 1) as new_tier,
    (select t.rank from loyalty_tiers t where t.active and t.threshold_lifetime_points <= p.new_lifetime order by t.rank desc limit 1) as new_rank
  from per_account p
)
select case when new_rank > old_rank then 'UP (gets a Welcome message)'
            when new_rank < old_rank then 'DOWN (quiet)'
            else 'same' end as move,
       count(*) as customers,
       sum(new_lifetime - old_lifetime) as lifetime_points_added
from placed group by 1 order by 1;
