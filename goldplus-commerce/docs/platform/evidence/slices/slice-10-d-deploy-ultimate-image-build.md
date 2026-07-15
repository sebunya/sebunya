# Slice 10-D DEPLOY ULTIMATE image build

The approved build command was run from production source exactly at `bf87df94e2360d45c4c5ca05e59059f1336885dc`:

`docker compose --env-file .env.production -f docker-compose.production.yml build api web`

The build failed during base-image metadata resolution, before application build stages or new API/web images were produced. Docker Hub reported that the repository-pinned `node:20-alpine` digest `sha256:c13b26e6de602defad90aa7afaf3905581177651a2d59ad0cb233ec7c813350b` was not found.

The hard gate was enforced: no service recreation followed, no Dockerfile or runtime source was edited, and no alternate or unpinned base image was substituted. Decision: `SLICE_10_D_DEPLOY_ULTIMATE_BLOCKED_BY_IMAGE_BUILD`.
