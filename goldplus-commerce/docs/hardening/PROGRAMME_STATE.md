# GoldPlus hardening — programme state

The machine-readable source is `PROGRAMME_STATE.json`. This file explains it.

**Why this exists:** the previous session's worktree became unreachable and its
only continuation state was the conversation. That state was lost. The repository
is now the memory.

## Where the programme is

| | |
|---|---|
| Branch | `claude/amazon-grade-module-hardening-20260729` |
| Base | `5e6d4ea` |
| Migration ceiling | `0058` |
| Wave | 1 |
| Clean-tree suite | 4547 passed, 0 failed, 11 skipped |

## Modules closed so far

Each carries a committed fix, tests, and — where the claim is about persistence
or concurrency — a proof against a real PostgreSQL 16 or a real `redis-server`.

authentication · authorization · audit · health/liveness/readiness ·
database resilience · outbox · webhooks & payments · inventory ·
notification outbound gating · loyalty ledger integrity

## Checkout is IN PROGRESS, not complete

It was listed as complete after its components passed unit and PostgreSQL tests.
That was wrong, and the reason is worth recording: **a strong component
implementation is not a completed customer journey.**

The real storefront path is browser → Astro SSR → server-side fetch → API. The
API was minting the guest principal, but its `Set-Cookie` lands on the Astro
server's fetch response and never reaches the browser. So every request minted a
fresh identity, and the atomic claim — correct in isolation, proven against real
PostgreSQL — could never match a retry in the path that actually runs.

The same gap hid a second break: the API returned `orderId` while the page read
`res.data.id`, so the PesaPal handoff silently never started and the customer saw
the offline-review message instead of a payment page. Nothing failed loudly.

A module is now only complete when the real caller path, the security boundary,
the retry path, the failure path, the recovery path, the UI contract and a defined
production acceptance all hold.

## What closed most recently

**H-04 — the fingerprint did not cover where the goods go.** It covered the basket,
buyer type, coupon, delivery ZONE and currency, but not the delivery ADDRESS or the
contact details. A customer who spotted a wrong house number, corrected it and
resubmitted with the same key was answered with the earlier order — the goods stayed
bound for the address just corrected away from. Address, phone and email are now
inputs, normalised only for cosmetic differences, under a length-prefixed encoding
(the previous NUL separator is unambiguous only while no field can contain a NUL, and
a JSON string can). `CHECKOUT_POLICY_VERSION` is bumped so v2 values cannot be
compared against v3 ones.

**H-06 — the expiry sweep deleted live commerce.** It deleted on `expires_at` alone.
A checkout at `PAYMENT_STARTED` — a customer slower at the bank page than the 24-hour
TTL — was deleted along with the only record of who owns the order (which payment
start now authorizes against), which side effects are owed, and the idempotency
guarantee itself. Retention is now a function of state, and retained rows are counted
and reported rather than silently skipped.

**H-07 — no cross-site protection on a state-changing POST.** Checkout is a
top-level form POST and there was no origin check at all. Worse, the intent cookie is
SameSite=Lax, so a cross-site POST arrives without it — and the response to a missing
cookie was to MINT a fresh guest identity and carry on. The check now runs before
anything can mint, with `Sec-Fetch-Site` as the primary signal so it needs no
configuration to work.

**H-08 — payment start had no authorization.** It took `orderId` from the request
body and opened a PesaPal transaction against it, so anyone who knew an order id
could start a payment for someone else's order and receive its redirect URL. It also
re-submitted to the provider on every retry, and answered every failure with HTTP 400
carrying the server's own error text. All three are closed.

## Cart and outbound governance, closed

**H-02 — cart routes had no object-level authorization.** Every route took a `cartId`
straight from the request: add to any cart, change any quantity, empty any cart, read
any cart's contents. The id is a v4 UUID and therefore unguessable — but the whole
design rested on that secrecy, and the value travels where a secret must not. It is the
browser's cookie, and on the read route it was a URL PATH SEGMENT, so every basket read
wrote the identifier into access logs, proxy logs, browser history and Referer headers.
The row could not answer "whose cart is this?" either: `user_id`, `session_id` and
`anonymous_id` all existed and none was ever populated, so even a correct check had
nothing to check against. The id now lives inside a signed credential and the owner is
bound and cross-checked against the session.

Two further defects the shape hid: read-modify-write with no concurrency control (two
tabs raced and the loser's change vanished, including a REMOVE undone by a concurrent
UPDATE) and no product validation at all (a withdrawn product could sit in a basket and
reach checkout).

**H-03 — no single outbound-delivery policy.** Each provider interpreted the flags
itself, and they disagreed. A dry run returned `SENT` in BOTH adapters, so a suppressed
message was indistinguishable from a delivered one in every metric and query. The
allowlist ran at a different point in each channel. `PROVIDER_DELIVERY_ENABLED` and
`CUSTOMER_COMMUNICATIONS_ENABLED` were read by neither adapter and enforced only by
convention. There is now one pure ordered policy, and a contradictory configuration
blocks and fails release readiness instead of returning WARN.

## What is still open

**H-01 — inventory constraint not yet validated.** `products_reserved_within_stock`
is `NOT VALID` by design: a pre-existing violation is a commercial problem about
real customer orders, and a migration is not entitled to settle it by refusing to
deploy or by quietly changing data. `scripts/db/inventory-constraint-readiness.sh`
must reach `convalidated = true` against production data before Wave 1 ships.

**H-02 — cart object-level authorization.** Cart routes have not been audited.
The concern is a caller reading or mutating another cart by knowing its id.

**H-03 — no single outbound-delivery policy.** Each provider interprets the
environment flags itself. The gates are currently correct in both providers, but
correctness repeated per-provider is a defect waiting for the third provider.

## What this environment cannot do

Stated plainly because a plan that pretends otherwise is worthless:

- **No macOS host.** Rail B validation requires real `/bin/bash` 3.2.57 on Darwin.
- **No production access.** No `ssh goldplus-prod`, no production credentials.
- **No Docker.** Exact-image builds and Playwright-against-image cannot run here.
- **No human approval marker.** An agent must never create one.

Everything that does not depend on those is in scope here and is being done.

## Resuming

Read `PROGRAMME_STATE.json`, take `nextExactAction`, and continue. Verify the
remote head is a descendant of `currentHead` before editing; never move the branch
backwards.
