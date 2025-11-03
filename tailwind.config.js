/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  safelist: [
    "text-red-600",
    "text-orange-500",
    "text-yellow-500",
    "text-green-600",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
