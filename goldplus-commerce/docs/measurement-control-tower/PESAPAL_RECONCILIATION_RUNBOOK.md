# PesaPal Reconciliation Runbook

## Verified Payment Source of Truth
Purchases are only registered post-IPN verification against PesaPal servers.

## Duplicate Handling
Identical IPNs/Callbacks are dropped silently with a 200 OK to prevent duplicate purchase measurement.

## Retry Process
Failed reconciliations are recorded and may be picked up by the retry queue.

## What Not To Do
**NEVER manually inject or force a purchase conversion.** The system explicitly forbids `forceReconcile` or manual purchase actions.
