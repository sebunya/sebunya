-- 0161 — Two owner-approved data repairs after 0154–0160 (2026-09-26).
--
-- 1. Role grants. The permission baseline (packages/shared permissions) gives
--    SUPPORT_OPERATOR customer_data.view, and SECURITY_ADMIN customer_data.view
--    + privacy_requests.manage. The registry sync only seeds roles that hold
--    NO permissions, so in production these roles kept their older sets and
--    support staff got 403 on /admin/customer-360 and /admin/privacy-requests.
--    This adds exactly those rows, only where the role and permission exist,
--    never removing anything the Roles screen granted since.
-- 2. nav_config.contact.whatsappBatteryPrefill held a complete wa.me URL (the
--    old seed), which the header wrapped in a second wa.me URL. The header now
--    unwraps such values; this rewrites ONLY a value still equal to the old seed
--    to the message form, and bumps the document version so an admin form open
--    on the old version is refused rather than silently overwriting.
--
-- Idempotent (ON CONFLICT / WHERE equals-old-seed). Rollback: delete the four
-- role_permissions rows; set the prefill back to the old URL.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p
  ON (p.action = 'customer_data' AND p.resource = 'view' AND r.name IN ('SUPPORT_OPERATOR', 'SECURITY_ADMIN'))
  OR (p.action = 'privacy_requests' AND p.resource = 'manage' AND r.name = 'SECURITY_ADMIN')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE nav_config
SET config = jsonb_set(config, '{contact,whatsappBatteryPrefill}', to_jsonb('Hi GoldPlus, I need a battery for my phone. My phone model is: '::text)),
    version = version + 1,
    updated_at = now()
WHERE config->'contact'->>'whatsappBatteryPrefill' = 'https://wa.me/256705004545?text=Hi%20GoldPlus%2C%20I%20need%20a%20battery%20for%20my%20';
