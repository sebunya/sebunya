# Slice 10-PR2 APEX path-layout validation

The clean remote retains a repository root above the `goldplus-commerce/` app. The corrected candidate preserves that Git root while exposing the app through a direct-layout candidate symlink:

```text
clone root: /opt/goldplus/app/goldplus-commerce.clean-10pr2-20260715T132508Z.repo
candidate operational root: /opt/goldplus/app/goldplus-commerce.clean-10pr2-20260715T132508Z
candidate target: /opt/goldplus/app/goldplus-commerce.clean-10pr2-20260715T132508Z.repo/goldplus-commerce
HEAD: 6717d877bc0fd2f18d1579fc85647ab6012af7ea
Git status count: 0
.env.production mode: 600; contents not printed
```

The operational root directly resolves `docker-compose.production.yml`, `.env.production`, `Caddyfile`, `apps/`, `packages/`, `pnpm-lock.yaml`, and `package.json`, with no further nested `goldplus-commerce/` directory. Git commands from the candidate resolve the clean clone and exact target HEAD.

Path layout passed. Candidate Compose rendered successfully with production project name `goldplus-commerce`.
