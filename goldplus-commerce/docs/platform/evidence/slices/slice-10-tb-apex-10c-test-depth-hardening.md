# Slice 10-TB APEX 10-C test-depth hardening

The prior focused Slice 10-C suite passed 19 tests, materially below its requested 360–640 target. The hardened suite passes 440 table-driven tests without changing `ConsentPilotRing.ts` or any other runtime file.

Coverage now exercises:

- required cohort and no-send artifact invariants
- absence of provider, queue, checkout, payment, auth, loyalty, and delivery coupling
- valid and invalid cohort caps
- duplicate identity handling before cap enforcement
- allowed and forbidden provisioning channels
- identity normalization, hashing, masking, raw-identity exclusion, and record shape
- valid hash-only allowlist parsing and malformed/raw input rejection
- Ring 1 verification and allowlist requirements
- Ring 2 and Ring 3 block matrices
- anonymous, checkout-only, support-only, legacy, and unknown-imported rejection matrices
- required correlation, idempotency, copy, source, and audit metadata
- provider, queue, campaign, bulk-campaign, newsletter, and unrelated-side-effect rejection
- controlled grant and withdrawal guard decisions
- deterministic idempotency guard replay
- save, withdrawal, public-block, and Ring 3 monitoring counters
- cooldown status reporting with provider sends permanently false
- pilot-ring disable/rollback behavior and masked activity timestamps

The focused count is within target and each generated case varies a bounded domain input or safety combination rather than duplicating an identical assertion.
