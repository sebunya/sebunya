# Goldie runbook (on-call)

Who this is for: whoever is on call for the shop's systems. Every alert below also opens an urgent task on the
Care Desk (`/admin/care`), which pages the on-duty team by SMS and email.

## Service targets

| Measure | Target | Where to see it |
|---|---|---|
| First reply to a customer (website or WhatsApp) | under 1 minute, 24/7 | Goldie answers immediately; WhatsApp outcomes in Grafana "Goldie (customer care)" |
| Urgent task picked up ("I'll take it" or Done) | within 15 minutes in working hours | Care Desk wait colours; `goldie_care_oldest_urgent_minutes` |
| Callback made | same working day | Care Desk "Call backs" |
| Weekly quality review | 12 chats scored every week | `/admin/assistant/quality` |
| Model spend | inside the monthly cap | Shop assistant settings, Teach Goldie |

## Switch Goldie off (or down)

- **Paid answers only:** Shop assistant settings (`/admin/assistant`), untick "Paid AI layer on". Goldie keeps answering
  from shop data and memory.
- **The whole website chat:** remove `ANTHROPIC_API_KEY` from the web container's environment and roll web.
- **WhatsApp only:** set `GOLDIE_WHATSAPP_ENABLED=false` and roll api. Messages still arrive in the shop's WhatsApp
  for people to answer.

## WhatsApp replies failing
Alert: `GoldieWhatsAppRepliesFailing` (or `GoldieSocialRepliesFailing` for Messenger/Instagram), or a Care Desk task
"Goldie needs attention: replies".
Customers received a holding reply and a follow-up task exists for each.
1. Look at the task titles: "could not be sent (…)" names WhatsApp's reason.
2. `401` or `190` means the token expired or lost `whatsapp_business_messaging`. Make a new system-user token, set
   `GOLDIE_WHATSAPP_TOKEN`, and roll api.
3. Messenger/Instagram: `190` is an expired Page token (`GOLDIE_META_PAGE_TOKEN`); `10` or `2018278` means outside the
   24-hour window, so only a person can reach the customer another way.
4. `131047` means more than 24 hours have passed since the customer's last message. Only a person can reply,
   with an approved template or a call.
5. No reason given (the brain failed): check the web container is up (`docker compose ps web`). The api reaches it at
   `WEB_INTERNAL_ORIGIN`. Roll web.
6. Interrupted replies (all three channels) are retried once by the recovery pass within 2 minutes (`goldie_whatsapp_recovered_total`).

## Urgent customer waiting
Alert: `GoldieUrgentCustomerWaiting`. Open the Care Desk; the red-edged task at the top is the one. Press "I'll take it",
call or WhatsApp the customer, add a note, then Done. If nobody is set up for alerts, the desk shows a yellow banner:
add the team at `/admin/care/team` and send a test alert.

## Nobody taking urgent tasks
Alert: `GoldieEscalationsFiring`. Urgent tasks are being re-paged to everyone (up to twice). Check the team list and
on-duty hours at `/admin/care/team`; send a test alert to confirm phones and inboxes receive them.

## Spend near the cap
Alert: `GoldieSpendNearCap` or a desk task "Goldie needs attention: spend". Goldie automatically keeps answering from
shop data and memory when the cap is reached. Look at Teach Goldie: pin good answers (free from then on) and check the
projected month. Raise the cap in Shop assistant settings only if paid answers must continue.

## Alerts not arriving
1. Send a test alert from `/admin/care/team`.
2. SMS and email go through the outbox: `/admin/notifications` shows each attempt and its provider answer.
3. The hourly cap (`CARE_ALERTS_PER_HOUR`, default 12) and the one-per-customer-per-30-minutes rule may have held an
   alert back. The task is still urgent on the desk.

## A customer asks for their data or for it to be deleted
Use the existing privacy requests flow (Customer data, Privacy requests). Since 0181 the export includes their Goldie
chats, Care Desk tasks and chat interests, and erasure removes them.
