# Slice 10-PR PRIME bind-mount safety

Both current and clean-candidate Compose configurations rendered successfully. The current rendered configuration SHA-256 was `a83e1efb70c83505b4cea3d56fdba9f45452b22169ef94b8defa013d3730f553`; the clean candidate configuration SHA-256 was `73b0ad3dd93a39bc3f81dea6ffa7eeb58e9808bbdeea34e11939f38e08ccc5ff`.

Running-container inspection found this live source coupling:

```text
container: goldplus-commerce-caddy-1
mount type: bind
source: /opt/goldplus/app/goldplus-commerce/Caddyfile
target: /etc/caddy/Caddyfile
read/write: true
```

API and web containers do not bind-mount the application source, but the hard gate applies to any running container coupled to the live source path. The source switch was therefore blocked.

The validated remote also has a different path shape: its Git root contains `goldplus-commerce/`, whereas the current operational path is already the app directory inside the older production Git root. A direct directory swap would change the expected Compose path. This requires an explicit path-layout migration plan in addition to planned restart approval.

## Safety matrix

| Gate | Result | Consequence |
| --- | --- | --- |
| CR2 clean validation | Pass | Candidate permitted |
| `e5004f0..d2ec8d88` evidence-only delta | Pass; 8 evidence/handoff files, zero runtime files | `d2ec8d88` permitted |
| Persistent alignment lock | Pass; acquired and released after verification | Exclusive operation window established |
| Full source preservation | Pass; archive and 12-entry manifest verified | Candidate preparation permitted |
| Current Compose validation | Pass | Current configuration readable |
| Clean candidate | Pass; clean `d2ec8d88` | Prepared-only handoff available |
| Candidate Compose validation | Pass from nested app directory | Candidate configuration valid |
| Running source bind mounts | Fail; Caddyfile bind mount present | Live switch forbidden |
| Path-layout compatibility | Fail for direct swap | Planned layout migration required |
| No-restart live source switch | Blocked | No source switch performed |
