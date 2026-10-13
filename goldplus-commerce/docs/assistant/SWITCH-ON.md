# Goldie switch-on checklist (owner)

1. Merge the latest Goldie PR only (it carries every earlier one), then close the older Goldie PRs.
2. On the server: apply migrations 0177 to 0181 (`migrate-prod.sh`), then roll api, web and prometheus.
3. Care Desk team: add each person at `/admin/care/team` (phone, email, on-duty hours), then press "Send a test alert"
   and confirm the SMS and email arrive.
4. Privacy policy: done. /privacy has a "Chats with Goldie" section (version 1.2, 14 October 2026), naming Anthropic and
   Meta as processors. Have legal read it; any change goes through the legal CMS.
5. Grafana: nothing to do. The "Goldie (customer care)" dashboard loads by itself in the GoldPlus folder (ops/grafana/dashboards).
6. Live check of the model (needs `ANTHROPIC_API_KEY`): run `scripts/qa/goldie-live-eval.ts` on the server (see the
   script header). It grades the 120 eval questions and prints anything that fails.
7. WhatsApp (when ready): Cloud API number, a system-user token with `whatsapp_business_messaging`, then
   `GOLDIE_WHATSAPP_PHONE_NUMBER_ID`, `GOLDIE_WHATSAPP_TOKEN`, `GOLDIE_WHATSAPP_TEST_NUMBERS=<your number>` and
   `GOLDIE_WHATSAPP_ENABLED=true`. Roll api, chat from your phone, then clear `GOLDIE_WHATSAPP_TEST_NUMBERS`.
8. Staff push alerts (optional): set `CARE_PUSH_VAPID_PUBLIC_KEY`, `CARE_PUSH_VAPID_PRIVATE_KEY` and
   `CARE_PUSH_CONTACT`, roll api and web, then each person presses "Alert me on this phone" on the Care Desk.
9. Messenger and Instagram (optional): in the same Meta app as WhatsApp, add the Messenger product, subscribe the
   GoldPlus Page (and the linked Instagram account) to `messages` with callback
   `https://<api host>/webhooks/meta-messaging` and the same verify token. Make a Page access token with
   `pages_messaging` (and `instagram_manage_messages`), set `GOLDIE_META_PAGE_TOKEN`, then
   `GOLDIE_MESSENGER_ENABLED=true` and/or `GOLDIE_INSTAGRAM_ENABLED=true`, and roll api. Message the Page from your
   own account to check. Orders and points are only discussed there after the customer gives the order number and
   phone, as on the website.
10. After two weeks, read the Goldie numbers in the meeting summary (sales after a chat, rating, free-answer share) and
   the quality-review trend.

## WhatsApp alert template (for WhatsApp alerts to the four alert lines)
Needs a WhatsApp Business Account on the Cloud API (step 7). In WhatsApp Manager, Message templates, Create:
- Category: **Utility**. Name: **goldplus_care_alert**. Language: **English (en)**.
- Body: `A GoldPlus customer needs a person now: {{1}} Please open the Care Desk at shopgoldplus.com/admin/care.`
- Sample for {{1}}: `GoldPlus Care: Urgent. Order never arrived (GP-1042). Customer: Sarah 0772 123456. Open the Care Desk.`
- No header, no buttons. Submit; approval usually takes minutes.
Then set `GOLDIE_ALERT_TEMPLATE=goldplus_care_alert` and `GOLDIE_ALERT_TEMPLATE_LANG=en` (with the WhatsApp token and number id) and
roll api. Test from /admin/care/team ("Send a test alert"). The alert text is sent as one line (Meta refuses line breaks).

