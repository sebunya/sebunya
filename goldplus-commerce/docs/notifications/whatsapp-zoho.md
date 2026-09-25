# WhatsApp through Zoho CPaaS

Researched 2026-09-25 from Zoho's official pages only. Nothing below is guessed; where Zoho's docs are silent, this says so.

## Which Zoho product

**Zoho CPaaS** is the standalone Zoho messaging product. Zoho's own page calls it "Zoho CPaaS (formerly ZeptoMail)", so it is the same account family as our email. It has a WhatsApp Business API channel "available across all major DCs". The WhatsApp features built into Zoho Desk, CRM and SalesIQ are separate products and are **not** what we use. (Zoho Desk does have `POST /api/v1/im/channels/{id}/initiateSession`, but Zoho documents no way to pass template variables to it.)

Sources:
- Product and code sample: https://www.zoho.com/cpaas/whatsapp-business-api.html
- WhatsApp channel (WABA, numbers, template keys, pricing): https://www.zoho.com/cpaas/help/whatsapp.html
- WhatsApp templates: https://www.zoho.com/cpaas/help/whatsapp-templates.html
- Agents (Send API keys live in an Agent): https://www.zoho.com/cpaas/help/agents.html
- Envelope and auth conventions, from the sibling APIs: https://www.zoho.com/cpaas/help/api/email-sending.md and https://www.zoho.com/cpaas/help/api/sms-sending.md
- Webhooks (email events only): https://www.zoho.com/cpaas/help/webhooks.html

## The API

| Item | What Zoho documents |
|---|---|
| Endpoint | `POST https://cpaas.zoho.com/v1.1/whatsapp` |
| Auth | Header `Authorization: <Authorization-token>`, which is the Agent's **Send API key**. There is no OAuth and no refresh token, so there is nothing to cache. |
| Body | `{ "from": "<FROM_PHONE_NUMBER>", "to": "<TO_PHONE_NUMBER>", "template_key": "<TEMPLATE_KEY>", "merge_info": { "<merge_key>": "<merge_value>" } }` |
| Template key | "A unique system-generated identifier used for API references", shown in CPaaS under Configuration > WhatsApp > Templates. |
| Variables | Named, e.g. `{{customer_name}}`, `{{order_id}}` in the template body, and passed as `merge_info` keys. |
| Template types | Utility and Authentication only. Marketing templates are not offered. |
| Pricing | Credit based. Meta's per-message rate plus a 10% platform fee. Credits last 6 months. |
| Delivery states (dashboard) | Sent, Delivered, Undelivered, Read, Process failed. |

**Data centres.** The only host Zoho documents is `cpaas.zoho.com`. Our ZeptoMail base URL is `https://api.zeptomail.com/v1.1/email`, which is the US (.com) data centre, so the default `https://cpaas.zoho.com/v1.1/whatsapp` should be right for this account. Zoho publishes no per-region WhatsApp hosts. If the account ever moves region, set `ZOHO_WHATSAPP_BASE_URL`, and copy the host from the CPaaS console, not from a guess.

## What the docs leave open (and where the code isolates it)

1. **Response and error shape for WhatsApp.** Zoho gives none. We assume the envelope of the sibling SMS API: success is `{status, data:{code, message, request_id}}`, and failure is `{error:{code, message, details:[{field, message}]}, request_id}` with a 4xx or 5xx code. Code: `classifyZohoWhatsAppFailure` in `apps/api/src/infrastructure/notifications/whatsapp/ZohoWhatsAppAdapter.ts`. It classifies on the HTTP status first, then on the field named in `error.details`, then on words in the message. It never relies on a made-up error code.
2. **Phone format.** The docs only show `<TO_PHONE_NUMBER>`. We send digits with the country code and no `+`, for example `256772123456`. Code: `toZohoWhatsAppRequest`.
3. **Named or numbered merge keys.** The template editor uses names, so we send names. If Zoho wants `"1"`, `"2"`, the fix is one line in `toZohoWhatsAppRequest`.
4. **Authorization prefix.** The WhatsApp sample sends the bare token. Email uses a `Zoho-enczapikey ` prefix. We send exactly what is in `ZOHO_WHATSAPP_API_KEY`, so paste the value the CPaaS console shows, including any prefix it gives.
5. **Rate limits.** None published for WhatsApp. Meta's messaging limits apply (https://developers.facebook.com/docs/whatsapp/messaging-limits). An HTTP 429 is treated as retryable.
6. **Delivery webhooks.** CPaaS webhooks are documented for email events only: bounce, open, click and feedback loop. **No WhatsApp delivery or status webhook is documented, so no webhook route was built.** "Number not on WhatsApp" and "Undelivered" therefore show up only in the CPaaS dashboard. For us, `SENT` means "accepted by Zoho", not "delivered".
7. **Inbound replies.** Zoho says Quick Reply inbound handling "is not supported at this time". That is why our templates do not invite customers to reply.

