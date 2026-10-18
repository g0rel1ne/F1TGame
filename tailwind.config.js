/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        carbon: {
          950: "#08090c",
          900: "#0d0f14",
          850: "#12151c",
          800: "#171b24",
          700: "#1f2530",
          600: "#2b323f",
          500: "#3a4353",
        },
        race: {
          red: "#e10600",
          teal: "#00d2be",
          amber: "#ffb400",
          green: "#10b981",
          blue: "#3b82f6",
        },
      },
      fontFamily: {
        display: ["'Rajdhani'", "'Segoe UI'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 12px 30px -18px rgba(0,0,0,0.9)",
      },
      keyframes: {
        "pulse-fast": {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
        "slide-up": {
          "0%": { transform: "translateY(6px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.97)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "shimmer": {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "pulse-fast": "pulse-fast 0.9s ease-in-out infinite",
        "slide-up": "slide-up 0.25s ease-out both",
        "fade-in": "fade-in 0.3s ease-out both",
        "scale-in": "scale-in 0.2s ease-out both",
        "shimmer": "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [],
};
