/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#EA4B14',
          dark: '#C23D0F',
          light: '#F97316',
        },
        secondary: {
          DEFAULT: '#0F172A',
          light: '#64748B',
        },
        surface: '#F6F6F7',
        success: '#22C55E',
        warning: '#F59E0B',
        danger: '#EF4444',
      },
    },
  },
  plugins: [],
};
