/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        brand: {
          // Canonical GoldPlus tokens (spec)
          primary: '#A6D146',
          black: '#0A0A0A',
          charcoal: '#1C1C1C',
          softGrey: '#F7F7F7',
          borderGrey: '#E5E5E5',
          mutedGrey: '#6B6B6B',
          error: '#D93025',
          warning: '#F5A623',
          // --- Back-compat aliases (do not use in new code) ---
          green: '#A6D146', // alias of primary
          dark: '#1C1C1C',  // alias of charcoal
          gold: '#A6D146',  // alias of primary - NOT in spec, forces rendering as primary
        }
      },
      fontFamily: {
        // System font stack — zero web-font download, native rendering on
        // every device from feature phones to modern smartphones.
        sans: [
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      }
    },
  },
  plugins: [],
}
