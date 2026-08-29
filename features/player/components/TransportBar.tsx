"use client";

import { useState } from "react";
import { Play, Pause, SkipBack, Repeat, Bell } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { formatDuration } from "@/features/library/components/formatDuration";
import { defaultPlaybackState } from "../types/playback";

/**
 * Local UI-only transport. State is component-local for now; it moves into a
 * PlayerProvider context once real audio playback exists.
 */
export function TransportBar({ durationSec }: { durationSec: number }) {
  const [state, setState] = useState(defaultPlaybackState);

  return (
    <div className="flex items-center gap-4 rounded-lg border border-white/5 bg-surface-raised px-4 py-3">
      <Button
        variant="ghost"
        aria-label="Restart"
        onClick={() => setState((s) => ({ ...s, positionSec: 0 }))}
      >
        <SkipBack className="h-4 w-4" />
      </Button>

      <Button
        aria-label={state.isPlaying ? "Pause" : "Play"}
        onClick={() => setState((s) => ({ ...s, isPlaying: !s.isPlaying }))}
      >
        {state.isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>

      <div className="flex flex-1 items-center gap-3 text-xs text-zinc-400">
        <span className="tabular-nums">{formatDuration(state.positionSec)}</span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-overlay">
          <div
            className="h-full bg-accent"
            style={{ width: `${(state.positionSec / durationSec) * 100}%` }}
          />
        </div>
        <span className="tabular-nums">{formatDuration(durationSec)}</span>
      </div>

      <label className="flex items-center gap-1 text-xs text-zinc-400">
        Speed
        <select
          value={state.speed}
          onChange={(e) => setState((s) => ({ ...s, speed: Number(e.target.value) }))}
          className="rounded bg-surface-overlay px-1.5 py-1 text-zinc-200"
        >
          {[0.5, 0.75, 1, 1.25, 1.5].map((v) => (
            <option key={v} value={v}>
              {v}x
            </option>
          ))}
        </select>
      </label>

      <Button
        variant="ghost"
        aria-pressed={state.loop !== null}
        aria-label="Toggle loop"
        className={cn(state.loop !== null && "text-accent")}
        onClick={() =>
          setState((s) => ({
            ...s,
            loop: s.loop ? null : { startSec: 0, endSec: durationSec },
          }))
        }
      >
        <Repeat className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        aria-pressed={state.metronome}
        aria-label="Toggle metronome"
        className={cn(state.metronome && "text-accent")}
        onClick={() => setState((s) => ({ ...s, metronome: !s.metronome }))}
      >
        <Bell className="h-4 w-4" />
      </Button>
    </div>
  );
}