## How it is built

- **Adapter** (`ZohoWhatsAppAdapter`). It mirrors ZeptoMail and makes one decision through `OutboundGovernanceService` (channel `WHATSAPP`, flag `NOTIFICATIONS_WHATSAPP_ENABLED`, plus the shared `PROVIDER_DELIVERY_ENABLED`, `CUSTOMER_COMMUNICATIONS_ENABLED`, `NOTIFICATION_DELIVERY_ENABLED`, `NOTIFICATIONS_DRY_RUN`, `NOTIFICATIONS_LIVE_SEND_ENABLED`, `NOTIFICATIONS_OPERATOR_APPROVED` and the test allowlist).
  - A missing key or sender number returns `NOT_CONFIGURED` with no network call.
  - A missing template key returns `NOT_CONFIGURED`/`TEMPLATE_NOT_MAPPED`.
  - A dry run returns `DRY_RUN` after the request is built.
  - Phone numbers are masked in logs, and the key and full numbers are removed from every stored message, which is capped at 300 characters.
  - Retry rules:

    | Failure | Retried? |
    |---|---|
    | 401 or 403 (auth) | No |
    | 429 (rate limit) | Yes |
    | 5xx | Yes |
    | Invalid template, recipient rejected, credits exhausted, other 4xx | No |
    | Network error | Yes |
- **Template map** (`zohoWhatsAppTemplates.ts`). This is the only map from our template names to WhatsApp templates. A template that is not in it is never sent on WhatsApp. A unit test checks that each body's `{{variables}}` match the values we send, in order.
- **Config** (`apps/api/src/config/zohoWhatsApp.ts`). This is the only place the env is read. At startup it logs a warning, by variable name and never by value, for a half-configured channel. It never stops the API from booting.
- **Routing** (`NotificationRouter`). For customer order messages, the four acknowledgements and phone verification, WhatsApp is offered only when `canCarry` is true. That means the channel is on, Zoho is configured, the template is mapped and has a key, the class is TRANSACTIONAL, the number is valid and every variable is present. Otherwise the SMS target is routed exactly as before. Dry-run-only events never go to WhatsApp.
- **Fallback, never both** (`ProcessOutboxBatchUseCase`). A WhatsApp target carries its SMS target as `fallback`.

  | WhatsApp result | SMS sent? |
  |---|---|
  | `SENT` or `DRY_RUN` | Never |
  | `NOT_CONFIGURED` or `DISABLED` | Yes, in the same run |
  | `FAILED`, not retryable | Yes, in the same run |
  | `FAILED`, retryable, first two tries | No. The event retries on WhatsApp |
  | `FAILED`, retryable, third try | Yes |

  Both attempts are written to `notification_attempts`, with channel `whatsapp` and then `sms`. The `channel` column is `varchar(20)` with no check constraint, so **no migration was needed**.
- **Consent.** Only TRANSACTIONAL templates can use WhatsApp. Marketing on WhatsApp would need an explicit WhatsApp opt-in, which the platform does not record, so marketing never goes to WhatsApp. Zoho CPaaS has no marketing template type anyway.
- **Not on WhatsApp (by design):**
  - Loyalty notices. They cost credits, so the owner decides.
  - `PASSWORD_RESET`. It is an email link.
  - `PASSWORD_RESET_CODE`. It is sent directly by `SmsResetCodeDelivery`, not through the outbox router.
  - Operations alerts and automation `WHATSAPP_TEMPLATE` actions. They are not in the map, so they report `TEMPLATE_NOT_MAPPED`.
