# Slice 10-D PRIME incident classifier

The classifier is a pure deterministic application service. Identical counters, feature state, and generation time produce identical status and incidents.

Critical/red rules are: any provider callback, provider unsubscribe, outbox row, notification attempt, conservative transport call, duplicate lifecycle group, enabled provider delivery, enabled customer communications, enabled notification delivery, enabled public Preference Centre saves, or requested incident controls without safe operator-state persistence. Counter-source failure also fails closed to red.

The pilot-save gate with no available event timestamp is warning/amber. A disabled monitoring gate is informational and does not conceal other severity. No critical or warning rule produces green.

Recommended actions preserve evidence, force or retain a read-only posture through the operator runbook, and require escalation before further pilot activity. They never recommend enabling a send path.
