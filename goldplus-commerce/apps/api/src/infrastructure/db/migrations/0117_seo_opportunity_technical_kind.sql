-- 0117 — Phase 2 of the Organic Growth OS: the opportunity generator derives
-- technical opportunities (missing title/meta/h1, 4xx/5xx crawl findings) from
-- first-party crawl evidence. 0116's kind vocabulary had no technical kind, so
-- widen the CHECK by exactly one value. Additive only; no data rewrite.
ALTER TABLE seo_opportunities DROP CONSTRAINT seo_opps_kind_chk;
ALTER TABLE seo_opportunities ADD CONSTRAINT seo_opps_kind_chk CHECK (kind IN ('HIGH_IMPRESSION_LOW_CTR','POSITION_2_5','POSITION_5_10','STRIKING_DISTANCE_11_20','RISING_QUERY','DECLINING_QUERY','NEW_QUERY','CANNIBALISATION','MISSING_CATEGORY','MISSING_PRODUCT','ATTRIBUTE_GAP','INTERNAL_LINK_GAP','STRUCTURED_DATA','MERCHANT_GAP','LOCAL_GAP','BACKLINK_GAP','CONTENT_DECAY','SERP_FEATURE','TECHNICAL_ISSUE'));
