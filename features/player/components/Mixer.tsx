"use client";

import {
  Volume2,
  VolumeX,
  Eye,
  EyeOff,
  RotateCcw,
  Music2,
  AudioWaveform,
  Guitar,
  Gauge,
  Music,
  Palette,
  Type,
  Timer,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { ScoreAppearance } from "@/features/library/data/songStore";
import {
  SPEED_PERCENT_MIN,
  SPEED_PERCENT_STEP,
  SPEED_SLIDER_MAX,
} from "@/features/player/data/playbackSpeed";
import { AudioOffsetControl } from "./AudioOffsetControl";
import {
  mediaVolumeIsSettable,
  useAudioContextState,
} from "@/features/player/data/audioEngine";

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
  scoreAppearance: ScoreAppearance;
  onScoreAppearance: (appearance: ScoreAppearance) => void;
  onScoreAppearanceReset: () => void;
  /** A bar of metronome clicks before playback starts. */
  countIn: boolean;
  onCountInToggle: () => void;
  countInDisabled?: boolean;
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
      className="h-0.5 w-full cursor-pointer"
    />
  );
}

function SettingSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5 rounded-sm border border-rule bg-paper px-3 py-2.5">
      <span className="flex items-center gap-2">
        <span className="flex-1 text-xs font-medium text-ink">{label}</span>
        <span className="text-xs tabular-nums text-ink-muted">
          {value}
          {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="h-0.5 w-full cursor-pointer"
      />
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-sm border border-rule bg-paper px-3 py-2.5">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="h-6 w-6 shrink-0 cursor-pointer rounded-sm border border-rule bg-transparent p-0"
      />
      <span className="min-w-0 flex-1 text-xs font-medium text-ink">
        {label}
      </span>
      <span className="font-mono text-[9.5px] uppercase tracking-label text-ink-faint">
        {value}
      </span>
    </label>
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
    <div className="flex flex-col gap-1.5 rounded-sm border border-rule bg-paper px-3 py-2.5">
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
                ? "bg-ink text-paper"
                : "border border-rule text-ink-muted hover:text-ink",
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
              muted ? "text-accent" : "text-ink-muted hover:text-ink",
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
 * Why the levels might not be doing anything.
 *
 * The synth and (on iOS) the recording both play through one `AudioContext`,
 * which browsers keep asleep until a user gesture wakes it — and which iOS
 * additionally parks in `interrupted` after a call or a screen lock. When that
 * happens the sliders move and nothing changes, which is impossible to guess
 * at; saying so beats leaving it silent.
 */
function AudioEngineNote() {
  const state = useAudioContextState();
  if (state === "running") return null;
  return (
    <p
      className="px-1 font-display text-[13px] italic leading-snug text-accent"
      role="status"
    >
      {state === "interrupted"
        ? "Audio was interrupted by the system — press play to start it again."
        : "Audio hasn't started yet — press play to wake it up."}
      {!mediaVolumeIsSettable() &&
        " On iOS the recording level runs through it too."}
    </p>
  );
}

/** A labelled on/off row, styled like the channel strips around it. *//** A labelled on/off row, styled like the channel strips around it. */
function ToggleRow({
  icon,
  label,
  sublabel,
  on,
  onToggle,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={on}
      className="flex items-center gap-2 rounded-sm border border-rule bg-paper px-3 py-2.5 text-left disabled:opacity-50"
    >
      {icon}
      <span className="flex-1">
        <span className="block text-xs font-medium text-zinc-200">{label}</span>
        {sublabel && (
          <span className="block text-[10px] text-zinc-500">{sublabel}</span>
        )}
      </span>
      <span
        className={cn(
          "text-[10px] font-semibold uppercase",
          on ? "text-accent" : "text-zinc-500",
        )}
      >
        {on ? "On" : "Off"}
      </span>
    </button>
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
  scoreAppearance,
  onScoreAppearance,
  onScoreAppearanceReset,
  countIn,
  onCountInToggle,
  countInDisabled,
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
      <aside className="fixed inset-x-0 bottom-0 z-40 flex max-h-[80dvh] flex-col gap-3 rounded-t-sm border-t border-rule bg-paper-raised p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:inset-x-auto md:right-0 md:top-0 md:h-dvh md:max-h-none md:w-72 md:rounded-none md:border-l md:border-t-0 md:pb-3">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-[9.5px] uppercase tracking-label text-ink-muted">
            Mixer
          </h2>
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
            <p className="px-1 font-mono text-[9.5px] uppercase tracking-label text-ink-faint">
              Playback
            </p>
            <div className="flex flex-col gap-1.5 rounded-sm border border-rule bg-paper px-3 py-2.5">
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
                className="h-0.5 w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-45"
              />
            </div>
            <ToggleRow
              icon={<Music className="h-4 w-4 shrink-0 text-zinc-400" />}
              label="Tab only"
              on={tabOnly}
              onToggle={onTabOnlyToggle}
              disabled={tabOnlyDisabled}
            />
            <ToggleRow
              icon={<Timer className="h-4 w-4 shrink-0 text-zinc-400" />}
              label="Count-in"
              sublabel="One bar of clicks before playback"
              on={countIn}
              onToggle={onCountInToggle}
              disabled={countInDisabled}
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between px-1">
              <p className="font-mono text-[9.5px] uppercase tracking-label text-ink-faint">
                Score
              </p>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Reset score appearance"
                onClick={onScoreAppearanceReset}
                className="h-6 w-6"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex items-center gap-2 rounded-sm border border-rule bg-paper px-3 py-2.5">
              <Palette className="h-4 w-4 shrink-0 text-ink-muted" />
              <span className="text-xs font-medium text-ink">Appearance</span>
            </div>
            <SettingSlider
              label="Zoom"
              min={0.75}
              max={2}
              step={0.05}
              value={scoreAppearance.scale}
              unit="x"
              onChange={(scale) =>
                onScoreAppearance({ ...scoreAppearance, scale })
              }
            />
            <SettingSlider
              label="Spacing"
              min={0.35}
              max={2}
              step={0.05}
              value={scoreAppearance.stretch}
              unit="x"
              onChange={(stretch) =>
                onScoreAppearance({ ...scoreAppearance, stretch })
              }
            />
            <div className="flex items-center gap-2 rounded-sm border border-rule bg-paper px-3 py-2.5">
              <Type className="h-4 w-4 shrink-0 text-ink-muted" />
              <span className="text-xs font-medium text-ink">
                Tablature numbers
              </span>
            </div>
            <SettingSlider
              label="Tab number size"
              min={10}
              max={22}
              step={1}
              value={scoreAppearance.tabNumberSize}
              unit="px"
              onChange={(tabNumberSize) =>
                onScoreAppearance({ ...scoreAppearance, tabNumberSize })
              }
            />
            <SettingSlider
              label="Bar number size"
              min={9}
              max={18}
              step={1}
              value={scoreAppearance.barNumberSize}
              unit="px"
              onChange={(barNumberSize) =>
                onScoreAppearance({ ...scoreAppearance, barNumberSize })
              }
            />
            <label className="flex items-center gap-2 rounded-sm border border-rule bg-paper px-3 py-2.5">
              <span className="min-w-0 flex-1 text-xs font-medium text-ink">
                Number font
              </span>
              <select
                value={scoreAppearance.numberFontFamily}
                onChange={(e) =>
                  onScoreAppearance({
                    ...scoreAppearance,
                    numberFontFamily: e.target.value,
                  })
                }
                aria-label="Number font"
                className="h-7 rounded-sm border border-rule bg-paper px-2 text-xs text-ink"
              >
                <option value="Arial">Arial</option>
                <option value="IBM Plex Mono">IBM Plex Mono</option>
                <option value="Serif">Serif</option>
                <option value="Georgia">Georgia</option>
                <option value="Verdana">Verdana</option>
              </select>
            </label>
            <ColorField
              label="Sheet"
              value={scoreAppearance.sheetColor}
              onChange={(sheetColor) =>
                onScoreAppearance({ ...scoreAppearance, sheetColor })
              }
            />
            <ColorField
              label="Ink"
              value={scoreAppearance.inkColor}
              onChange={(inkColor) =>
                onScoreAppearance({ ...scoreAppearance, inkColor })
              }
            />
            <ColorField
              label="Staff lines"
              value={scoreAppearance.staffLineColor}
              onChange={(staffLineColor) =>
                onScoreAppearance({ ...scoreAppearance, staffLineColor })
              }
            />
            <ColorField
              label="Bar numbers"
              value={scoreAppearance.barNumberColor}
              onChange={(barNumberColor) =>
                onScoreAppearance({ ...scoreAppearance, barNumberColor })
              }
            />
          </div>

          {(hasBacking || hasSynth) && (
            <div className="flex flex-col gap-2">
              <p className="px-1 font-mono text-[9.5px] uppercase tracking-label text-ink-faint">
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
              <AudioEngineNote />
              {hasBacking && (
                <div className="rounded-sm border border-rule bg-paper px-3 py-2.5">
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
            <p className="px-1 font-mono text-[9.5px] uppercase tracking-label text-ink-faint">
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
            <p className="px-1 font-display text-[13px] italic leading-snug text-ink-muted">
              The eye picks which part is shown in the tab — and which part the
              synth plays. Level for it is under <em>Mix</em> above.
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}
