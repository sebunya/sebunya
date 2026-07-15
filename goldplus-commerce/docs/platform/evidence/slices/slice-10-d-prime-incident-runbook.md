# Slice 10-D PRIME incident runbook

## Trigger

Treat red status, unavailable counters, duplicate lifecycle groups, any provider/outbox/notification activity, or any send/public-save gate as an incident. Treat amber as a pause-and-investigate condition.

## Immediate operator actions

1. Stop further pilot operations and retain the current read-only posture.
2. Do not run consent saves, grants, withdrawals, retries, provider canaries, or identity provisioning.
3. Preserve the control-room snapshot, relevant aggregate query output, current source head, container identity/start times, and health results without copying secrets or identities.
4. Escalate to the privacy/consent owner and production operator. Add provider operations only when provider activity is the trigger.
5. Verify feature gates through approved configuration tooling without printing environment files. Disable an unsafe gate only through the established change process.
6. Use read-only queries to identify the affected time window and counter class. Do not repair production data during triage.
7. Resume pilot work only after the incident owner records the cause, confirms zero unintended sends or documents their scope, and approves a separately tested remediation.

## Deferred controls

No safe consent-specific operator-state persistence already exists. Automated pause, resume, force-read-only, and all send-enablement controls are therefore deferred. The control room intentionally provides instructions rather than fragile mutation endpoints. `canEnableSends` is permanently false in this slice.
