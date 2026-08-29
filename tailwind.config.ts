import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./features/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#0f1115",
          raised: "#171a21",
          overlay: "#1e222b",
        },
        accent: {
          DEFAULT: "#4ade80",
          muted: "#22c55e",
        },
      },
    },
  },
  plugins: [],
};

export default config;
