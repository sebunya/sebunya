-- 0171: the Spotify Ads API connection is a capability (2026-10-06).
--
-- "Connect Spotify" stores the owner's Spotify app client ID, the ad account
-- and an encrypted refresh token on ad_destination_capabilities, exactly as
-- "Connect TikTok" stores its token (0154, 0166). The capability name check
-- gains 'ads_api'. Nothing else changes; no row is written here.
ALTER TABLE ad_destination_capabilities DROP CONSTRAINT IF EXISTS ad_destination_capabilities_capability_check;
--> statement-breakpoint
ALTER TABLE ad_destination_capabilities ADD CONSTRAINT ad_destination_capabilities_capability_check CHECK (capability IN ('audiences', 'spend', 'offline', 'whatsapp_ads', 'ads_api'));
