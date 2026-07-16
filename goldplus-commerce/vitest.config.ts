import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    // Playwright owns tests/e2e (run via `pnpm test:e2e`); vitest must not
    // try to load @playwright/test specs.
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
  },
});
