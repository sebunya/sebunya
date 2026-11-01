-- 0167: the WhatsApp reference code on a recorded sale (2026-10-01).
--
-- A tap on one of the shop's WhatsApp links puts "Ref GP-XXXXXX" in the
-- customer's first message and files which visitor the code was issued to
-- (measurement.whatsapp_ref, 0156). A sale closed in that chat and recorded
-- here could not use it: the sale reached the ad platforms with a hashed phone
-- only, never with the advert click the visitor arrived on. With the code on
-- the sale, the click id on that visitor's record travels with the sale, so a
-- WhatsApp sale that began with a Facebook or Instagram advert is credited to
-- it — without the WhatsApp Business Platform.
--
-- Additive and nullable; no existing row changes.
ALTER TABLE ad_offline_sales ADD COLUMN IF NOT EXISTS whatsapp_ref varchar(9)
  CHECK (whatsapp_ref IS NULL OR whatsapp_ref ~ '^GP-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$');
