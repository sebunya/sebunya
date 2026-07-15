# Slice 10-PR PRIME prepared-only verification

The clean candidate was prepared but the live source was not aligned. Final Compose status remained healthy/running for both API replicas, both web replicas, Caddy, PostgreSQL, and Redis.

Before and after inspection produced identical container IDs, image IDs, creation timestamps, start timestamps, restart counts, and running states. Key runtime records were:

| Container | Container ID | Image ID | Started at | Restart count |
| --- | --- | --- | --- | --- |
| API 1 | `50463e48a89972b891552164d930999cc8ce2984a2efe6d02940b5b811794ed0` | `4057585542b53b35265d7ab702ecd233048ee47ec3dcaa75a5dd204e011d8638` | `2026-07-15T11:33:48.766322025Z` | 0 |
| API 2 | `5758ec8870cbf29f6a569b1b48c9132ceeefaf4356926c6a17da45d5a1233af9` | `4057585542b53b35265d7ab702ecd233048ee47ec3dcaa75a5dd204e011d8638` | `2026-07-15T11:33:48.884513802Z` | 0 |
| Web 1 | `eeaa455007daebf3fcb338f70a8541fc48da773b039e5e96a444776d53dba61b` | `2caef4d600a6974c471b95ceb670bd662c066f1c4c1a45c40bf81c27ec4f8ea9` | `2026-07-15T07:39:04.212754475Z` | 0 |
| Web 2 | `8a6d94c90d446be65089034dcfa0bb3ec5df6340a50820bb4461b5a7882aa968` | `2caef4d600a6974c471b95ceb670bd662c066f1c4c1a45c40bf81c27ec4f8ea9` | `2026-07-15T07:39:04.045560557Z` | 0 |
| Caddy | `6f6e517ee9d02fa4021925866f8925ac1fd4d6c200905469ddfa4a11bf11f2a2` | `86deaf5e3d3408a6ccec08fbb79989783dd26e206ae10bcf78a801dc8c9ab794` | `2026-06-03T10:57:29.364155659Z` | 0 |
| PostgreSQL | `ebb57744324c0dc49f138ca9396dd88152f63ffdb3765522abad0f365af91c9c` | `16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229` | `2026-07-12T20:33:46.62170169Z` | 0 |
| Redis | `32c8a24753941f4ed417dd2491a1424af38e9677ac78321df56c59bbd9b8cf39` | `6ab0b6e7381779332f97b8ca76193e45b0756f38d4c0dcda72dbb3c32061ab99` | `2026-07-13T03:34:44.34918138Z` | 0 |

The alignment lock `/opt/goldplus/app/.source-alignment-10pr-prime.lock` was released only after preservation, candidate, Compose, database, source, mount, and container verification completed.
