"use client";

import { useAllSongs } from "../data/songStore";

const SPELLED = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

/**
 * The catalogue's masthead line. Lives client-side because the count comes
 * from the same store the list does; small counts are spelled the way a
 * printed index would.
 */
export function CatalogueEyebrow() {
  const count = useAllSongs().length;
  const spelled = SPELLED[count] ?? String(count);
  return <>{`Catalogue · ${spelled} ${count === 1 ? "entry" : "entries"}`}</>;
}
