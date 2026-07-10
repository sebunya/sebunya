# GTM Safe Operations Runbook

## Available Commands
- `plan`: Reads local definitions.
- `validate`: Checks structure against schema.
- `diff`: Compares against active remote container.
- `create-workspace`: Safely generates a non-destructive remote workspace.
- `create-version-draft`: Safely uploads draft configurations.

## Handling NOT_CONFIGURED
If credentials (GTM_ACCESS_TOKEN) are missing, the system gracefully degrades to `NOT_CONFIGURED`.

## Critical Rule
**There is no publish path in Phase 2.** No `publish-version` or launch endpoints exist. Future deployment requires explicit Phase 3 stakeholder approval.
