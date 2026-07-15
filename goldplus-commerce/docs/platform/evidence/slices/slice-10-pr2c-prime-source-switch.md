# Slice 10-PR2C PRIME source switch

The live source remained `/opt/goldplus/app/goldplus-commerce`, a normal directory on `phase-1-functional-depth` at `f69aa6e038fb1bd0964a1cf0cdb6e6ee0208a751`.

No live source rename, symlink replacement, checkout, reset, clean, copy-over, or switch occurred. No old dirty source directory was created because the dirty source remains live and preserved in place.

The candidate is compatibility-valid and direct-layout-valid, but the approval gate denied the switch. The later approved path must acquire a persistent maintenance lock, capture a fresh preservation pack, snapshot services and the read-only ledger, switch the operational symlink, and restart only Caddy.
