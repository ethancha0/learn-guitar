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
        <span className="text-xs font-medium text-zinc-300">Audio offset</span>
      )}
      <div className="flex flex-wrap items-center gap-1 text-xs text-zinc-400">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Offset −100 ms"
          disabled={disabled}
          onClick={() => nudge(-100)}
        >
          <ChevronsLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Offset −10 ms"
          disabled={disabled}
          onClick={() => nudge(-10)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="w-16 text-center tabular-nums text-zinc-200">
          {fmt(offsetMs)}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Offset +10 ms"
          disabled={disabled}
          onClick={() => nudge(10)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Offset +100 ms"
          disabled={disabled}
          onClick={() => nudge(100)}
        >
          <ChevronsRight className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
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
          variant="ghost"
          size="sm"
          aria-label="Reset offset"
          disabled={disabled || offsetMs === 0}
          onClick={onReset}
        >
          Reset
        </Button>
      </div>
      {!compact && (
        <p className="text-[11px] leading-snug text-zinc-500">
          Positive delays the recording. Adjust while playing until the strums
          line up with the cursor.
        </p>
      )}
    </div>
  );
}
