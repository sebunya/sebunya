# Slice 10-PR2 APEX restart approval

The required root-only approval file `/root/APPROVE_SLICE_10_PR2_PLANNED_RESTART` was checked before maintenance preparation and again before final verification. It was absent both times.

The prompt itself was not treated as approval. The exact required phrase was not supplied through an approved production mechanism. No live source switch or service restart was performed.

Even if approval had appeared, the candidate Caddy validation failure independently blocked the switch.
