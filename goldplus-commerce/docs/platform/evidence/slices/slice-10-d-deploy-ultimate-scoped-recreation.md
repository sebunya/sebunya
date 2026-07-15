# Slice 10-D DEPLOY ULTIMATE scoped recreation

API/web recreation was not executed because the reproducible image build failed. `docker compose up`, `docker compose down`, and `docker compose pull` were not run during the deployment phase.

API replicas retained container IDs `50463e48a89972b891552164d930999cc8ce2984a2efe6d02940b5b811794ed0` and `5758ec8870cbf29f6a569b1b48c9132ceeefaf4356926c6a17da45d5a1233af9`.

Web replicas retained container IDs `eeaa455007daebf3fcb338f70a8541fc48da773b039e5e96a444776d53dba61b` and `8a6d94c90d446be65089034dcfa0bb3ec5df6340a50820bb4461b5a7882aa968`.

Their pre/post image IDs and start times remained identical, and every restart count remained zero.
