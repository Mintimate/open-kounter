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
        content: {
          strong: '#f9fafb',
        },
        on: {
          accent: '#ffffff',
        },
        control: {
          DEFAULT: '#2b2d30',
          hover: '#37393d',
          border: '#4C4D4F',
          'border-hover': '#6b7280',
        },
        field: {
          DEFAULT: '#141414',
          disabled: '#1d1e1f',
          border: '#4C4D4F',
          'border-hover': '#6b7280',
        },
        grid: {
          line: '#ffffff0a',
        },
        primary: {
          DEFAULT: '#409eff',
          hover: '#66b1ff',
          dark: '#3a8ee6',
        },
        success: {
          DEFAULT: '#22c55e',
          hover: '#16a34a',
        },
        danger: {
          DEFAULT: '#ef4444',
          hover: '#dc2626',
        },
        warning: {
          DEFAULT: '#f59e0b',
          hover: '#d97706',
        },
      }
    },
  },
  plugins: [],
}
