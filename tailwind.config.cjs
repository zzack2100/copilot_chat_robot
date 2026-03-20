/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/web/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        panel: '#1c1f23',
        steel: '#2b3138',
        edge: '#3c444d',
        critical: '#ef4444',
        high: '#f59e0b',
        ok: '#22c55e',
      },
      boxShadow: {
        panel: '0 24px 60px rgba(0, 0, 0, 0.45)',
      },
    },
  },
  plugins: [],
};
