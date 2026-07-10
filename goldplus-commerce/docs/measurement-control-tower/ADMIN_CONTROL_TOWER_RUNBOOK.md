# Admin Control Tower Runbook

## Layout
Provides read-only insight into:
- Consent & Preference Volumes
- GTM Automation State
- PesaPal Reconciliation Quality
- Release Readiness Gate status

## RBAC
Strict separation of permissions: Viewers cannot run checks; standard users cannot view the dashboard.

## Empty States and Real Data
Follows the "No-Fake-Metrics" principle. If a queue is empty, the system returns `NO_DATA_AVAILABLE` rather than placeholder digits.
