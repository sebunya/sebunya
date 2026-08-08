/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        brand: {
          // Canonical GoldPlus tokens — ONE green, the header's (#93D500), so every
          // bg-brand-primary fill matches the navigation across the whole site.
          primary: '#93D500',
          primaryInk: '#456B00', // the ONLY legal green for TEXT on a light surface (5.46:1)
          black: '#0A0A0A',
          charcoal: '#1C1C1C',
          softGrey: '#F7F7F7',
          borderGrey: '#E5E5E5',
          mutedGrey: '#6B6B6B',
          error: '#D93025',
          warning: '#F5A623',
          // --- Back-compat aliases (do not use in new code) ---
          green: '#93D500', // alias of primary
          dark: '#1C1C1C',  // alias of charcoal
          gold: '#93D500',  // alias of primary
        }
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
