# GoldPlus Customer Language Standard

One page. It governs every word a customer can read on shopgoldplus.com, in
the header, in checkout, in the account, in error states, and in any message
we send. Where a sentence fails this standard, the sentence is the defect —
not the customer.

## 1. The six questions

Every screen must let a customer answer, without stopping to interpret:

1. Where am I?
2. What does this mean?
3. What matters to me here?
4. What should I do next?
5. What will happen when I do it?
6. What do I do if it does not work?

## 2. Source of truth

Copy describes the product that is actually running. The hierarchy:

1. Actual running behaviour (checked in production, not assumed)
2. Verified commercial and operational rules
3. Implemented code, configuration and contracts
4. The current approved experience
5. Documentation that still matches the product

If these disagree, fix the disagreement. Never solve it with prettier copy.
Never let copy invent GoldPlus: no product facts, ratings, reviews, stock,
deadlines, discounts, timeframes or channels that the system does not have.

Standing facts to hold (verified 2026-08-26): **email has never delivered**;
SMS does; the only discount is whatever `/commerce/storefront-discount`
returns; points expire (120 days); stock is whatever the catalogue holds.

## 3. Voice

Clear, human, calm, specific, confident. Intelligent adult English that is
completely at home in Kampala. Not corporate, not legal without need, not
Americanised, not Silicon Valley, not an advertising agency, not a committee,
not an AI.

- **Uganda test:** would this sound completely normal to a customer here?
  No forced slang, no unnecessary Luganda, no performative "African" tone.
  Use the words customers use: *rider*, *boda*, *shop*, *Mobile Money*.
- **EAL test:** minimum processing effort, full adult meaning. No idiom,
  metaphor, wordplay, double negatives, abstract nouns, ambiguous pronouns,
  long subordinate clauses. Prefer *Choose how you want to pay* over *Select
  your preferred payment option*.
- **Read-aloud test:** would a good GoldPlus customer-care agent say this on
  the phone? If not, ask why it is on the screen.
- **Translation test:** would the core meaning survive being translated into
  the customer's strongest language?

## 4. Three writing modes

| Mode | Where | Optimise for |
|---|---|---|
| Commercial | homepage, campaigns, category propositions, product selling | controlled personality; every claim true |
| Utility | navigation, cart, checkout, forms, account, orders, search, errors | certainty and speed |
| Trust | payments, warranty, returns, privacy, consent, security | truth, precision, confidence |

Never turn a failed payment into advertising.

## 5. Canonical terms

One word per thing. Do not vary for style.

| Thing | Use | Never |
|---|---|---|
| the purchase | **order** | transaction, purchase, booking, request |
| getting it to the customer | **delivery** | shipping, dispatch (except the tracker's "Dispatched" stage), logistics, routing |
| the person who brings it | **rider** | courier, driver, distribution team |
| money owed | **total** | grand total |
| entering the account | **Sign in** / **Sign out** | log in, login |
| making an account | **Join free** / **Create your account** | register, sign up |
| removing a line | **Remove** | delete |
| the terms page | **Terms of sale** | Terms of Service |
| help | **contact us**, **ask us on WhatsApp**, **call [number]** | back office, support portal, operations team |

Money: `UGX 145,000` — code, non-breaking space, thousands separator, no
decimals, never "145k" on a transaction surface. Numbers: `en-UG`. Phone
examples: `07XX XXX XXX`. Dates: day, short month, year.

## 6. Actions

A label says what pressing it does, and its consequence must match:

- *Place order* creates an order. *Pay for this order* goes to the payment
  page. Neither charges by itself, so neither says "now".
- *Try payment again* appears only when retrying cannot double-charge, and
  says so.
- *Save* persists. *Remove* removes. *Track this order* opens tracking with
  the reference filled in.
- A vague label (*Submit, Continue, Confirm, OK*) is allowed only where the
  consequence is obvious and harmless.
- An unpaid order is never a dead end. Its page and the orders list offer
  *Pay for this order*, which reopens the same order at the payment page (a
  live payment attempt is reused, never duplicated) and, when that cannot be
  done, says why in customer words and offers a person.
- *Send me a code* sends a request, not a code: the acknowledgement says what
  was done. *Set new password* sets it and signs the customer out everywhere.

## 7. Money and status

Every payment state answers the customer's real fear: **what happened to my
money?** Say only what the settlement says. *Pending* and *unknown* mean
"do not pay again — we will check"; they never mean "not charged". A failure
that may include a reversal says the money comes back, not that it never
left. Statuses are never raw enums: every status has a label and one
sentence about what happens next (`orderStatusCopy`).

## 8. Errors and empty states

WHAT HAPPENED → WHAT IT MEANS → WHAT TO DO NEXT. Never "Something went
wrong" when the code knows more. Never an HTTP number, a provider name, a
state-machine word, "not configured", "demo mode", or an internal
instruction ("requires admin review"). Every empty state has a way forward.

## 9. Promises we do not make

- "We've emailed you" / "check your inbox" — until email delivers.
- A discount, code, deadline, stock count or "N left" the system does not
  hold at that moment.
- Response times, refund timings, real-time tracking, "we will call you by
  X" — unless the business has committed to them.
- A visitor's own history used against them ("this is visit 4").

## 10. Account recovery

The phone number is the account, and SMS is the channel that arrives, so
*Reset your password* asks for the phone first and sends a 6 digit code;
email stays as the second option. The page says the same thing whatever is
typed ("If that number is on a GoldPlus account, we have sent it a code"),
never "no account with that number". A wrong, expired, used or unknown code
gets ONE answer and a way to ask for another; only the fifth wrong guess is
told it is locked. The code message says what it is for, that it works once,
when it expires, and that nothing changes if the customer ignores it. The
wording lives in `CustomerMessages` (`PASSWORD_RESET_CODE`); the rules are
pinned by `SmsPasswordReset`.

## 11. Guards

`CustomerCopyNeverLeaksSystemState`, `PaymentReturnTellsTheTruth`,
`HeroSaleFromPromotion`, `NoInventedScarcityInHeader`,
`CustomerMessagesSpeakPlainly`, `SmsPasswordReset`,
`PublicSurfaceBackOfficeLeakage`, `CustomerFacingContentIntegrity`,
`ServiceWorkerInstalls`. They protect the
defect class, not a sentence: realign a test after an intended change; never
weaken it to pass.
