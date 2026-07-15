# Slice 10-TB APEX clean baseline validation

Validation was run only from the clean continuation checkout. No production command was issued.

Results:

- dependency install with frozen lockfile: passed
- focused Slice 10-C suite: 440/440 passed
- Slice 10-AB2 protected suite: 26/26 passed
- Slice 10-AB protected suite: 22/22 passed
- Slice 9-ZI PRIME protected suite: 8/8 passed
- Slice 9-X PRIME protected suite: 351/351 passed after commit
- Slice 9-B3 protected suite: 260/260 passed after commit
- Slice 8-B1 protected suite: 33/33 passed
- secret scan: passed; 913 source/config files checked without printing values
- workspace typecheck: passed
- lint: passed with zero errors and 598 pre-existing warnings
- build: passed
- full suite: 156 files and 3,701 tests passed after commit

The two legacy artifact-scope sentinels each reported one expected pre-commit failure while the permitted files were intentionally dirty; all their behavioral cases passed. Both passed completely from the clean committed state.

No consent lifecycle, identity provisioning, provider canary, customer communication, database mutation, deployment, service restart, or production migration occurred.
