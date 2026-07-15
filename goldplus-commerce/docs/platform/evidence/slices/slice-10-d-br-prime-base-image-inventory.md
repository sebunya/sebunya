# Slice 10-D BR PRIME base-image inventory

Production Compose uses context `.` with `Dockerfile.api` for `api` and `Dockerfile.web` for `web`. These are the only Dockerfiles in the repository and the only production API/web build definitions.

Each Dockerfile has one external base declaration followed by internal `base` stages for builder and runner. Before repair, both external declarations were `FROM node:20-alpine@sha256:c13b26e6de602defad90aa7afaf3905581177651a2d59ad0cb233ec7c813350b AS base`. API and web therefore used separate Dockerfiles but shared the same unavailable Node 20 Alpine pin.

After repair, both pin `node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293`. No floating Node base or other Node major is present.
