/**
 * Theme state for the two halves of the "Score" identity: Paper (light, the
 * default) and Lamp (dark). Applied as a class on <html>, so every token in
 * `app/globals.css` swaps at once.
 */
export type Theme = "paper" | "lamp";

export const THEME_KEY = "learn-bass.theme";

export function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "lamp"
    : "paper";
}

export function readTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === "paper" || stored === "lamp") return stored;
  } catch {
    // Private browsing: fall through to the system preference.
  }
  return systemTheme();
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "lamp");
}

export function storeTheme(theme: Theme) {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Nothing to do — the choice just won't survive the session.
  }
}

/**
 * Runs before first paint from `app/layout.tsx` to avoid a flash of the wrong
 * theme. Inlined as a string, so it can't import from this module.
 */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t!=="paper"&&t!=="lamp"){t=matchMedia("(prefers-color-scheme: dark)").matches?"lamp":"paper"}if(t==="lamp"){document.documentElement.classList.add("dark")}}catch(e){}`;
