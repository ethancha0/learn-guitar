"use client";

import { ChevronLeft, ChevronsLeft, ChevronRight, ChevronsRight, Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

interface AudioOffsetControlProps {
  /** Current alignment offset in ms (positive = delay the recording). */
  offsetMs: number;
  /** Fires on every nudge; the parent debounces persistence. */
  onChange: (nextMs: number) => void;
  onReset: () => void;
  onAutoAlign: () => void;
  autoAligning?: boolean;
  disabled?: boolean;
  /** Transport-bar variant: tighter, no hint text. */
  compact?: boolean;
}

function fmt(ms: number): string {
  const rounded = Math.round(ms);
  return `${rounded > 0 ? "+" : ""}${rounded} ms`;
}

export function AudioOffsetControl({
  offsetMs,
  onChange,
  onReset,
  onAutoAlign,
  autoAligning,
  disabled,
  compact,
}: AudioOffsetControlProps) {
  const nudge = (delta: number) => onChange(offsetMs + delta);

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5",
        compact && "flex-row items-center gap-1",
      )}
    >
      {!compact && (
        <span className="font-mono text-[9.5px] uppercase tracking-label text-ink-faint">
          Audio offset
        </span>
      )}
      <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs text-ink">
        <Button
          variant="outline"
          size="icon"
          aria-label="Offset −100 ms"
          disabled={disabled}
          onClick={() => nudge(-100)}
        >
          <ChevronsLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Offset −10 ms"
          disabled={disabled}
          onClick={() => nudge(-10)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[54px] border-b border-ink pb-0.5 text-center tabular-nums text-ink">
          {fmt(offsetMs)}
        </span>
        <Button
          variant="outline"
          size="icon"
          aria-label="Offset +10 ms"
          disabled={disabled}
          onClick={() => nudge(10)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Offset +100 ms"
          disabled={disabled}
          onClick={() => nudge(100)}
        >
          <ChevronsRight className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label="Auto-align recording"
          disabled={disabled || autoAligning}
          onClick={onAutoAlign}
        >
          {autoAligning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Wand2 className="h-3.5 w-3.5" />
          )}
          {!compact && <span className="ml-1">Auto</span>}
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label="Reset offset"
          disabled={disabled || offsetMs === 0}
          onClick={onReset}
        >
          Reset
        </Button>
      </div>
      {!compact && (
        <p className="font-display text-[13px] italic leading-snug text-ink-muted">
          Positive delays the recording. Adjust while playing until the strums
          line up with the cursor.
        </p>
      )}
    </div>
  );
}
