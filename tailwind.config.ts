import type { Config } from "tailwindcss";

/**
 * Colour tokens are CSS variables so one class can mean two things.
 *
 * `bg-surface` has to be white in the light theme and near-black in the dark
 * one, and there is no way to express that with a hex literal without writing
 * `dark:` on every element in the app. Variables move the decision to one place
 * — `globals.css` — and every existing class keeps working untouched.
 *
 * WHY `rgb(var(--x) / <alpha-value>)` RATHER THAN A PLAIN VAR
 *
 * The variables hold bare channel numbers ("255 255 255"), not colours. That is
 * what lets Tailwind's opacity modifiers keep working: `bg-surface/90` compiles
 * to `rgb(var(--surface) / 0.9)`. Storing "#FFFFFF" in the variable would break
 * every `/opacity` in the codebase.
 *
 * WHAT IS DELIBERATELY *NOT* THEMED
 *
 * `white`, and the accent shades used as button backgrounds — teal 500/600/700,
 * emerald 500/600. Those carry `text-white` labels, so they must stay dark
 * enough for white to read on them in BOTH themes. Only the tint shades (50-300,
 * used as chip and panel backgrounds) and the deep shades (600-900, used as text
 * on those chips) flip.
 */
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  // Toggled by adding/removing `dark` on <html>. See lib/theme.ts.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "rgb(var(--ink) / <alpha-value>)",
          soft: "rgb(var(--ink-soft) / <alpha-value>)",
          faint: "rgb(var(--ink-faint) / <alpha-value>)",
        },
        surface: "rgb(var(--surface) / <alpha-value>)",
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",

        /**
         * Link text. Was `teal-700`, which also serves as a button hover
         * background — one token cannot be both a light link on a dark page and
         * a dark button behind white text.
         */
        link: "rgb(var(--link) / <alpha-value>)",

        teal: {
          50: "rgb(var(--teal-50) / <alpha-value>)",
          100: "rgb(var(--teal-100) / <alpha-value>)",
          200: "rgb(var(--teal-200) / <alpha-value>)",
          // Button backgrounds — identical in both themes so white labels read.
          500: "#0F766E",
          600: "#0D6862",
          700: "#0B5B55",
        },
        indigo: {
          50: "#EEF2FF",
          500: "#4F46E5",
          600: "#4338CA",
        },
        good: {
          50: "rgb(var(--good-50) / <alpha-value>)",
          500: "#059669",
          600: "#047857",
        },
        warn: {
          50: "rgb(var(--warn-50) / <alpha-value>)",
          500: "#C2410C",
          600: "#9A3412",
        },
        amber: {
          50: "rgb(var(--amber-50) / <alpha-value>)",
          100: "rgb(var(--amber-100) / <alpha-value>)",
          200: "rgb(var(--amber-200) / <alpha-value>)",
          300: "rgb(var(--amber-300) / <alpha-value>)",
          500: "#D97706",
          600: "rgb(var(--amber-600) / <alpha-value>)",
          700: "rgb(var(--amber-700) / <alpha-value>)",
          800: "rgb(var(--amber-800) / <alpha-value>)",
          900: "rgb(var(--amber-900) / <alpha-value>)",
        },
        emerald: {
          50: "rgb(var(--emerald-50) / <alpha-value>)",
          200: "rgb(var(--emerald-200) / <alpha-value>)",
          300: "rgb(var(--emerald-300) / <alpha-value>)",
          // Button backgrounds, as above.
          500: "#059669",
          600: "#047857",
          700: "rgb(var(--emerald-700) / <alpha-value>)",
          800: "rgb(var(--emerald-800) / <alpha-value>)",
        },
        red: {
          50: "rgb(var(--red-50) / <alpha-value>)",
          100: "rgb(var(--red-100) / <alpha-value>)",
          200: "rgb(var(--red-200) / <alpha-value>)",
          600: "rgb(var(--red-600) / <alpha-value>)",
          700: "rgb(var(--red-700) / <alpha-value>)",
          800: "rgb(var(--red-800) / <alpha-value>)",
        },
        sky: {
          50: "rgb(var(--sky-50) / <alpha-value>)",
          700: "rgb(var(--sky-700) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          "Inter",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          '"JetBrains Mono"',
          "Menlo",
          "monospace",
        ],
      },
      borderRadius: {
        md: "8px",
        lg: "10px",
        xl: "12px",
      },
      boxShadow: {
        card: "0 1px 2px rgb(var(--shadow) / 0.04)",
        pop: "0 4px 16px rgb(var(--shadow) / 0.08)",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
      },
      animation: {
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [],
};
export default config;
