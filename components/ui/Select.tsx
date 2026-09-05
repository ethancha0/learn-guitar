import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/**
 * Lightweight native select. Kept native (rather than a Radix listbox) since
 * the transport only needs a short list of values; styled as a ruled field —
 * ink border, paper fill, Spectral label.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-8 rounded-sm border border-ink bg-paper px-2 font-display text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = "Select";
