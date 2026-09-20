# GoldPlus transactional emails — redesigned for ZeptoMail

15 templates. Prepared 20 September 2026. This package replaces the supplied static sample exports with editable Mustache HTML templates and separate sample renders. No emails have been sent and no live application has been changed.

## Open and review

Open `OPEN-ME.html` in your browser. Each email also opens independently in `review/`. These are sample renders for ZeptoMail review, not live customer records. `templates/` contains the dynamic production candidates. `plain-text/` contains matching dynamic text alternatives. `subjects.csv` and `manifest.json` hold subjects and preheaders. Each template has a matching example in `sample-data/`.

## What needed fixing

- The original line items totalled UGX 148,000, but customer subtotals showed UGX 154,000. The internal email added a UGX 5,000 delivery fee without reconciling its total. The revised samples show UGX 148,000 + UGX 5,000 = UGX 153,000. These are illustrative values, not a change to real prices.
- Payment success and delivery completion were paired with “In progress / Being checked.” Every sample now uses a state appropriate to its event. Live states must still come from the application.
- “Nothing was charged” and “it will come back” were stronger than the evidence available. The revised copy directs customers with a debit to seek reconciliation before another payment.
- The original unpaid email asked for payment before delivery fees were established. The revised CTA opens the order; an unconfirmed-fee branch explicitly excludes delivery from the subtotal.
- Cancellation pushed customers back to shopping while their payment problem was unresolved. It now puts order access and payment clarification first.
- “Verified electronics” and “keep fakes out of Kampala” overreached. The header now describes the business; product reports are treated as concerns pending review.
- Small pale text, four-column item grids and repetitive status panels made mobile reading harder. The redesign uses larger type, two-column item summaries, dark text, generous space and one dominant action.
- “Nothing to unsubscribe from” felt defensive. The footer now simply explains why the email was sent.

## Design and behavioural rationale

Lime #96CC06 is the brand signature, paired with near-black #10140A and white. A large editorial headline makes the event immediately recognisable. A soft green next-step panel separates advice from order details. Every transactional message serves the customer's current task; there are no promotions, false countdowns, manufactured scarcity or unsupported social proof.

The behavioural choices are practical: reduce uncertainty around money; lower effort with one clear action; make progress visible without implying stages that have not happened; provide a simple recovery path after failure; help delivery through phone and landmark cues; and finish delivery with a useful inspection prompt. No conversion uplift is claimed without testing.

The Uganda context is functional, not slang: UGX amounts, mobile-money prompts and debits, local phone display, WhatsApp, Kampala location cues and EAT timestamps. Montserrat is first in the font stack, with Arial/Helvetica fallbacks. No remote font or image is required. The text brand is a fallback, not a recreation of an official logo asset.

## ZeptoMail setup

1. Use `review/` when ZeptoMail asks for sample emails as part of sender review. Explain that these are transactional messages following orders, payments, account resets or customer enquiries; the admin notification is staff-only.
2. In your ZeptoMail Mail Agent, create/import each file from `templates/` through the HTML editor/import option. Set its subject from `subjects.csv`. Keep the exact event-to-template mapping in `manifest.json`.
3. Supply the matching `sample-data/*.json` as merge information for a preview/test. These files include sample customer and payment details; never send them as real transactions.
4. Use your configured sender, `noreply@shopgoldplus.com`, display name `GoldPlus`, and reply-to `support@shopgoldplus.com`. The source supplied these addresses. Confirm that the reply inbox is monitored and the phone/WhatsApp number is still correct before activation.
5. Record each actual template key or alias in the application. Pass real event data in `merge_info`, with exactly one customer recipient per transactional send. Example request structure is below; use your account's API endpoint/region and server-side credentials.
6. Preview loops, conditionals and subjects inside ZeptoMail. Then send controlled tests to your own Gmail, Outlook and Apple Mail accounts. Check light/dark modes, disabled images, long orders and narrow screens. Do not activate until these tests pass.

