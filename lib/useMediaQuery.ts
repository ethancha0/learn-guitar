"use client";

import { useEffect, useState } from "react";

/**
 * Matches a CSS media query in React state. Always `false` on the server and on
 * the first client render so hydration agrees; callers that change rendering
 * settings (rather than just classes) should treat the first value as "unknown
 * yet, assume desktop" and re-apply once it settles.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);

  return matches;
}

/** Phone-sized viewport — the breakpoint below Tailwind's `md`. */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}
