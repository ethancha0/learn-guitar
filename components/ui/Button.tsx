import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Buttons in the "Score" identity are keys on a plate: 2px radius, hairline
 * rules instead of fills, and a Plex Mono label in uppercase. `default` is the
 * inked primary; `ghost` and `outline` are the transport keys.
 */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm font-mono text-[11px] font-semibold uppercase tracking-button transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        default:
          "border border-ink bg-ink text-paper hover:border-ink-muted hover:bg-ink-muted",
        ghost: "bg-transparent text-ink hover:bg-[var(--wash)]",
        outline:
          "border border-rule bg-transparent text-ink hover:bg-[var(--wash)]",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 px-3",
        lg: "h-10 px-5",
        icon: "h-[30px] w-[30px] px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";

/**
 * An engaged transport toggle (loop on, metronome on, mixer open) inverts to
 * ink — a colour tint alone isn't enough signal at this weight.
 */
export const engagedKey = "border-ink bg-ink text-paper hover:bg-ink";
