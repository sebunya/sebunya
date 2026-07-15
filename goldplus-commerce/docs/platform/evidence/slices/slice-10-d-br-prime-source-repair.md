# Slice 10-D BR PRIME source repair

Source repair commit: `2321778f6773f8294f3fe65fb7d08dc6646bc077`.

Only `Dockerfile.api`, `Dockerfile.web`, and `tests/unit/Slice10DBRPrimeBaseImageDigestGuard.test.ts` changed. Both unavailable digest occurrences were replaced with the registry-resolved immutable multi-architecture index. Node remains major version 20, Alpine remains the variant, pnpm and build commands remain unchanged, and no application source or production configuration changed.

The focused guard has four assertions covering both production Dockerfiles: exact immutable replacement pin, old digest absent, and floating `node:20-alpine` base absent.