- **Admin.** `/admin/notifications` has a Channels panel: Not configured / Configured (switched off) / Configured (dry run) / Live / Unsafe configuration. The data comes from `GET /admin/notifications/channel-status`, which derives the state from the real flags through the governance policy and reads credential presence only. `GET /admin/notifications/health-check` now includes `whatsapp`, and `/health` reports `whatsapp_config`.

## Owner setup

1. In Zoho CPaaS go to **Configuration > WhatsApp > Add WABA** and connect the WhatsApp Business account through Meta. Then **Add number** and link it to an **Agent**. The number cannot be in use on any other WhatsApp product, including the WhatsApp Business phone app.
2. Buy WhatsApp credits.
3. Create each template below: **Templates > + Add template > Blank template**. Use the Type, Name, language English, and the Body exactly as written, with no header, footer or buttons. Then **Send for approval**. After Meta approves it, copy its **Template key**.
4. In that Agent, copy the **Send API key**.
5. Add these to `.env.production` on the server. `docker-compose.production.yml` already passes them to the API.

```
# Required: without both of these, WhatsApp is "Not configured" and nothing is sent
ZOHO_WHATSAPP_API_KEY=<Agent Send API key, exactly as the CPaaS console shows it>
ZOHO_WHATSAPP_FROM_NUMBER=<WABA number, digits with country code, e.g. 2567XXXXXXXX>

# Optional (defaults shown)
ZOHO_WHATSAPP_BASE_URL=https://cpaas.zoho.com/v1.1/whatsapp
ZOHO_WHATSAPP_TIMEOUT_MS=10000

# One per approved template. Unset = that message keeps going by SMS.
ZOHO_WHATSAPP_TEMPLATE_ORDER_RECEIVED_UNPAID=
ZOHO_WHATSAPP_TEMPLATE_ORDER_PAYMENT_PENDING=
ZOHO_WHATSAPP_TEMPLATE_ORDER_PAYMENT_SUCCESS=
ZOHO_WHATSAPP_TEMPLATE_ORDER_PAYMENT_FAILED=
ZOHO_WHATSAPP_TEMPLATE_ORDER_PAYMENT_CANCELLED=
ZOHO_WHATSAPP_TEMPLATE_ORDER_FULFILLMENT_PROCESSING=
ZOHO_WHATSAPP_TEMPLATE_ORDER_DISPATCHED=
ZOHO_WHATSAPP_TEMPLATE_ORDER_FULFILLMENT_COMPLETED=
ZOHO_WHATSAPP_TEMPLATE_ORDER_CANCELLED_BY_SHOP=
ZOHO_WHATSAPP_TEMPLATE_PHONE_VERIFICATION=
ZOHO_WHATSAPP_TEMPLATE_SUPPORT_REQUEST_RECEIVED=
ZOHO_WHATSAPP_TEMPLATE_QUOTE_REQUEST_RECEIVED=
ZOHO_WHATSAPP_TEMPLATE_DEALER_APPLICATION_RECEIVED=
ZOHO_WHATSAPP_TEMPLATE_FAKE_REPORT_RECEIVED=

# The channel switch. Keep it false until the admin shows "Configured (dry run)" and a test to an allowlisted number works
NOTIFICATIONS_WHATSAPP_ENABLED=false
```

6. Roll the API. Then `/admin/notifications` should show WhatsApp as **Configured (switched off)**. After you set `NOTIFICATIONS_WHATSAPP_ENABLED=true` it shows **Configured (dry run)** while `NOTIFICATIONS_DRY_RUN=true`, and **Live** only once the shared live-send gates are open. Those are the same gates SMS and email use.

## Templates to submit for Meta approval

All are **Utility** templates in English, except phone verification, which is **Authentication**. The variables must keep these exact names.

