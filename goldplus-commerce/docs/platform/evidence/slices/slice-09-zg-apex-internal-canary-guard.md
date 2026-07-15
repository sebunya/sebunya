# Slice 9-ZG APEX internal email diagnostic guard

The pure guard requires all of the following: response capture, `internal_canary`, transactional email provider, internal allowlisted/sandbox classification, recipient hash binding, exactly one recipient, correlation ID, pre-send audit, eligibility, suppression/withdrawal/policy clearance, copy version, credential, sender, host, valid payload, audit table, provider-specific diagnostic mode, one attempt, and broad live-send disabled.

It rejects customer, prospect, checkout, order, support, legacy and unknown recipients; bulk lists; campaign/newsletter identifiers; missing correlation or audit; failed policy/suppression/withdrawal checks; invalid recipient binding; and any broad live-send flag.

The guard locks down after the run. The production API had the diagnostic gate absent after completion.
