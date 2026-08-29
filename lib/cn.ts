/**
 * Minimal className joiner. Kept dependency-free on purpose; swap for `clsx` +
 * `tailwind-merge` only if conditional class logic actually gets complex.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
