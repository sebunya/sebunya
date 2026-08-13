import { defineConfig, configDefaults } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Existing suites only ever did `import type` from the shared package, so it
      // was erased at transform time and never actually resolved. Tests that import
      // real values (the Control Centre registry) need a genuine path.
      '@goldplus/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
      // ioredis is a dependency of apps/api, not of the workspace root, so the
      // root-level vitest run cannot resolve it from a test file. The Redis
      // integration proofs import it directly.
      ioredis: path.resolve(__dirname, 'apps/api/node_modules/ioredis'),
      // Same reason as ioredis: the PostgreSQL parameter-boundary proofs build
      // real drizzle SQL fragments and inspect what would be bound, so the
      // import cannot be erased as a type-only one.
      'drizzle-orm': path.resolve(__dirname, 'apps/api/node_modules/drizzle-orm'),
    },
  },
  test: {
    // Playwright owns tests/e2e (run via `pnpm test:e2e`); vitest must not
    // try to load @playwright/test specs.
    exclude: [...configDefaults.exclude, 'tests/e2e/**', 'tests/e2e-production/**'],
  },
});
