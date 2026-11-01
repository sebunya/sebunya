-- 0089: Reward draw goes LIVE, with the budget Rob set.
--
-- BUDGET: Rob capped the draw at UGX 500,000 (not the 4,000,000 the seeded
-- 200,000-point cap implied). At the live point value of 20 UGX:
--     500,000 UGX / 20 UGX per point = 25,000 points
-- so budget_cap_points becomes 25,000. If the point value is ever changed,
-- this cap is denominated in POINTS and must be re-derived — the UGX figure
-- is the intent, the points figure is what the engine enforces.
--
-- CONSEQUENCE OF THE PESSIMISTIC BUDGET GUARD (by design, recorded here so it
-- is never a surprise): granting stops while outstanding unplayed cards could
-- exceed the cap at the TOP prize. With a 25,000-point cap and a 1,000-point
-- top prize that is 25 unplayed cards at any one time. Cards stop being
-- "outstanding" as soon as they are played, so throughput is fine at current
-- order volume; the guarantee being bought is that an issued card can always
-- be paid.
--
-- ACTIVATION: both switches go on — loyalty_config.chance_enabled (master)
-- and the campaign's own active flag. Either one can be turned off again from
-- the admin API with no deploy, and the programme kill switch also stops it.
--
-- Additive and reversible.
-- Rollback: UPDATE loyalty_config SET chance_enabled = false;
--           UPDATE loyalty_draw_campaigns SET active = false;
--           (and restore budget_cap_points to its previous value). Comment only.

UPDATE "loyalty_draw_campaigns"
SET "budget_cap_points" = 25000,
    "updated_at" = now()
WHERE "code" = 'delivery_scratch_v1';
--> statement-breakpoint

-- The top-prize award cap was 200, which at 1,000 points each would be
-- 200,000 points — eight times the whole budget, so it never bound. Bring it
-- to a figure that is meaningful against the real budget: at ~490 cards
-- (25,000 / ~51 expected points per card) and 0.50% odds, roughly 2-3 top
-- prizes are expected, so 10 is a generous ceiling that still caps tail risk.
UPDATE "loyalty_draw_prizes"
SET "max_awards" = 10
WHERE "campaign_id" = (SELECT "id" FROM "loyalty_draw_campaigns" WHERE "code" = 'delivery_scratch_v1')
  AND "points_awarded" = 1000;
--> statement-breakpoint

-- Master switch for chance mechanics.
UPDATE "loyalty_config" SET "chance_enabled" = true, "updated_at" = now() WHERE "singleton" = 'config';
--> statement-breakpoint

-- Campaign activation.
UPDATE "loyalty_draw_campaigns"
SET "active" = true, "updated_at" = now()
WHERE "code" = 'delivery_scratch_v1';
