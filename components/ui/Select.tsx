import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/**
 * Lightweight native select styled to match the shadcn/ui primitives. Kept
 * native (rather than a Radix listbox) since the transport only needs a short
 * list of speed values.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-8 rounded-md border border-white/10 bg-surface-overlay px-2 text-sm text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = "Select";
