-- 0183: the shop's alert lines (owner, 2026-10-14): urgent customers page these four Ugandan numbers by SMS and
-- WhatsApp, at any hour (no on-duty window). Names are placeholders: rename them on /admin/care/team.
-- WhatsApp alerts go out once an approved template is set (GOLDIE_ALERT_TEMPLATE); SMS works at once.
-- Idempotent: a number already on the team is left as it is. Rollback: delete these four rows on /admin/care/team.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
INSERT INTO care_team_members (name, role_label, phone, email, alert_sms, alert_email, alert_whatsapp, on_duty, active)
SELECT v.name, 'Alert line', v.phone, NULL, true, false, true, NULL, true
FROM (VALUES
  ('Alert line 0705 004545', '+256705004545'),
  ('Alert line 0776 004545', '+256776004545'),
  ('Alert line 0701 053486', '+256701053486'),
  ('Alert line 0705 770907', '+256705770907')
) AS v(name, phone)
WHERE NOT EXISTS (SELECT 1 FROM care_team_members m WHERE regexp_replace(m.phone, '[^0-9]', '', 'g') = regexp_replace(v.phone, '[^0-9]', '', 'g'));
