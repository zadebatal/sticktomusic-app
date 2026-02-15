/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require("./src/ui/tailwind.config.js")],
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./src/ui/**/*.{tsx,ts,js,jsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