| Our template | Zoho name | Type | Body |
|---|---|---|---|
| ORDER_RECEIVED_UNPAID | goldplus_order_received | Utility | Hello {{customer_name}}, we have your GoldPlus order {{order_number}} for {{amount}}. It is not paid yet. Our team will call you to confirm it. Questions? Call {{support_phone}}. |
| ORDER_PAYMENT_PENDING | goldplus_payment_pending | Utility | Hello {{customer_name}}, your payment for GoldPlus order {{order_number}} has started but has not cleared yet. Please do not pay again. We will confirm it shortly. Call {{support_phone}} if you are unsure. |
| ORDER_PAYMENT_SUCCESS | goldplus_payment_received | Utility | Hello {{customer_name}}, we have your payment of {{amount}} for GoldPlus order {{order_number}}. Your items are being prepared. Track it: {{track_url}} |
| ORDER_PAYMENT_FAILED | goldplus_payment_failed | Utility | Hello {{customer_name}}, the payment for GoldPlus order {{order_number}} did not go through, so it is not paid. If money left your phone, it will come back. To pay again or get help, call {{support_phone}}. |
| ORDER_PAYMENT_CANCELLED | goldplus_payment_cancelled | Utility | Hello {{customer_name}}, you cancelled the payment for GoldPlus order {{order_number}}. Nothing was charged and the order is saved. Pay when you are ready, or call {{support_phone}}. |
| ORDER_FULFILLMENT_PROCESSING | goldplus_order_packing | Utility | Hello {{customer_name}}, your GoldPlus order {{order_number}} is being packed at our shop. We will message you when the rider leaves. Track it: {{track_url}} |
| ORDER_DISPATCHED | goldplus_order_on_the_way | Utility | Hello {{customer_name}}, your GoldPlus order {{order_number}} is on its way with our rider. Please keep your phone on. Track it: {{track_url}} |
| ORDER_FULFILLMENT_COMPLETED | goldplus_order_delivered | Utility | Hello {{customer_name}}, your GoldPlus order {{order_number}} has been delivered. Thank you. If anything is wrong with it, call {{support_phone}} and we will sort it out. |
| ORDER_CANCELLED_BY_SHOP | goldplus_order_cancelled | Utility | Hello {{customer_name}}, GoldPlus order {{order_number}} has been cancelled. If you paid for it, our team arranges the refund. Call {{support_phone}} if you have not heard from us. |
| PHONE_VERIFICATION | goldplus_phone_code | Authentication | Your GoldPlus code is {{code}}. It expires in {{minutes}} minutes. Never share this code with anyone, including us. |
| SUPPORT_REQUEST_RECEIVED | goldplus_support_received | Utility | Hello {{customer_name}}, GoldPlus has your request (ref {{reference}}). Our team will call you on this number. Need us sooner? Call {{support_phone}}. |
| QUOTE_REQUEST_RECEIVED | goldplus_quote_received | Utility | Hello {{customer_name}}, GoldPlus has your quote request (ref {{reference}}). Our sales team will call you to confirm what you need and give you a price. Call {{support_phone}} anytime. |
| DEALER_APPLICATION_RECEIVED | goldplus_dealer_received | Utility | Hello {{customer_name}}, GoldPlus has your dealer application (ref {{reference}}). Our team will review it and call you. Questions? Call {{support_phone}}. |
| FAKE_REPORT_RECEIVED | goldplus_fake_report_received | Utility | Hello {{customer_name}}, thank you for reporting a suspected fake to GoldPlus (ref {{reference}}). We check every report. We may call you for a detail or two. Questions? Call {{support_phone}}. |

What fills each variable:

| Variable | Filled with |
|---|---|
| `customer_name` | The customer's first name, or "there" |
| `amount` | For example "UGX 250,000" |
| `track_url` | The Track Order link |
| `support_phone` | `SUPPORT_PHONE_DISPLAY` |
| `reference` | The request reference |
| `code` and `minutes` | The one-time code and how long it lasts |

If a value is missing, that message goes by SMS instead. It is never sent with a blank.

**Authentication note.** Meta sometimes rewrites Authentication templates into its own fixed wording, with a copy-code button. If CPaaS does that to `goldplus_phone_code`, keep the variable named `code`. If Meta's wording has no `{{minutes}}`, tell engineering, and `minutes` will be dropped from the map.
