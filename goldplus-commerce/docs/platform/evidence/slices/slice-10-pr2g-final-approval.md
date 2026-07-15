# Slice 10-PR2G FINAL approval

The operator-created root-only file `/root/APPROVE_SLICE_10_PR2_PLANNED_RESTART` existed before maintenance execution. It had mode 600, contained exactly one line, and matched `APPROVE_SLICE_10_PR2_PLANNED_RESTART` exactly. Codex only verified it and did not create or modify it.

After approval passed, an atomic persistent maintenance lock was acquired at `/opt/goldplus/app/.slice-10-pr2g-maintenance.lockdir` and held through switching, verification, evidence creation, and reconciliation review.
