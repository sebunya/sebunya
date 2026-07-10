# UAT Evidence Guide

## Execution
Run UAT tests via: `pnpm vitest run tests/uat/measurement-control-tower/`

## Evidence Capture
- Test logs output redacted identifiers.
- Export test results utilizing standard `--reporter=json` or stdout pipe.

## Data Sharing
**Safe:**
- Test names
- PASS/FAIL/DRY_RUN/CONSENT_BLOCKED counts
- Redacted system IDs

**NEVER Share:**
- Raw emails or phone numbers
- Access tokens, client secrets, PESAPAL_SECRET, PESAPAL_KEY
- payment_token or unredacted evidence logs
