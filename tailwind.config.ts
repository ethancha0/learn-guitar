import type { Config } from "tailwindcss";

/**
 * "Score" identity — a print/engraving palette rather than a UI-kit one.
 *
 * Every colour is a CSS custom property declared in `app/globals.css` under
 * `:root` (Paper) and `.dark` (Lamp), so a single token name resolves to the
 * right value in either theme and components need no `dark:` twin on every
 * surface. Channel triplets (not hex) so Tailwind's `/opacity` modifiers still
 * work — `bg-ink/5` compiles to `rgb(22 24 28 / 0.05)`.
 */
const themed = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./features/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: themed("paper"),
          raised: themed("paper-raised"),
          /** The score sheet only. Stays paper-coloured in the dark theme. */
          sheet: themed("paper-sheet"),
        },
        ink: {
          DEFAULT: themed("ink"),
          muted: themed("ink-muted"),
          faint: themed("ink-faint"),
          ghost: themed("ink-ghost"),
        },
        rule: {
          DEFAULT: themed("rule"),
          strong: themed("rule-strong"),
        },
        accent: {
          DEFAULT: themed("accent"),
          muted: themed("accent-muted"),
          wash: "var(--accent-wash)",
        },
        /** Slider tracks and the inactive nav dot — furniture, not text. */
        track: themed("track"),
        dot: themed("dot"),

        // Aliases kept so pre-existing `bg-surface*` classes keep compiling.
        surface: {
          DEFAULT: themed("paper"),
          raised: themed("paper-raised"),
          overlay: themed("paper-raised"),
        },
        // The old chrome reached for `zinc-*` directly in a dozen files. Remap
        // the ramp onto the ink scale so those read correctly in both themes.
        zinc: {
          100: themed("ink"),
          200: themed("ink"),
          300: themed("ink-muted"),
          400: themed("ink-muted"),
          500: themed("ink-faint"),
          600: themed("ink-ghost"),
          700: themed("rule"),
          800: themed("rule"),
          900: themed("paper-raised"),
          950: themed("paper"),
        },
      },
      fontFamily: {
        display: ["var(--font-spectral)", "Spectral", "Georgia", "serif"],
        mono: [
          "var(--font-plex-mono)",
          "IBM Plex Mono",
          "ui-monospace",
          "monospace",
        ],
        // No third family: the stock sans stack is dropped, so anything that
        // still says `font-sans` gets the monospace voice.
        sans: [
          "var(--font-plex-mono)",
          "IBM Plex Mono",
          "ui-monospace",
          "monospace",
        ],
      },
      borderRadius: {
        // Nothing in this identity is rounder than 2px and nothing is a pill,
        // so the whole scale collapses. `rounded-full` is left alone for dots
        // and spinners.
        DEFAULT: "2px",
        sm: "2px",
        md: "2px",
        lg: "2px",
        xl: "2px",
        "2xl": "2px",
        "3xl": "2px",
      },
      boxShadow: {
        // The one shadow in the app: a hard offset under the score sheet.
        sheet: "6px 6px 0 rgba(22, 24, 28, 0.07)",
      },
      letterSpacing: {
        label: "0.18em",
        eyebrow: "0.26em",
        button: "0.14em",
        nav: "0.1em",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
