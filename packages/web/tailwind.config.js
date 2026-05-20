/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#f3efe4",
        panel: "rgba(255, 252, 245, 0.88)",
        ink: "#1f1d18",
        muted: "#70695d",
        line: "rgba(38, 31, 19, 0.15)",
        accent: "#0f766e",
        "accent-2": "#b45309",
      },
      fontFamily: {
        serif: [
          "Iowan Old Style",
          "Palatino Linotype",
          "Palatino",
          "Georgia",
          "serif",
        ],
        mono: ["SF Mono", "Fira Code", "monospace"],
      },
      boxShadow: {
        card: "0 20px 50px rgba(31, 29, 24, 0.12)",
      },
    },
  },
  plugins: [],
};
