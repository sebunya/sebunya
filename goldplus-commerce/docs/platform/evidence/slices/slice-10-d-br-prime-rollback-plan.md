# Slice 10-D BR PRIME rollback plan

No runtime rollback is required because no service was recreated. Existing running containers and their prior images remain unchanged.

If the source pin must be reverted before a later deployment, revert the two Dockerfile lines through a new reviewed source commit; do not restore the known-unavailable digest as a deployment candidate. The pre-10-D runtime rollback image tags from DEPLOY ULTIMATE remain available until a successful deployment is signed off.

The next deployment must build from the repaired immutable digest, verify image IDs, and recreate API/web only under a fresh deployment approval. Caddy, PostgreSQL, and Redis must remain untouched.
