# Slice 10-PR2G FINAL source switch

Pre-switch production source was `/opt/goldplus/app/goldplus-commerce`, branch `phase-1-functional-depth`, HEAD `f69aa6e038fb1bd0964a1cf0cdb6e6ee0208a751`. After approval, candidate validation, lock acquisition, verified preservation, and snapshots, the live source path switched to the exact validated candidate.

Post-switch `/opt/goldplus/app/goldplus-commerce` resolved to the clean candidate backing app root at HEAD `bfa6de64228d6cca602c35e8d217d74cad4696c9` with zero Git-status entries. The old dirty source remains intact at `/opt/goldplus/app/goldplus-commerce.dirty-pre-10pr2g-20260715T142952Z`.

No runtime application code was edited or rebuilt. This was source alignment plus the separately approved Caddy-only restart, not an application deployment.
