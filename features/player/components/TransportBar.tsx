"use client";

import { useState } from "react";
import { Play, Pause, SkipBack, Repeat, Bell } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, engagedKey } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { formatDuration } from "@/features/library/components/formatDuration";
import { defaultPlaybackState } from "../types/playback";

/**
 * Local UI-only transport. State is component-local for now; it moves into a
 * PlayerProvider context once real audio playback exists.
 */
export function TransportBar({ durationSec }: { durationSec: number }) {
  const [state, setState] = useState(defaultPlaybackState);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-sm border border-rule-strong bg-paper-raised px-3 py-2.5 md:gap-4 md:px-4">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Restart"
        onClick={() => setState((s) => ({ ...s, positionSec: 0 }))}
      >
        <SkipBack className="h-4 w-4" />
      </Button>

      <Button
        size="icon"
        aria-label={state.isPlaying ? "Pause" : "Play"}
        onClick={() => setState((s) => ({ ...s, isPlaying: !s.isPlaying }))}
      >
        {state.isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>

      <div className="order-last flex w-full min-w-[10rem] items-center gap-3 font-mono text-xs text-ink-muted md:order-none md:w-auto md:flex-1">
        <span className="tabular-nums">{formatDuration(state.positionSec)}</span>
        <div className="h-0.5 flex-1 overflow-hidden bg-track">
          <div
            className="h-full bg-accent"
            style={{ width: `${(state.positionSec / durationSec) * 100}%` }}
          />
        </div>
        <span className="tabular-nums">{formatDuration(durationSec)}</span>
      </div>

      <label className="flex items-center gap-1 font-mono text-xs text-ink-muted">
        <span className="hidden sm:inline">Speed</span>
        <Select
          value={state.speed}
          onChange={(e) => setState((s) => ({ ...s, speed: Number(e.target.value) }))}
        >
          {[0.5, 0.75, 1, 1.25, 1.5].map((v) => (
            <option key={v} value={v}>
              {v}x
            </option>
          ))}
        </Select>
      </label>

      <Button
        variant="ghost"
        size="icon"
        aria-pressed={state.loop !== null}
        aria-label="Toggle loop"
        className={cn(state.loop !== null && engagedKey)}
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
        size="icon"
        aria-pressed={state.metronome}
        aria-label="Toggle metronome"
        className={cn(state.metronome && engagedKey)}
        onClick={() => setState((s) => ({ ...s, metronome: !s.metronome }))}
      >
        <Bell className="h-4 w-4" />
      </Button>
    </div>
  );
}