```json
{
  "template_key": "REPLACE_WITH_ACTUAL_TEMPLATE_KEY",
  "from": {"address": "noreply@shopgoldplus.com", "name": "GoldPlus"},
  "to": [{"email_address": {"address": "YOUR_TEST_ADDRESS", "name": "Test"}}],
  "reply_to": [{"address": "support@shopgoldplus.com", "name": "GoldPlus Support"}],
  "merge_info": {"use": "the full matching sample-data JSON here"},
  "track_opens": false,
  "track_clicks": false
}
```

The sample request is explanatory, not ready to send. Replace the entire `merge_info` object. Plain-text files are alternatives for application rendering; configure a text MIME part only if your actual sending path supports it. Uploading the HTML does not by itself install the text alternative.

## Data contract and activation gates

All text substitutions use escaped double braces. No raw customer HTML is accepted. Format amounts before rendering as `UGX 153,000`; use integer UGX arithmetic in your application and verify subtotal + delivery + any actual taxes/adjustments = total. If you charge taxes, discounts or additional fees, extend the totals to itemise them before activating. Do not silently omit an adjustment or charge.

Common: `first_name` (optional; omitted gives “Hello,”), `year`.
Order emails: `order_reference`, `order_date`, `payment_status`, `delivery_location`, `order_url`, `items` (nonempty array of `name`, positive `quantity`, `unit_price`, `line_total`), `subtotal`, boolean `total_confirmed`. When true: `delivery_fee`, `total`. When false, final total is hidden and delivery is explicitly unconfirmed. Use “UGX 0” for a confirmed free delivery fee. Never pass string `"false"` for a boolean. Add actual pickup-specific copy if pickup exists; these fulfilment emails describe delivery.
Payment success additionally requires `amount_received`, `payment_method`, `payment_reference`, `payment_date`. This is a payment acknowledgement, not an EFRIS tax invoice. Use the actual amount received, even if it differs from the order total. Do not claim fully paid unless ledger evidence supports it.
Cancellation optional: `cancellation_reason`, `refund_update`. Populate only from verified records. Never substitute “refunded” for “requested” or “processing.”
Password reset: `reset_url`, `reset_expiry_minutes` from the actual token policy. Example 60-minute expiry was taken from the source; verify it. Enforce single-use and expiry server-side. The email does not promise global sign-out because that behaviour was not verified.
Admin additional: `admin_event_label`, `preparation_state`, `preparation_instruction`, `stock_status`, `customer_name`, `customer_phone`, `delivery_address`; `sku` on each item; `admin_url`. The example admin URL is deliberately a safe homepage placeholder: replace it with the real authenticated order route before use. Do not expose admin details to customer recipients.

URLs must be created by trusted server code and checked against approved HTTPS origins. HTML escaping alone does not prevent malicious URL schemes. Never put credentials, card details or PINs into merge data. Reset URLs are sensitive: do not enable click tracking or put real tokens into sample files/logs. Order links need appropriate authorisation or unguessable signed access; an order reference alone must not expose private records.

Validate required fields before sending: Mustache may silently render missing values as blanks. Reject inconsistent monetary data, invalid URLs, empty order items and event/state mismatches. Re-read current order state before sending queued payment or fulfilment emails; deduplicate events and suppress stale pending/failure emails after payment succeeds. Cancellation, payment and fulfilment are separate states. A payment-cancelled event must not automatically mean an order cancellation. For internal preparation instructions require both verified payment policy and stock gates; do not let an email authorise release.

## Verification and limits

Static review covers all 15 event templates, complete sample rendering, tag balance, money reconciliation and key conditional branches. Browser checks, where available, are recorded in `qa-results.json`. Browser rendering is not Outlook/Gmail inbox certification. Actual ZeptoMail import, recipient delivery, sender authentication, inbox rendering and live event wiring require validation in your account; none are claimed complete here.

Official references checked for this build:
- https://www.zoho.com/zeptomail/help/using-templates.html
- https://www.zoho.com/zeptomail/help/api/dynamic-templates.html
- https://www.zoho.com/zeptomail/help/api/email-templates.html
