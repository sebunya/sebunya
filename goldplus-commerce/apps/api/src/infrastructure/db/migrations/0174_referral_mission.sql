-- 0174: the third mission rewards introducing friends and family, not scanning.
--
-- 'verify_ten' (Serial Authenticator, 100 pts) paid a bonus for ten successful
-- product checks. Each scan already earns its own points (verification_scan,
-- capped per day) and the first one earns the Authenticator badge, so the
-- mission rewarded volume of scanning rather than anything new for the shop.
-- It is ARCHIVED, not deleted: customers' history and any completion stay
-- intact, and an operator can reactivate it in /admin/loyalty/gamification.
--
-- 'refer_three' counts AWARDED referrals (loyalty_referrals.status), so it only
-- moves when a friend's first order is delivered, after the self-referral,
-- shared-phone and monthly-cap checks. The bonus sits on top of the per-friend
-- referral points.
UPDATE "gamification_missions" SET "status" = 'ARCHIVED'
WHERE "key" = 'verify_ten' AND "status" = 'ACTIVE';
--> statement-breakpoint
INSERT INTO "gamification_missions" ("key","title","description","kind","threshold","reward_points","status") VALUES
  ('refer_three', 'Friends & Family', 'Introduce three friends or family members. When the third one''s first order is delivered, you earn this bonus on top of your referral points.', 'REFERRAL_COUNT', 3, 300, 'ACTIVE')
ON CONFLICT ("key") DO NOTHING;
