"use client";

import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

interface BackingVolumeControlProps {
  /** 0–1 */
  volume: number;
  muted: boolean;
  onVolume: (v: number) => void;
  onMuteToggle: () => void;
  disabled?: boolean;
}

/** Always-visible transport control for the imported recording's level. */
export function BackingVolumeControl({
  volume,
  muted,
  onVolume,
  onMuteToggle,
  disabled,
}: BackingVolumeControlProps) {
  return (
    <div className="flex items-center gap-1.5" aria-label="Recording volume">
      <Button
        variant="outline"
        size="icon"
        aria-pressed={muted}
        aria-label={muted ? "Unmute recording" : "Mute recording"}
        className={cn(muted && "text-accent")}
        disabled={disabled}
        onClick={onMuteToggle}
      >
        {muted ? (
          <VolumeX className="h-4 w-4" />
        ) : (
          <Volume2 className="h-4 w-4" />
        )}
      </Button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={muted ? 0 : volume}
        disabled={disabled}
        onChange={(e) => onVolume(Number(e.target.value))}
        aria-label="Recording volume"
        className="slider-hairline h-0.5 w-[88px] shrink-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-45"
      />
    </div>
  );
}
