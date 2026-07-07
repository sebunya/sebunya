import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import node from '@astrojs/node';
import sentry from '@sentry/astro';

export default defineConfig({
  output: 'server',
  adapter: node({
    mode: 'standalone'
  }),
  integrations: [
    tailwind(),
    sentry({
      dsn: process.env.PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN,
      sourceMapsUploadOptions: {
        telemetry: false,
      },
    })
  ],
  server: {
    port: 4321
  },
  vite: {
    define: {
      // Injected into the telemetry SDK at build time.
      // The SDK uses this to route beacons to the correct API origin.
      // Without this, sendBeacon would hit the Astro port (4321), not the Hono API (3000).
      __GP_API_BASE__: JSON.stringify(
        process.env.PUBLIC_API_BASE_URL || 'http://localhost:3000'
      ),
    },
  },
});
