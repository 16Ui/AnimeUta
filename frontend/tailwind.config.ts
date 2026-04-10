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
          DEFAULT: '#ff4d4f', // Example ACG Red
          dark: '#cf1322',
        },
        secondary: {
          DEFAULT: '#1890ff', // Example Anime Blue
          dark: '#096dd9',
        }
      }
    },
  },
  plugins: [],
}
