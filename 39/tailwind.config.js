/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        'gpr-dark': '#1A2332',
        'gpr-cyan': '#00E5CC',
        'gpr-orange': '#FF8C42',
        'gpr-red': '#FF4757',
        'gpr-bg': '#0a0e17',
        'gpr-surface': '#131b2b',
        'gpr-border': '#1e2d42',
        'gpr-text': '#c8d6e5',
        'gpr-dim': '#6b7c93',
      },
      fontFamily: {
        sans: ['Noto Sans SC', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
