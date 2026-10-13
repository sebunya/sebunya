# WhatsApp with Meta directly: production launch

Decision (owner, 2026-10-14): GoldPlus talks to Meta's WhatsApp Cloud API directly. Zoho CPaaS stays only as the
fallback when a Meta send fails; SMS is the last resort. One number, one token, used by:

| What | How it is sent | Template needed? |
|---|---|---|
| Order and payment updates, support/quote/dealer/fake-report receipts | `MetaWhatsAppAdapter` (Zoho, then SMS, if Meta fails) | Yes: 13 utility templates |
| Phone verification code | same | Yes: authentication template `goldplus_phone_code` |
| Urgent Care Desk alerts to the four alert lines | `CareAlertChannels.whatsapp` | Yes: `goldplus_care_alert` |
| Goldie answering customers | free-form reply inside the 24-hour window | No |
| Team replies from the inbox | free-form inside the window | No |
| Click-to-WhatsApp advert attribution | webhook `referral` | No |
| Delivery receipts (sent, delivered, read, failed) | webhook `statuses`; a failed one marks the notification FAILED | No |

## State on 2026-10-14 (checked in the owner's browser)
- Business portfolio **Goldplus Ecommerce** `1783651446293515`: **no WhatsApp account, no Messaging account**.
- Meta app **goldplus** `3149957878534050` (in Development mode) in that portfolio; also "Conversions API Application".
- So nothing can be sent yet. Steps 1–6 are the owner's: they create accounts, verify a phone by code and handle tokens.

## 1. Choose the number
- **A new number (recommended to start)**: a SIM that is not on WhatsApp. 0705 004545 keeps working in the WhatsApp
  Business app exactly as today.
- **0705 004545 itself**: registering it on the Cloud API removes it from the WhatsApp Business app on the phone
  (unless WhatsApp Manager offers to keep the app connected, "coexistence"; take that if it is offered). Customers
  then reach Goldie and the inbox at /admin/assistant/conversations instead of the phone.

## 2. Add WhatsApp to the app (creates the WhatsApp account)
developers.facebook.com → My Apps → **goldplus** → Add use case → *Connect with customers through WhatsApp* →
choose portfolio **Goldplus Ecommerce** → accept the WhatsApp terms. Meta creates the WhatsApp Business Account and a
test number.

## 3. Add the real number
WhatsApp Manager → Phone numbers → Add phone number → display name **GoldPlus** (must match the business), category
Shopping and retail → verify with the SMS or voice code → set a 6-digit two-step PIN and keep it safe.
Add a payment method on the Messaging account (Utility and authentication templates are paid per message).

## 4. A permanent token
Business settings → System users → Add → name `goldplus-whatsapp`, role Admin → Assign assets: the app **goldplus**
and the WhatsApp account (full control) → Generate token → app **goldplus**, expiry **Never**, permissions
`whatsapp_business_messaging` and `whatsapp_business_management` → copy it once.

## 5. Webhook
App goldplus → WhatsApp → Configuration → Callback URL `https://api.shopgoldplus.com/webhooks/whatsapp`, Verify
token = a long random phrase you choose → Verify and save → subscribe the fields **messages**,
**message_template_status_update**, **message_template_quality_update**, **phone_number_quality_update**,
**account_update**, **account_alerts** and **template_category_update** (the last six are how the shop hears about a paused template, a quality
drop or a restriction the moment it happens).
In GoldPlus admin → Advertising → Offline sales → WhatsApp: the **WhatsApp Business Account ID**, and the secrets
`{"appSecret":"<App settings → Basic → App secret>","verifyToken":"<the phrase above>","accessToken":"<token from step 4>"}`.
Save here first, then press Verify and save in Meta. Switch the app to **Live** (App settings → Basic needs the privacy
policy URL `https://shopgoldplus.com/privacy`), or real customers' messages will not reach the webhook.

