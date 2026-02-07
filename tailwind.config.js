/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          900: '#141414',
          800: '#1d1e1f',
          700: '#2b2d30',
          600: '#4C4D4F',
        },
        primary: {
          DEFAULT: '#409eff',
          hover: '#66b1ff',
        }
      }
    },
  },
  plugins: [],
}
