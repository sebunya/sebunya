# Slice 10-D DEPLOY FINAL rollback plan

The runtime rollback was executed successfully using the fresh Slice 10-D FINAL image tags. The current API containers run image `sha256:4057585542b53b35265d7ab702ecd233048ee47ec3dcaa75a5dd204e011d8638`; web runs `sha256:2caef4d600a6974c471b95ceb670bd662c066f1c4c1a45c40bf81c27ec4f8ea9`. All four restored replicas are healthy.

Production source remains at `d8ad79ea9ce62e1a15dd689145c13a8fb1e073ab` so the API packaging defect can be repaired from clean source evidence. Do not redeploy the failed API image. Repair the ESM/runtime packaging issue in a separate source slice, add an image-start smoke test, build a new immutable candidate, and require fresh deployment approval and rollback tags.

No database or non-target service rollback is required.
