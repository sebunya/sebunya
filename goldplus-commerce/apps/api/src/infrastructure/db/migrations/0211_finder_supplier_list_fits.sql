-- 0211 (2026-10-28): owner policy, battery finder. A fit from the supplier's compatibility list is a fit; no
-- second-person check is required before customers are told so. The finder's stored copy (battery_finder_config,
-- seeded add-only at boot, so new code defaults never reach an existing row) still says such fits are "not checked
-- by us" and asks people to confirm before buying. Replace those two texts with the new defaults, but only where
-- the stored text is still the old default: anything staff edited by hand is left alone.
-- Rollback: set the two keys back to the old sentences quoted in the WHERE clauses below.
UPDATE battery_finder_config
SET config = jsonb_set(config, '{awaitingVerificationNote}', to_jsonb('This fit comes from our supplier''s compatibility list. Not sure of your exact model? Message us and we will confirm it.'::text)),
    version = version + 1,
    updated_at = now()
WHERE config->>'awaitingVerificationNote' = 'A supplier lists this battery for your phone. We have not checked the fit ourselves yet, so confirm with us before you buy.';
--> statement-breakpoint
UPDATE battery_finder_config
SET config = jsonb_set(config, '{intro}', to_jsonb('Choose your phone or type a battery code. We show the batteries that fit it, from our own checks and our supplier''s compatibility list.'::text)),
    version = version + 1,
    updated_at = now()
WHERE config->>'intro' = 'Choose your phone or type a battery code. We only show batteries we have checked against that phone, and we say when a fit has not been checked yet.';
