"use client";

import { Guitar, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

interface SynthVolumeControlProps {
  /** 0–1 */
  volume: number;
  muted: boolean;
  onVolume: (v: number) => void;
  onMuteToggle: () => void;
  /** Track name, e.g. "Electric Bass (finger)". */
  trackName?: string;
  disabled?: boolean;
}

/**
 * Level for the synthesized reference tone of the *currently displayed* track,
 * sitting alongside the original-recording control.
 */
export function SynthVolumeControl({
  volume,
  muted,
  onVolume,
  onMuteToggle,
  trackName,
  disabled,
}: SynthVolumeControlProps) {
  const label = trackName ? `Synth ${trackName}` : "Synth instrument";
  return (
    <div className="flex items-center gap-1.5" aria-label={label}>
      <Button
        variant="outline"
        size="icon"
        aria-pressed={muted}
        aria-label={muted ? `Unmute ${label}` : `Mute ${label}`}
        title={label}
        className={cn(muted && "text-accent")}
        disabled={disabled}
        onClick={onMuteToggle}
      >
        {muted ? (
          <VolumeX className="h-4 w-4" />
        ) : (
          <Guitar className="h-4 w-4" />
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
        aria-label={`${label} volume`}
        className="h-0.5 w-[88px] shrink-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-45"
      />
    </div>
  );
}
