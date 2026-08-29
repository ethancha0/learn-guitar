"use client";

import { Volume2, VolumeX, Eye, EyeOff, Music2, AudioWaveform, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { AudioOffsetControl } from "./AudioOffsetControl";

export interface MixerTrack {
  index: number;
  name: string;
  /** 0–1.5 volume multiplier. */
  volume: number;
  muted: boolean;
  soloed: boolean;
}

interface MixerProps {
  /** True while the imported mp3 is the clock (synth instruments are silent). */
  recordMode: boolean;
  offsetMs: number;
  onOffsetChange: (nextMs: number) => void;
  onOffsetReset: () => void;
  onAutoAlign: () => void;
  autoAligning?: boolean;
  hasBacking: boolean;
  backing: number;
  backingMuted: boolean;
  onBacking: (v: number) => void;
  onBackingMute: (muted: boolean) => void;
  tracks: MixerTrack[];
  shownTrackIndex: number;
  onShowTrack: (index: number) => void;
  onTrackVolume: (index: number, v: number) => void;
  onTrackMute: (index: number, muted: boolean) => void;
  onTrackSolo: (index: number, soloed: boolean) => void;
  onClose: () => void;
}

function VolumeSlider({
  value,
  max,
  onChange,
  ariaLabel,
}: {
  value: number;
  max: number;
  onChange: (v: number) => void;
  ariaLabel: string;
}) {
  return (
    <input
      type="range"
      min={0}
      max={max}
      step={0.01}
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-1 w-full cursor-pointer accent-accent"
    />
  );
}

function ChannelRow({
  icon,
  label,
  sublabel,
  volume,
  volumeMax = 1,
  hideVolume,
  onVolume,
  muted,
  onMute,
  soloed,
  onSolo,
  shown,
  onShow,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  volume?: number;
  volumeMax?: number;
  hideVolume?: boolean;
  onVolume?: (v: number) => void;
  muted?: boolean;
  onMute?: (m: boolean) => void;
  soloed?: boolean;
  onSolo?: (s: boolean) => void;
  shown?: boolean;
  onShow?: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-surface-overlay px-3 py-2.5">
      <div className="flex items-center gap-2">
        {onShow ? (
          <button
            type="button"
            onClick={onShow}
            aria-label={shown ? `${label} shown in tab` : `Show ${label} in tab`}
            aria-pressed={shown}
            className={cn(
              "shrink-0 transition-colors",
              shown ? "text-accent" : "text-zinc-500 hover:text-zinc-300",
            )}
          >
            {shown ? (
              <Eye className="h-4 w-4" />
            ) : (
              <EyeOff className="h-4 w-4" />
            )}
          </button>
        ) : (
          <span className="shrink-0 text-zinc-400">{icon}</span>
        )}

        <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-200">
          {label}
          {sublabel && (
            <span className="ml-1 text-[10px] font-normal text-zinc-500">
              {sublabel}
            </span>
          )}
        </span>

        {onSolo && (
          <button
            type="button"
            onClick={() => onSolo(!soloed)}
            aria-label={`Solo ${label}`}
            aria-pressed={soloed}
            className={cn(
              "grid h-5 w-5 place-items-center rounded text-[10px] font-bold transition-colors",
              soloed
                ? "bg-accent text-surface"
                : "bg-surface text-zinc-400 hover:text-zinc-200",
            )}
          >
            S
          </button>
        )}

        {onMute && (
          <button
            type="button"
            onClick={() => onMute(!muted)}
            aria-label={muted ? `Unmute ${label}` : `Mute ${label}`}
            aria-pressed={muted}
            className={cn(
              "shrink-0 transition-colors",
              muted ? "text-red-400" : "text-zinc-400 hover:text-zinc-200",
            )}
          >
            {muted ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      {!hideVolume && onVolume && (
        <VolumeSlider
          value={volume ?? 0}
          max={volumeMax}
          onChange={onVolume}
          ariaLabel={`${label} volume`}
        />
      )}
    </div>
  );
}

/** Channel strip for the imported recording + score tracks. */
export function Mixer({
  offsetMs,
  onOffsetChange,
  onOffsetReset,
  onAutoAlign,
  autoAligning,
  hasBacking,
  backing,
  backingMuted,
  onBacking,
  onBackingMute,
  tracks,
  shownTrackIndex,
  onShowTrack,
  onClose,
}: MixerProps) {
  return (
    <aside className="fixed right-0 top-0 z-40 flex h-dvh w-72 flex-col gap-3 border-l border-white/10 bg-surface-raised p-3 shadow-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-200">Mixer</h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Hide mixer"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
        {hasBacking && (
          <div className="flex flex-col gap-2">
            <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Recording
            </p>
            <ChannelRow
              icon={<AudioWaveform className="h-4 w-4" />}
              label="Original recording"
              sublabel="mp3"
              volume={backing}
              onVolume={onBacking}
              muted={backingMuted}
              onMute={onBackingMute}
            />
            <div className="rounded-md bg-surface-overlay px-3 py-2.5">
              <AudioOffsetControl
                offsetMs={offsetMs}
                onChange={onOffsetChange}
                onReset={onOffsetReset}
                onAutoAlign={onAutoAlign}
                autoAligning={autoAligning}
              />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            Instruments
          </p>
          {tracks.map((t) => (
            <ChannelRow
              key={t.index}
              icon={<Music2 className="h-4 w-4" />}
              label={t.name}
              hideVolume
              shown={t.index === shownTrackIndex}
              onShow={() => onShowTrack(t.index)}
            />
          ))}
          <p className="px-1 text-[11px] leading-snug text-zinc-500">
            The eye picks which part is shown in the tab. Audio comes from the
            recording, so instruments have no separate level here.
          </p>
        </div>
      </div>
    </aside>
  );
}
