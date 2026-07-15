# Slice 10-D DEPLOY ULTIMATE rollback image tags

Snapshot path: `/opt/goldplus/backups/slice-10-d-deploy-ultimate-image-snapshot-20260715T151813Z`.

Before building, API image `sha256:4057585542b53b35265d7ab702ecd233048ee47ec3dcaa75a5dd204e011d8638` was tagged `goldplus-commerce-api:rollback-slice-10-d-20260715T151813Z`.

Before building, web image `sha256:2caef4d600a6974c471b95ceb670bd662c066f1c4c1a45c40bf81c27ec4f8ea9` was tagged `goldplus-commerce-web:rollback-slice-10-d-20260715T151813Z`.

Both tags were inspected successfully before the build attempt. No rollback retag or recreation was necessary because the build failed before replacing either service image or container.
