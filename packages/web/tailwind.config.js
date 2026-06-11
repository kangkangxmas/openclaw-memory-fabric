/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#080812",
        panel: "rgba(18, 17, 32, 0.88)",
        ink: "#f7f3ff",
        muted: "#a8a0bd",
        line: "rgba(190, 174, 255, 0.14)",
        accent: "#8b5cf6",
        "accent-2": "#d946ef",
        "panel-2": "#171429",
        "deep": "#05050c",
      },
      fontFamily: {
        serif: ["Inter", "SF Pro Display", "Segoe UI", "Arial", "sans-serif"],
        sans: ["Inter", "SF Pro Display", "Segoe UI", "Arial", "sans-serif"],
        mono: ["SF Mono", "Fira Code", "monospace"],
      },
      boxShadow: {
        card: "0 18px 55px rgba(0, 0, 0, 0.28)",
      },
    },
  },
  plugins: [],
};
