import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f0f9f6",
          100: "#d8f0e8",
          500: "#0f9d6c",
          600: "#0c7f58",
          700: "#0a6648",
        },
      },
    },
  },
  plugins: [],
};
export default config;
