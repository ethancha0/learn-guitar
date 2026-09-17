/**
 * Per-lane string identity shared by the highway and the key row. Literal
 * Tailwind class names (not built from string interpolation) so the JIT
 * scanner picks them up; `css` is the same token as a raw color function, for
 * places that need an inline style (SVG fills, glows).
 */

import type { Lane } from "../types/practice";

export interface LaneColor {
  lane: Lane;
  name: "E" | "A" | "D" | "G";
  border: string;
  bg: string;
  text: string;
  /** The raw custom-property name (`L C H` triplet), for `oklchColor()`. */
  cssVar: string;
}

export const LANE_COLORS: readonly LaneColor[] = [
  {
    lane: 0,
    name: "E",
    border: "border-string-e",
    bg: "bg-string-e",
    text: "text-string-e",
    cssVar: "--string-e",
  },
  {
    lane: 1,
    name: "A",
    border: "border-string-a",
    bg: "bg-string-a",
    text: "text-string-a",
    cssVar: "--string-a",
  },
  {
    lane: 2,
    name: "D",
    border: "border-string-d",
    bg: "bg-string-d",
    text: "text-string-d",
    cssVar: "--string-d",
  },
  {
    lane: 3,
    name: "G",
    border: "border-string-g",
    bg: "bg-string-g",
    text: "text-string-g",
    cssVar: "--string-g",
  },
];

/** `oklch()` for a lane's `cssVar`, with an optional alpha. */
export function oklchColor(cssVar: string, alpha = 1): string {
  return alpha >= 1
    ? `oklch(var(${cssVar}))`
    : `oklch(var(${cssVar}) / ${alpha})`;
}
