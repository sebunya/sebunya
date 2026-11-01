// Tailwind through PostCSS (Astro 6+ dropped @astrojs/tailwind). Each
// stylesheet names its own config with @config (storefront vs admin), exactly
// as before; autoprefixer is what the integration used to add.
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
