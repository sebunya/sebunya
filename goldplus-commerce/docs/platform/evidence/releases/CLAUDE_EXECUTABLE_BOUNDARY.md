# Claude executable boundary

Machine-readable twin: `CLAUDE_EXECUTABLE_BOUNDARY.json`.

## Classification of every commit after the prior runtime anchor `99563666`

| Commit | Class | Runtime source paths |
|---|---|---|
| `06a1ecb6` | MANIFEST | 0 |
| `9e02375e` | TEST + RELEASE_TOOLING + EVIDENCE | 0 |
| `01141319` | MANIFEST + EVIDENCE | 0 |
| `7d235d75` | MANIFEST | 0 |
| `fe177b04` | MANIFEST + EVIDENCE | 0 |
| `53cbde38` | MANIFEST + RELEASE_TOOLING | 0 |
| `8eff5fb` | **RUNTIME_SOURCE** + TEST | 3 |
| `51b86fb` | **RUNTIME_SOURCE** + TEST | 1 |

`99563666` genuinely was the last runtime-source commit at the audited tip, so the Anti-Gravity
boundary was internally consistent. It is superseded only because the independent audit required
real runtime repairs.

## Selected boundary

- **Executable commit:** `51b86fb5ab0810d75a04492ce5dbf8e80aec901c`
- **Executable tree:** `2eb7edf5805b2f444b430ca5be9a93777ab197d1`
- **Migration ceiling:** `0048` — no new migrations introduced by these repairs
- **Release-package head:** the later docs-only commit (evidence, audit, state, manifests)

Runtime changes inside the executable:

1. `app.ts` — mount the controlled-activation governance router (after `/live-canaries`).
2. `controlled-live-canary.ts` — authentication, per-endpoint RBAC, session-derived identity.
3. `controlled-activation-dry-run.ts` — same, plus the real `DrizzleRoleRepository`.
4. `SupportInboxUseCases.ts` — injectable clock.

## Boundary rules honoured

The executable is immutable once selected; no manifest commit may become the executable; the
executable must be an ancestor of the package head; the executable-to-package diff must contain no
runtime source; and the canonical scope must never contain the package head — which is precisely
the circularity visible in the superseded `fe177b04` / `53cbde38` "sync manifests to HEAD" commits.

## Gates at the executable

Full suite **219 files / 4180 tests PASS** · architecture 4 files / 46 tests PASS · API typecheck
PASS · secret scan PASS (1247 files) · `git diff --check` clean · tree clean · local HEAD == origin.