## 6. Server settings (then roll api)
```
GOLDIE_WHATSAPP_PHONE_NUMBER_ID=<Phone number ID from WhatsApp Manager / API Setup>
NOTIFICATIONS_WHATSAPP_ENABLED=true          # customer updates on WhatsApp (templates)
GOLDIE_WHATSAPP_ENABLED=true                 # Goldie answers WhatsApp
GOLDIE_WHATSAPP_TEST_NUMBERS=<your own number> # first day only: Goldie answers just you; remove after
```
The account id and token come from the admin (step 5); `WHATSAPP_WABA_ID` / `GOLDIE_WHATSAPP_TOKEN` only override them.

## 7. Templates (one button)
Admin → Notifications → **WhatsApp templates** → *Submit N templates to Meta*. All 15 go word for word from
`whatsAppTemplates.ts` (13 utility with named parameters, the authentication code, the Care Desk alert). Approval
usually takes minutes; the page shows Approved / Waiting / Rejected (with Meta's reason). A message is sent on
WhatsApp only once its template is approved; until then Zoho (if configured) or SMS carries it.

## 8. Check
1. Message the new number from your phone: Goldie answers (test numbers only on day one).
2. Care Desk → Team → Send a test alert: SMS and WhatsApp arrive on the four alert lines.
3. Place a small test order with your own phone: the order and payment messages arrive on WhatsApp.
4. Grafana "Goldie (customer care)": `whatsapp_delivery_receipts_total` shows delivered/read.
5. Remove `GOLDIE_WHATSAPP_TEST_NUMBERS`, roll api.

## How the module behaves (enterprise checklist)
| Situation | What happens |
|---|---|
| Template not approved yet, rejected, paused, or changed in code after approval | Not used; the message goes by Zoho or SMS. The templates page shows why; "Changed in code" is sent to Meta as an edit with one button. |
| Meta pauses a template, the number's quality drops, the account is restricted | Webhook → approvals re-read at once → urgent Care Desk task (SMS to the alert lines), once per problem per hour. |
| The token expires or loses a permission; the account is blocked or has a billing problem | First refused send → urgent Care Desk task (one per hour, checked against the desk, so two replicas never page twice); customer updates continue by SMS. |
| Meta accepted a message but could not deliver it | The delivery receipt marks that notification FAILED in the log. |
| Meta does not answer in time | Not resent, no fallback (it may already be on the phone): recorded as outcome unknown. |
| Meta moves a template to Marketing (template_category_update) | Never used for updates (marketing needs WhatsApp opt-in and costs more); "Meta made it Marketing" on the templates page; urgent Care Desk task. |
| Meta could not deliver an update (failed receipt) | Marked FAILED, and the same update goes by SMS once (within 24 hours). "Not on WhatsApp" (131026) also skips WhatsApp for that number for 30 days. |
| Customer replies STOP / START | Recorded through the consent ledger when its intake is on (otherwise straight on the channel suppressions, phone:+256…); no more WhatsApp updates on Meta or Zoho, SMS instead; confirmed in the chat. Honoured even when Goldie is off. |
| Customer sends a photo, voice note, video or document | Filed with a viewable link in the conversation, a Care Desk task for a person, an honest holding reply (or Goldie answers the caption). Stickers are filed quietly. |
| Customer sends a location or a contact card | Filed as words ("My location: Ntinda (0.31, 32.58)") that Goldie and the team can use. |
| Every message Goldie answers | Marked read (blue ticks) with "typing…" while the answer is prepared. |
| Checkout | Under the phone field: "We send your order updates to this number on WhatsApp, or by SMS. Reply STOP on WhatsApp to get them by SMS only." (Meta's opt-in notice; no pre-ticked box.) |
| Staff open a customer's photo or voice note | Allowed with customer-data permission, every view on the audit log; Meta keeps media about 30 days. |
| Monitoring | `whatsapp_template_sends_total{outcome,class}`, `whatsapp_delivery_receipts_total{status}`, `whatsapp_account_events_total{field,event}`, `goldie_whatsapp_messages_total{outcome}`. |

## Limits to know
- New numbers start at a messaging limit (business-initiated conversations per day) that rises with quality and
  volume; Business verification raises it. Replies inside 24 hours of a customer's message are not limited.
- Marketing templates (promotions) are not built: they need WhatsApp opt-in and a separate decision.
- Meta pauses a template whose quality drops (customers block or report it); the templates page shows "Paused" and
  the message falls back to Zoho or SMS automatically.
