# Transactional Email — ZeptoMail

The `ZeptoMailAdapter` now sends real email through the ZeptoMail HTTP API
(`https://api.zeptomail.com/v1.1/email`). It is the email channel behind the
transactional outbox → notification router → attempt-log pipeline.

## Configuration

| Variable                 | Required | Notes |
|--------------------------|----------|-------|
| `ZEPTOMAIL_API_TOKEN`    | yes      | Raw `enczapikey` value or the full `Zoho-enczapikey <key>` header — both accepted. |
| `ZEPTOMAIL_FROM_ADDRESS` | yes      | Must be a verified sender on your ZeptoMail Mail Agent. |
| `ZEPTOMAIL_FROM_NAME`    | no       | Defaults to `GoldPlus`. |
| `OPS_ALERT_EMAIL`        | for ops alerts | Recipient for payment/dealer/quote/counterfeit notifications routed by `DefaultNotificationRouter`. |

**No fake integrations**: with credentials missing the adapter returns
`NOT_CONFIGURED` and sends nothing; the attempt is still logged truthfully in
`notification_attempts`.

## Behaviour contract

| Situation                  | Result                                                        |
|----------------------------|---------------------------------------------------------------|
| Missing credentials        | `NOT_CONFIGURED` (`NO_CREDENTIALS`), outbox marks processed   |
| Invalid recipient          | `FAILED` (`BAD_RECIPIENT`) before any network call            |
| ZeptoMail 2xx              | `SENT`, provider request id recorded                          |
| ZeptoMail non-2xx          | `FAILED` with provider error; outbox retries with backoff     |
| Network error / 10s timeout| `FAILED` (`NETWORK_ERROR` / `TIMEOUT`); outbox retries        |

Retries come from `ProcessOutboxBatchUseCase`: exponential backoff from 60s,
capped at 1h, max 8 attempts. Every attempt (any outcome) is appended to
`notification_attempts` and visible at `/admin/notifications`.

## Templates

`apps/api/src/infrastructure/notifications/zeptomail/emailTemplates.ts` renders
branded, responsive, table-based HTML (email-client safe) with all payload
values HTML-escaped:

- `PAYMENT_SUCCESS`, `PAYMENT_FAILED`
- `DEALER_APPLICATION`
- `NEW_QUOTE_REQUEST`
- `FAKE_REPORT_ALERT`
- Unmapped template keys fall back to a generic branded notification that lists
  the payload fields, so no event is silently dropped.

## Tracking & analytics

Delivery attempts, provider codes, and provider messages are queryable from
`notification_attempts` (admin UI: `/admin/notifications`). Open/click tracking
is configured on the ZeptoMail side (Mail Agent → tracking settings); the
`request_id` we store correlates our log with ZeptoMail's processing reports.
