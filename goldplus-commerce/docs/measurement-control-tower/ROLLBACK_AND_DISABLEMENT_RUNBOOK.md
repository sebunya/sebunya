# Rollback and Disablement Runbook

## Pausing Measurement Safely
Measurement queues (BullMQ) can be paused without impacting standard checkout operations.

## Keeping Preferences Available
The Preference Centre writes locally to DB and publishes asynchronously. A measurement pause does not break customer-facing consent forms.

## Preserving Audits
Audit trailing is synchronous to the application layer. Disabling outbound measurement routing preserves these local audits.
