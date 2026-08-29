import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Class name joiner used across the app and by the shadcn/ui primitives in
 * `components/ui`. `clsx` handles conditional logic; `tailwind-merge` dedupes
 * conflicting Tailwind utilities (e.g. `px-2 px-4`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
