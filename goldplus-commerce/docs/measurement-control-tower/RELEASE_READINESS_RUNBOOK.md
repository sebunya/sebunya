# Release Readiness Runbook

## Core Principle
Readiness checks validate infrastructure safety. They do NOT act as a Launch mechanism.

## Running Checks
Executed safely via Admin Control Tower UI or API. Requires RUN_CHECKS permission.

## Gate States
- `PASS`: Condition met.
- `FAIL`: Critical error. Blocks release approval.
- `WARN`: Non-critical anomaly.
- `BLOCKED`: Sub-dependency failed.

## Decision Recording
Approval requires 100% of critical gates to pass. An acknowledgement requires a text reason, but you cannot "acknowledge away" a FAIL to a PASS.

**NO LAUNCH BUTTON EXISTS.** Decisions are logged as evidence only.
