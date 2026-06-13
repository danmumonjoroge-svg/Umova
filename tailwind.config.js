/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#15803d",
        secondary: "#16a34a",
        accent: "#2563eb",
      },
    },
  },
  plugins: [],
};
