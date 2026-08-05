-- 0091: Reward draw ON, with the controls relaxed to match the business
-- decision Rob made on 2026-08-05.
--
-- Rob's position: this is an internal promotional campaign — a bonus on top of
-- points a delivered order has already earned — not a gaming or lottery
-- product, and the 0090 controls were too restrictive for it. That is his call
-- to make; the statutory research and the questions it raised remain on record
-- in docs/loyalty-legal-brief.md, unchanged, so the decision is documented
-- rather than erased.
--
-- WHAT CHANGES
--
-- 1. A third compliance basis, 'business_accepted': an explicit, dated,
--    written acceptance by the business owner. This keeps the audit trail —
--    the system still records WHY draws are permitted to run — without
--    requiring a lawyer's reference before the feature can operate.
--
-- 2. The age gate becomes OPTIONAL and is switched OFF (min_age NULL).
--    The 0090 gate was not merely strict, it was broken for this product:
--    date of birth is an optional profile field almost nobody fills in, and
--    the check failed closed, so virtually every customer would have been
--    refused a card and the feature would have looked dead. The capability
--    stays in the code and is one config value away if it is ever wanted.
--
-- 3. Draws are enabled and the launch campaign activated.
--
-- WHAT DELIBERATELY DOES NOT CHANGE — none of these restrict a customer or
-- get in anyone's way, and all of them are worth having on a promotion that
-- pays out real value:
--    * published odds, computed from the live prize weights
--    * every card wins (points_awarded > 0 enforced at the database)
--    * one card per delivered order, one prize per card (unique indexes)
--    * the UGX 500,000 budget cap and the honourable-card guarantee
--    * append-only ledger record of every prize
--    * self-exclusion for any customer who asks
--    * the regulatory/audit CSV export
--    * three independent kill switches
--
-- Additive and reversible.
-- Rollback: UPDATE loyalty_config SET chance_enabled = false; UPDATE
--   loyalty_draw_campaigns SET active = false. (Comment only.)

-- 1. Allow the business-decision basis.
ALTER TABLE "loyalty_draw_compliance" DROP CONSTRAINT IF EXISTS "loyalty_draw_compliance_basis_check";
--> statement-breakpoint
ALTER TABLE "loyalty_draw_compliance" ADD CONSTRAINT "loyalty_draw_compliance_basis_check"
  CHECK ("basis" in ('none', 'licensed', 'counsel_advised_exempt', 'business_accepted'));
--> statement-breakpoint

-- Acknowledgement now requires a timestamp and a written reason rather than a
-- session user id, because a decision recorded by migration has no session.
-- The admin API still stamps acknowledged_by when a human does it in-app.
ALTER TABLE "loyalty_draw_compliance" DROP CONSTRAINT IF EXISTS "loyalty_draw_compliance_ack_check";
--> statement-breakpoint
ALTER TABLE "loyalty_draw_compliance" ADD CONSTRAINT "loyalty_draw_compliance_ack_check"
  CHECK ("basis" = 'none' OR ("acknowledged_at" IS NOT NULL AND "notes" IS NOT NULL));
--> statement-breakpoint

-- 2. Age restriction becomes optional; NULL means no age check at all.
ALTER TABLE "loyalty_draw_compliance" ALTER COLUMN "min_age" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "loyalty_draw_compliance" ALTER COLUMN "min_age" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "loyalty_draw_compliance" DROP CONSTRAINT IF EXISTS "loyalty_draw_compliance_age_check";
--> statement-breakpoint
ALTER TABLE "loyalty_draw_compliance" ADD CONSTRAINT "loyalty_draw_compliance_age_check"
  CHECK ("min_age" IS NULL OR "min_age" BETWEEN 13 AND 30);
--> statement-breakpoint

-- 3. Record the decision and switch the mechanic on.
UPDATE "loyalty_draw_compliance"
SET "basis" = 'business_accepted',
    "min_age" = NULL,
    "acknowledged_at" = now(),
    "notes" = 'Business decision recorded 2026-08-05 by the owner: the delivery scratch card is an internal promotional campaign — a bonus on top of points an already-delivered order has earned — and is not operated as a gaming or lottery product. The owner reviewed the statutory research in docs/loyalty-legal-brief.md, including the Lotteries and Gaming Act 2016 definition of "promotional competition", and directed that the campaign run. Age restriction switched off: it is not applied to this promotion. This basis is a business acceptance of risk, not legal advice.',
    "updated_at" = now()
WHERE "singleton" = 'compliance';
--> statement-breakpoint

UPDATE "loyalty_config" SET "chance_enabled" = true, "updated_at" = now() WHERE "singleton" = 'config';
--> statement-breakpoint

UPDATE "loyalty_draw_campaigns" SET "active" = true, "updated_at" = now() WHERE "code" = 'delivery_scratch_v1';
