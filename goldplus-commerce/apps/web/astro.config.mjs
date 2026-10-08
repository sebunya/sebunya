import { defineConfig, passthroughImageService } from 'astro/config';
import node from '@astrojs/node';
import sentry from '@sentry/astro';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

// Files in public/ are copied to the build byte-for-byte, comments included —
// the service worker carried dated developer notes and incident history to
// every visitor. After each build their shipped copies are minified (the
// commented sources stay in the repo, where the tests read them). esbuild is
// the build's own copy, reached through astro -> vite so no new dependency is
// added. A file that cannot be found fails the build: a silent skip would put
// the comments straight back in production.
function minifyPublicAssets() {
  const FILES = [['sw.js', 'js'], ['fonts/faces.css', 'css']];
  return {
    name: 'goldplus:minify-public-assets',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const astroRequire = createRequire(createRequire(import.meta.url).resolve('astro/package.json'));
        const { transform } = createRequire(astroRequire.resolve('vite/package.json'))('esbuild');
        const roots = [dir, new URL('../client/', dir), new URL('client/', dir)];
        for (const [rel, loader] of FILES) {
          const file = roots.map((r) => new URL(rel, r)).find((u) => existsSync(u));
          if (!file) throw new Error(`minify-public-assets: ${rel} not found in the build output`);
          const source = await readFile(file, 'utf8');
          const { code } = await transform(source, { loader, minify: true, legalComments: 'none', target: 'es2020' });
          await writeFile(file, code);
        }
      },
    },
  };
}

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
    minifyPublicAssets(),
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
    build: {
      // Component scripts always ship as files, never inlined. The middleware
      // stamps the CSP nonce only on same-site script FILES (stamping inline
      // scripts would hand it to injected markup), so every script Astro
      // inlined for being under 4 KB ran without one: flagged by the strict
      // policy (report-only today) and blocked the day it is enforced. Every
      // other asset keeps the default 4 KB rule.
      assetsInlineLimit: (filePath) => (/\.m?js$/.test(filePath) ? false : undefined),
    },
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
