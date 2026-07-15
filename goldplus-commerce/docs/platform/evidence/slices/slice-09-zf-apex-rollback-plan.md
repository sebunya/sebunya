# Slice 9-ZF APEX rollback plan

## Current containment

No production rollback is required. This slice made no production overlay, database write, gate change, deployment, migration or service restart. Broad live sends and the internal email canary gate are disabled.

## Local code rollback

If the diagnostic change must be reverted before a future deployment:

1. Revert the Slice 9-ZF commit normally; do not force-push.
2. Verify the original Slice 9-Z guard and transport focused tests.
3. Keep the Slice 9-Y no-send override in place.
4. Confirm public health, admin protection and the five post-run disabled-gate assertions.

The two immutable 9-Z events must not be deleted or rewritten. They truthfully record one attempt and one failed result.

## Forward recovery

Before another canary, obtain provider-side or newly retained bounded failure evidence, identify a concrete remediation, create fresh source/database backups if production will change, use a new correlation ID, rerun eligibility/suppression/withdrawal/policy checks, audit before transport and authorize no more than one internal email attempt.
