# Operational Handover

## Daily Admin Checks
- Review recent Release Readiness Runs
- Check Admin Control Tower for unexpected PesaPal reconciliation failures
- Ensure no real PII is logged in recent event streams

## Weekly Admin Checks
- Audit Preference Centre consent withdrawal volumes
- Validate GTM Drafts (diff against production)

## Monthly Admin Checks
- Complete Review of RBAC roles for the Measurement Control Tower

## Warnings vs Blockers
- **WARNING:** A configuration issue (e.g. `NOT_CONFIGURED`) or safe fallback execution.
- **BLOCKER:** Any PesaPal webhook dropping payloads due to verification failures or explicit failed critical gates in Release Readiness.

## Handling Failed Gates
When a Release Readiness gate fails, it must be addressed directly in infrastructure. Acknowledgements require a reason but do NOT convert a FAIL to a PASS.
