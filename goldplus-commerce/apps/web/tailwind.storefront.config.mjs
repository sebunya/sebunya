import base from './tailwind.config.mjs';

/**
 * Storefront Tailwind build (2026-09-13). The single config scanned every admin
 * page too, so the storefront shipped a 170 KB utility stylesheet of which the
 * homepage used a fraction. This config scans everything EXCEPT the admin
 * surfaces; src/styles/global.css selects it with @config. The admin keeps the
 * full config through src/styles/admin.css.
 */
export default {
  ...base,
  content: [
    './src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}',
    '!./src/pages/admin/**',
    '!./src/components/admin/**',
    '!./src/layouts/AdminLayout.astro',
  ],
};
