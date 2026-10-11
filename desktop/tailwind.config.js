/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#0F2A4A',
          light: '#1A3A5F',
          dark: '#0A1D33',
        },
        accent: {
          DEFAULT: '#14B8A6',
          light: '#2DD4BF',
          dark: '#0F766E',
        },
        background: '#F5F7FA',
        surface: '#FFFFFF',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'card': '12px',
      },
      boxShadow: {
        'card': '0 2px 8px rgba(15, 42, 74, 0.08)',
        'card-hover': '0 4px 16px rgba(15, 42, 74, 0.12)',
      },
    },
  },
  plugins: [],
}
