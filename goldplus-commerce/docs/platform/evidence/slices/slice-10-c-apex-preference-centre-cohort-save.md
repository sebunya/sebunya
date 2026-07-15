# Slice 10-C APEX Preference Centre cohort save

Two additional cohort identities passed the Ring 1 guard with verified membership, canonical purpose/channel, Preference Centre source, copy version, correlation ID, idempotency key, audit requirement, provider-live-send false and cooldown bypass false.

Each additional identity produced a durable grant, idempotent replay (`already_applied=true`), projection state `granted`, durable withdrawal, final projection `withdrawn`, and provider eligibility `eligible=false` after withdrawal. No provider transport was invoked.
