# Unproven / partially proven completion claims (Slice 14B, honest register)

Updated 2026-07-16. Everything below is TRUE about the source but NOT yet proven
in its final operating environment — with the exact missing proof.

1. **Production behaviour of anything after `bfa6de6`** — needs the operator-gated
   deployment + read-only post-deploy verification (SSH unavailable here).
2. **PesaPal pending/failed/cancelled payment states** — unit-tested state machine;
   live-path acceptance needs sandbox credentials (no provider calls were made).
3. **Firefox/WebKit rendering** — projects declared; binaries absent in this container.
4. **Lighthouse/CWV lab scores** — requires built-preview run; only bundle-size
   budgets are recorded (within budget).
5. **Screen-reader manual pass** — operator action; semantic/keyboard checks automated.
6. **Provider delivery (email/SMS/WhatsApp), loyalty activation, legal effective
   dates, lifecycle messaging** — deliberately dormant behind operator gates.
7. **Container image build + image-start smoke for the release candidate** — no
   docker daemon in this container; runbook step for the release machine.
8. **Claims that WERE disproven and repaired during acceptance**: fresh-bootstrap
   claim originally relied on an edited historical migration (restored + shimmed,
   14C); loyalty config save 500 (14E); vitest/Playwright runner collision (13B);
   first shim draft over-matched 0028 (14C).
