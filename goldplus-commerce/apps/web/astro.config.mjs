import { defineConfig, passthroughImageService } from 'astro/config';
import node from '@astrojs/node';
import sentry from '@sentry/astro';

// Sentry only when a DSN exists. With no DSN the integration still shipped its
// whole browser SDK to every visitor (the 92 KB `page.*.js` that Lighthouse
// reported as 88% unused, and the only source of legacy polyfills), for an
// error reporter that had nowhere to send anything. Production has never set
// a DSN (checked 2026-09-13).
const sentryDsn = process.env.PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;

export default defineConfig({
  output: 'server',
  // The site never uses astro:assets (images come from the API's own pipeline),
  // so Astro does not decode images at all: no /_image processing, and the
  // AVIF/libheif path behind GHSA-26w7-cxv4-gfx2 cannot be reached.
  image: { service: passthroughImageService() },
  adapter: node({
    mode: 'standalone'
  }),
  integrations: [
    // Tailwind runs through postcss.config.mjs (Astro 6+ has no Tailwind
    // integration). The @tailwind directives live in src/styles/global.css
    // (storefront config) and src/styles/admin.css (full config).
    ...(sentryDsn
      ? [sentry({ dsn: sentryDsn, sourceMapsUploadOptions: { telemetry: false } })]
      : []),
  ],
  build: {
    // Inlining removes the render-blocking stylesheet requests from the first
    // paint of every page. The cost (measured 2026-09-24): the stylesheets are
    // no longer "a few KB" — about 88 KB of CSS (15 KB gzipped) on most pages and
    // 118 KB (21 KB gzipped) on home, re-sent with every document and never
    // cached. Moving to 'auto' (a hashed, cacheable external stylesheet) is a
    // first-paint trade-off: change it only with a Lighthouse Watch before/after.
    inlineStylesheets: 'always',
  },
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
