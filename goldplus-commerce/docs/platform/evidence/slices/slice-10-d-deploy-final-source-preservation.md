# Slice 10-D DEPLOY FINAL source preservation

Production source was clean at `2321778f6773f8294f3fe65fb7d08dc6646bc077` before fast-forward.

Fresh preservation path: `/opt/goldplus/backups/slice-10-d-deploy-final-source-preservation-20260715T155351Z`.

The operational source path is a symlink, so the prompt's plain archive preserved the link itself. A second private archive explicitly dereferenced the symlink to preserve the actual source contents. `source-before-dereferenced.tar.gz` is non-empty with SHA-256 `630be9baf0cfdad534bac01dd14458fc5ab7d979bf5dda718e1ed358d54dd3f5`. Backup contents and environment values were not printed or committed.
