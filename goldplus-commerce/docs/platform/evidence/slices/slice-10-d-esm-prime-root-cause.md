# Slice 10-D ESM PRIME root cause

Primary cause: the API build emitted bundler-style, extensionless ESM specifiers that plain Node cannot resolve. The missing `dist/config/env` message was the first failure in a compiled graph containing hundreds of relative extensionless specifiers; adding `.js` to that one import would only move the failure.

The shared workspace package also advertised its TypeScript source entrypoint, so a plain-Node compiled image needed the shared package compiled and its image-local runtime entrypoint redirected to `dist/index.js`.

The smallest complete repair is therefore to compile API and shared code as Node-compatible CommonJS, compile the shared package in the API image, and change only the image-local shared package metadata. No feature behavior, environment validation, runtime command, database schema, provider, consent, checkout, auth, Caddy, or web UI was changed.
