"use client";

import {
  Volume2,
  VolumeX,
  Eye,
  EyeOff,
  Music2,
  AudioWaveform,
  Guitar,
  Gauge,
  Music,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import {
  SPEED_PERCENT_MIN,
  SPEED_PERCENT_STEP,
  SPEED_SLIDER_MAX,
} from "@/features/player/data/playbackSpeed";
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
  /** Speed label (can exceed 100%) and slider position (capped at 100%). */
  speedPercent: number;
  speedSliderPercent: number;
  onSpeedPercent: (percent: number) => void;
  speedDisabled?: boolean;
  tabOnly: boolean;
  onTabOnlyToggle: () => void;
  tabOnlyDisabled?: boolean;
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
  /** Synthesized reference tone for the track currently shown in the tab. */
  hasSynth: boolean;
  synth: number;
  synthMuted: boolean;
  onSynth: (v: number) => void;
  onSynthMute: (muted: boolean) => void;
  synthTrackName?: string;
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

/**
 * Channel strip for the imported recording + score tracks. A right-hand rail on
 * desktop; on phones it becomes a bottom sheet and doubles as the drawer for
 * the transport controls that don't fit in the bar (speed, notation mode).
 */
export function Mixer({
  speedPercent,
  speedSliderPercent,
  onSpeedPercent,
  speedDisabled,
  tabOnly,
  onTabOnlyToggle,
  tabOnlyDisabled,
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
  hasSynth,
  synth,
  synthMuted,
  onSynth,
  onSynthMute,
  synthTrackName,
  tracks,
  shownTrackIndex,
  onShowTrack,
  onClose,
}: MixerProps) {
  return (
    <>
      {/* Tap-outside-to-close, phone only; the desktop rail sits beside the
          score rather than over it. */}
      <div
        className="fixed inset-0 z-30 bg-black/50 md:hidden"
        onClick={onClose}
        aria-hidden
      />
      <aside className="fixed inset-x-0 bottom-0 z-40 flex max-h-[80dvh] flex-col gap-3 rounded-t-2xl border-t border-white/10 bg-surface-raised p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl md:inset-x-auto md:right-0 md:top-0 md:h-dvh md:max-h-none md:w-72 md:rounded-none md:border-l md:border-t-0 md:pb-3">
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
          <div className="flex flex-col gap-2">
            <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Playback
            </p>
            <div className="flex flex-col gap-1.5 rounded-md bg-surface-overlay px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4 shrink-0 text-zinc-400" />
                <span className="flex-1 text-xs font-medium text-zinc-200">
                  Speed
                </span>
                <span className="text-xs tabular-nums text-zinc-400">
                  {speedPercent}%
                </span>
              </div>
              <input
                type="range"
                min={SPEED_PERCENT_MIN}
                max={SPEED_SLIDER_MAX}
                step={SPEED_PERCENT_STEP}
                value={speedSliderPercent}
                disabled={speedDisabled}
                onChange={(e) => onSpeedPercent(Number(e.target.value))}
                aria-label="Playback speed"
                aria-valuetext={`${speedPercent}%`}
                className="h-1.5 w-full cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <button
              type="button"
              onClick={onTabOnlyToggle}
              disabled={tabOnlyDisabled}
              aria-pressed={tabOnly}
              className="flex items-center gap-2 rounded-md bg-surface-overlay px-3 py-2.5 text-left disabled:opacity-50"
            >
              <Music className="h-4 w-4 shrink-0 text-zinc-400" />
              <span className="flex-1 text-xs font-medium text-zinc-200">
                Tab only
              </span>
              <span
                className={cn(
                  "text-[10px] font-semibold uppercase",
                  tabOnly ? "text-accent" : "text-zinc-500",
                )}
              >
                {tabOnly ? "On" : "Off"}
              </span>
            </button>
          </div>

          {(hasBacking || hasSynth) && (
            <div className="flex flex-col gap-2">
              <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Mix
              </p>
              {hasBacking && (
                <ChannelRow
                  icon={<AudioWaveform className="h-4 w-4" />}
                  label="Original recording"
                  sublabel="mp3"
                  volume={backing}
                  onVolume={onBacking}
                  muted={backingMuted}
                  onMute={onBackingMute}
                />
              )}
              {hasSynth && (
                <ChannelRow
                  icon={<Guitar className="h-4 w-4" />}
                  label={
                    synthTrackName
                      ? `Synth · ${synthTrackName}`
                      : "Synth instrument"
                  }
                  sublabel="tab"
                  volume={synth}
                  onVolume={onSynth}
                  muted={synthMuted}
                  onMute={onSynthMute}
                />
              )}
              {hasBacking && (
                <div className="rounded-md bg-surface-overlay px-3 py-2.5">
                  <AudioOffsetControl
                    offsetMs={offsetMs}
                    onChange={onOffsetChange}
                    onReset={onOffsetReset}
                    onAutoAlign={onAutoAlign}
                    autoAligning={autoAligning}
                  />
                </div>
              )}
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
              The eye picks which part is shown in the tab — and which part the
              synth plays. Level for it is under <em>Mix</em> above.
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}
