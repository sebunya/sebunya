# Slice 10-D BR PRIME digest resolution

Docker Buildx registry inspection against the old immutable reference returned `not found`, reproducing the production build failure without inference.

`docker buildx imagetools inspect node:20-alpine` and `docker manifest inspect node:20-alpine` resolved the current OCI multi-architecture index digest as `sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293`. Its `linux/amd64` manifest is `sha256:afdf98210b07b586eb71fa22ba2e432e058e4cd1304d31ed60888755b8c865fb`.

Production reported Docker architecture `x86_64` and `uname -m` `x86_64`. Pulling the replacement index by digest succeeded on production and Docker selected `amd64/linux`. The multi-architecture index was chosen so the immutable Dockerfile remains portable while resolving to the matching production manifest.
