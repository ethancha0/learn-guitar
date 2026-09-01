"use client";

import { useEffect, useState } from "react";
import { Repeat, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { BarRange } from "@/features/player/data/loopRange";

interface LoopControlProps {
  looping: boolean;
  onToggle: () => void;
  /** The section being looped, or null while the whole song is the loop. */
  range: BarRange | null;
  onRangeChange: (range: BarRange) => void;
  onClear: () => void;
  /** Bar numbers the score actually has, for clamping the inputs. */
  firstBar: number;
  lastBar: number;
  disabled?: boolean;
}

/**
 * Loop toggle plus the bar range it loops over.
 *
 * The range is normally set by dragging across the score (alphaTab's own
 * selection, which reports back through `playbackRangeChanged`); these inputs
 * exist so it can be typed exactly and nudged bar by bar without re-dragging.
 */
export function LoopControl({
  looping,
  onToggle,
  range,
  onRangeChange,
  onClear,
  firstBar,
  lastBar,
  disabled,
}: LoopControlProps) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label={
          range
            ? `Loop bars ${range.startBar} to ${range.endBar}`
            : "Toggle loop"
        }
        title="Loop — drag across the score to pick a section"
        aria-pressed={looping}
        disabled={disabled}
        className={cn(
          "h-10 w-10 shrink-0 md:h-9 md:w-9",
          looping && "text-accent",
        )}
        onClick={onToggle}
      >
        <Repeat className="h-5 w-5 md:h-4 md:w-4" />
      </Button>

      {range && (
        <div className="flex items-center gap-1 rounded-md bg-surface-overlay px-1.5 py-1 text-xs text-zinc-400">
          <BarInput
            label="Loop start bar"
            value={range.startBar}
            min={firstBar}
            max={range.endBar}
            onCommit={(v) => onRangeChange({ ...range, startBar: v })}
          />
          <span aria-hidden>–</span>
          <BarInput
            label="Loop end bar"
            value={range.endBar}
            min={range.startBar}
            max={lastBar}
            onCommit={(v) => onRangeChange({ ...range, endBar: v })}
          />
          <button
            type="button"
            aria-label="Clear loop section"
            title="Clear loop section"
            onClick={onClear}
            className="ml-0.5 rounded p-0.5 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * A bar number that only commits on blur/Enter — typing "12" over a "3" passes
 * through an intermediate "1", and committing that would move the loop (and
 * seek playback) mid-keystroke.
 */
function BarInput({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number.parseInt(draft, 10);
    if (Number.isNaN(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <input
      type="number"
      inputMode="numeric"
      aria-label={label}
      value={draft}
      min={min}
      max={max}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="w-8 bg-transparent text-center tabular-nums text-zinc-100 outline-none [appearance:textfield] focus:text-accent [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
    />
  );
}
