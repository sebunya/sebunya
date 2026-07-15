# Slice 10-AB APEX consent persistence UAT

## Decision

`SLICE_10_AB_APEX_PILOT_RING_READY_SAVE_BLOCKED_NO_SAFE_IDENTITY`

Production-backed Ring 0 UAT completed with synthetic identity only. Grant, idempotent replay, projection read, withdrawal, final projection read and provider eligibility dry-run were exercised against the consent foundation tables.

Correlation: `slice-10-ab-1784111603029` (synthetic/redacted). Grant persisted, replay returned `already_applied=true`, final state was `withdrawn`, and eligibility was `eligible=false` with `withdrawal_active` and `consent_state_withdrawn` reasons. No provider transport was called.
