/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#0f1117",
          card: "#1a1d27",
          hover: "#222535",
          border: "#2a2d3e",
        },
        accent: {
          DEFAULT: "#6366f1",
          light: "#818cf8",
          muted: "#312e81",
        },
      },
    },
  },
  plugins: [],
};
