"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  Play,
  Pause,
  Square,
  Printer,
  SlidersHorizontal,
  Activity,
  Music,
  Timer,
} from "lucide-react";
import { Button, engagedKey } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/cn";
import { useIsMobile } from "@/lib/useMediaQuery";
import { base64ToBytes } from "@/features/library/data/tabFile";
import {
  getPreferredTrackIndex,
  setPreferredTrackIndex,
  getTabOnly,
  getStoredTabOnly,
  setTabOnly,
  DEFAULT_SCORE_APPEARANCE,
  getScoreAppearance,
  sanitizeScoreAppearance,
  setScoreAppearance,
  getCountIn,
  setCountIn,
  AUDIO_SYNC_KEY,
  AUDIO_SYNC_EVENT,
  getAudioSync,
  patchAudioSync,
  type AudioSyncSettings,
  type ScoreAppearance,
  type StoredSyncMap,
} from "@/features/library/data/songStore";
import { getBackingAudio } from "@/features/player/data/audioStore";
import {
  SPEED_PERCENT_MIN,
  SPEED_PERCENT_STEP,
  SPEED_SLIDER_MAX,
  clampSpeed,
  percentToSpeed,
  speedToPercent,
  speedToSliderPercent,
} from "@/features/player/data/playbackSpeed";
import {
  useBackingSync,
  setPreservesPitch,
} from "@/features/player/data/backingSync";
import {
  SyncMap,
  toAlphaTabBarSyncPoints,
  toAlphaTabFlatSyncPoints,
  type BarTimeline,
} from "@/features/player/data/syncMap";
import { buildPlaybackSyncMap } from "@/features/player/data/buildSyncMap";
import { decodeAudio } from "@/features/player/data/waveform";
import { extractScoreTimeline } from "@/features/player/data/scoreTimeline";
import { OffsetSyncGenerator } from "@/features/player/data/syncGenerator";
import {
  queueAlignment,
  useAlignmentJob,
} from "@/features/player/data/alignmentQueue";
import { installSyncDebug } from "@/features/player/data/syncDebug";
import { verifySyncTransfer } from "@/features/player/data/syncVerify";
import {
  TrackSynth,
  extractTrackNotes,
  type SynthNote,
} from "@/features/player/data/trackSynth";
import {
  barAtTick,
  barRangeToTicks,
  barTickRangesFromLookup,
  clampBarRange,
  ticksToBarRange,
  type BarRange,
  type BarTickRange,
} from "@/features/player/data/loopRange";
import { buildCountInPlan } from "@/features/player/data/countIn";
import {
  captureMediaElement,
  getAudioContext,
  mediaVolumeIsSettable,
  unlockAudio,
  useAudioContextState,
} from "@/features/player/data/audioEngine";
import { playCountIn } from "@/features/player/data/clickTrack";
import { Mixer, type MixerTrack } from "./Mixer";
import { LoopControl } from "./LoopControl";
import { AudioOffsetControl } from "./AudioOffsetControl";
import { BackingVolumeControl } from "./BackingVolumeControl";
import { SynthVolumeControl } from "./SynthVolumeControl";
import { SyncDiagnostics } from "./SyncDiagnostics";

const IS_DEV = process.env.NODE_ENV !== "production";
const MotionButton = motion.create(Button);

// alphaTab's worker/worklet scripts must be same-origin, so its runtime assets
// (script, worker, worklet, music font) are copied to `public/alphatab` and
// served locally. See README.
const ALPHATAB_ASSETS = "/alphatab";

const OFFSET_CLAMP_MS = 5000;
const PERSIST_DEBOUNCE_MS = 400;
/**
 * alphaTab draws at CSS-pixel scale, so on a phone a staff sized for a 1000px
 * sheet leaves fret numbers around 7px tall. Enlarging the notation (and
 * letting alphaTab reflow fewer bars per system) is what makes the tab
 * readable at arm's length — see the Songsterr mobile layout.
 */
const MOBILE_NOTATION_SCALE = 1.35;
/**
 * alphaTab's Gourlay spacing springs are tuned for a wide sheet, so on a phone
 * a bar of eighth notes stretches across the whole width and a system holds one
 * bar. Weakening the springs packs the notes tighter *without* shrinking the
 * glyphs, which is how Songsterr fits two bars per row at a comparable size.
 */
const MOBILE_STRETCH_FORCE = 0.55;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function LoadingScoreOverlay({
  title,
  detail,
  error,
}: {
  title: string;
  detail?: string;
  error?: boolean;
}) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center overflow-hidden bg-paper-raised px-6 text-ink"
      role={error ? "alert" : "status"}
      aria-live="polite"
    >
      <div className="sync-loading-grid" aria-hidden="true" />
      <div className="relative flex w-full max-w-md flex-col items-center gap-5 text-center">
        <div
          className={cn(
            "sync-loading-score",
            error && "sync-loading-score-error",
          )}
          aria-hidden="true"
        >
          <div className="sync-loading-staff">
            <span className="sync-loading-line" />
            <span className="sync-loading-line" />
            <span className="sync-loading-line" />
            <span className="sync-loading-line" />
            <span className="sync-loading-line" />
            {!error && <span className="sync-loading-playhead" />}
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span key={i} className={`sync-loading-note note-${i + 1}`} />
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="font-mono text-[9.5px] uppercase tracking-label text-ink">
            {title}
          </p>
          {detail && (
            <p className="font-display text-[15px] italic text-ink-muted">
              {detail}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface AlphaTabPlayerProps {
  /** Song id, used to load the backing track and remember per-song settings. */
  songId: string;
  /** Base64-encoded Guitar Pro / PowerTab file bytes. */
  tabData: string;
  /**
   * Reports score metadata the masthead shows (tuning, metre). Only alphaTab
   * knows these, and they arrive asynchronously as the score loads.
   */
  onScoreMeta?: (meta: ScoreMeta) => void;
}

/** Metadata the player lifts out of the loaded score for the page masthead. */
export interface ScoreMeta {
  /** Space-separated open strings, low to high, e.g. `E A D G`. */
  tuning?: string;
  /** Time signature of the opening bar, e.g. `4/4`. */
  metre?: string;
}

/**
 * Renders an imported multi-track tab with alphaTab in `EnabledExternalMedia`
 * mode: the imported mp3 is the time source and alphaTab's cursor is locked to
 * it (see `backingSync.ts`). Includes an instrument picker (drives which staff is
 * shown), a per-song alignment offset (Auto-align + nudge), and a prominent
 * recording-volume control. alphaTab's synthesizer is silent in this mode.
 */
export function AlphaTabPlayer({
  songId,
  tabData,
  onScoreMeta,
}: AlphaTabPlayerProps) {
  // Held in a ref so a new callback identity from the parent can't restart the
  // alphaTab setup effect.
  const onScoreMetaRef = useRef(onScoreMeta);
  onScoreMetaRef.current = onScoreMeta;

  const hostRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const backingAudioRef = useRef<HTMLAudioElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiRef = useRef<any>(null);
  // The loaded alphaTab module, kept for its enums after setup.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const alphaTabRef = useRef<any>(null);
  // Read by the position listener so a drag doesn't fight the playhead.
  const scrubbingRef = useRef(false);
  const offsetPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backingPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True while *we* are writing sync settings, so the same-tab change event we
  // just caused doesn't bounce back and overwrite state a drag is still editing.
  const selfWritingSyncRef = useRef(false);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [playerReady, setPlayerReady] = useState(false);
  const [audioMetaReady, setAudioMetaReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [speed, setSpeed] = useState(1);

  // Loop section. `loopTicks` is what alphaTab actually plays; the bar numbers
  // shown in the UI are derived from it, so a range picked by dragging on the
  // score and one typed into the control are the same state.
  const [looping, setLooping] = useState(false);
  const [loopTicks, setLoopTicks] = useState<{
    startTick: number;
    endTick: number;
  } | null>(null);
  const [barTicks, setBarTicks] = useState<BarTickRange[]>([]);

  // Count-in: a bar of clicks before playback starts (see `countIn.ts`).
  const [countInEnabled, setCountInEnabled] = useState(false);
  const [countInLeft, setCountInLeft] = useState(0);
  const cancelCountInRef = useRef<(() => void) | null>(null);
  const countInTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const playerFinishedRef = useRef<() => void>(() => {});
  // Set only where `audio.volume` is ignored (iOS): the recording's level then
  // comes from this gain node instead. See the level effect below.
  const backingGainRef = useRef<GainNode | null>(null);

  // Instrument / track state
  const [tracks, setTracks] = useState<MixerTrack[]>([]);
  const [trackNames, setTrackNames] = useState<string[]>([]);
  const [tuning, setTuning] = useState<string>("");
  const [selectedTrack, setSelectedTrack] = useState(0);
  // Read from localStorage after mount so the server and client agree on the
  // first render; the renderer itself is configured from the stored value.
  const [tabOnly, setTabOnlyState] = useState(false);
  const isMobile = useIsMobile();
  // What the renderer is currently configured with, so screen-size changes
  // don't trigger a re-render of the whole sheet on every unrelated state pass.
  const appliedDisplayRef = useRef({
    tabOnly: false,
    scale: 1,
    stretch: 1,
    tabNumberSize: DEFAULT_SCORE_APPEARANCE.tabNumberSize,
    barNumberSize: DEFAULT_SCORE_APPEARANCE.barNumberSize,
    numberFontFamily: DEFAULT_SCORE_APPEARANCE.numberFontFamily,
    inkColor: DEFAULT_SCORE_APPEARANCE.inkColor,
    staffLineColor: DEFAULT_SCORE_APPEARANCE.staffLineColor,
    barNumberColor: DEFAULT_SCORE_APPEARANCE.barNumberColor,
  });
  const [scoreAppearance, setScoreAppearanceState] = useState<ScoreAppearance>(
    DEFAULT_SCORE_APPEARANCE,
  );

  // Recording + calibration state
  const [mixerOpen, setMixerOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  const [hasBacking, setHasBacking] = useState(false);
  const [backingVol, setBackingVol] = useState(0.85);
  const [backingMuted, setBackingMuted] = useState(false);
  const [offsetMs, setOffsetMs] = useState(0);
  const [storedSyncMap, setStoredSyncMap] = useState<StoredSyncMap | null>(null);
  const [dtwStatus, setDtwStatus] =
    useState<AudioSyncSettings["dtwStatus"]>();
  const [syncSettingsLoaded, setSyncSettingsLoaded] = useState(false);
  const [barTimeline, setBarTimeline] = useState<BarTimeline | null>(null);

  // Three candidate recording lengths, least trustworthy last. `<audio>.duration`
  // is an estimate from the bitrate header for VBR mp3s read from a blob URL, and
  // `SyncMap.sanitize()` drops sync points that map past it — so trusting it here
  // deleted end-of-song anchors that the sync-debug page (which decodes the file)
  // had happily applied. That mismatch is why a correction could look applied in
  // the debugger and do nothing during playback.
  const [decodedDurationSec, setDecodedDurationSec] = useState(0);
  const [storedDurationSec, setStoredDurationSec] = useState(0);
  const [elementDurationSec, setElementDurationSec] = useState(0);
  const audioDurationSec =
    decodedDurationSec || storedDurationSec || elementDurationSec;

  // Synthesized reference tone for the displayed track (see trackSynth.ts).
  const [synthVol, setSynthVol] = useState(0.6);
  const [synthMuted, setSynthMuted] = useState(false);
  const [synthNoteCount, setSynthNoteCount] = useState(0);
  const synthRef = useRef<TrackSynth | null>(null);
  const audioContextState = useAudioContextState();
  const synthPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoAligning, setAutoAligning] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | undefined>();
  // Alignment runs in a shared queue, so a job started by the import dialog
  // before this player mounted shows up here too.
  const alignmentJob = useAlignmentJob(songId);
  const dtwRunning =
    alignmentJob?.state === "queued" || alignmentJob?.state === "running";

  // Score length: prefer the bar timeline (known as soon as the score loads);
  // `playerPositionChanged.endTime` only arrives once playback/seek happens, and
  // building the map from a 0 there silently produced a 1:1 mapping.
  const scoreDurationSec =
    barTimeline?.endSec ?? (durationMs > 0 ? durationMs / 1000 : 0);

  /**
   * The canonical score↔audio mapping, plus *why* it is what it is. `syncSource`
   * is surfaced in the UI so a fallback can never be mistaken for a real
   * alignment (previously a stored map that failed validation fell back to a
   * straight line with no indication).
   */
  /**
   * Persist sync settings. `patchAudioSync` dispatches its change event
   * synchronously, so flagging the write here is enough for our own listener to
   * ignore the echo.
   */
  const persistSync = useCallback(
    (patch: Partial<AudioSyncSettings>) => {
      selfWritingSyncRef.current = true;
      try {
        patchAudioSync(songId, patch);
      } finally {
        selfWritingSyncRef.current = false;
      }
    },
    [songId],
  );

  const { syncMap, syncSource, syncWarning, anchors } = useMemo(() => {
    return buildPlaybackSyncMap({
      stored: storedSyncMap,
      offsetMs,
      scoreEndSec: scoreDurationSec,
      audioDurationSec,
    });
  }, [storedSyncMap, offsetMs, scoreDurationSec, audioDurationSec]);

  // Manual anchors are vertices alphaTab has to be told about explicitly:
  // neither bar-downbeat sampling nor Douglas–Peucker simplification would keep
  // a mid-bar correction on its own.
  const anchorScoreTimes = useMemo(
    () => anchors.map((a) => a.scoreTime),
    [anchors],
  );

  const flatSyncPoints = useMemo(() => {
    if (!syncMap || !barTimeline) return null;
    if (syncSource === "dtw") {
      return toAlphaTabBarSyncPoints(syncMap, barTimeline, {
        requiredScoreTimes: anchorScoreTimes,
      });
    }
    return toAlphaTabFlatSyncPoints(
      syncMap.simplify(0.02, { protectedScoreTimes: anchorScoreTimes }),
      barTimeline,
    );
  }, [syncMap, barTimeline, syncSource, anchorScoreTimes]);

  // alphaTab's own score clock for the points it currently holds. Read back so
  // the offsets can be re-derived against it — see `compensateFlatSyncPoints`.
  const readGeneratedSyncPoints = useCallback(() => {
    const score = apiRef.current?.score;
    const generator = alphaTabRef.current?.midi?.MidiFileGenerator;
    if (!score || !generator?.generateSyncPoints) return null;
    return generator.generateSyncPoints(score);
  }, []);

  const { onStateChanged, applySync } = useBackingSync({
    songId,
    apiRef,
    audioRef: backingAudioRef,
    syncMap,
    flatSyncPoints,
    trustedAudioDurationSec: audioDurationSec || null,
    playerReady,
    audioMetaReady,
    getGeneratedSyncPoints: readGeneratedSyncPoints,
  });

  const renderTrack = useCallback((index: number) => {
    const api = apiRef.current;
    if (!api?.score) return;
    const track = api.score.tracks[index];
    if (!track) return;
    api.renderTracks([track]);

    const staff = track.staves?.[0];
    const midi: number[] = staff?.tuning ?? [];
    const nextTuning = midi.length
      ? [...midi]
          .reverse()
          .map((m) => NOTE_NAMES[((m % 12) + 12) % 12])
          .join(" ")
      : "";
    setTuning(nextTuning);
    onScoreMetaRef.current?.({ tuning: nextTuning || undefined });
  }, []);

  const syncSynthPlayback = useCallback((forcePlaying = false) => {
    const synth = synthRef.current;
    const audio = backingAudioRef.current;
    if (!synth || !audio) return;
    const shouldPlay = forcePlaying || (!audio.paused && !audio.ended);
    if (shouldPlay) {
      synth.start(audio.currentTime, audio.playbackRate || 1);
    } else {
      synth.stop();
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let api: any; // eslint-disable-line @typescript-eslint/no-explicit-any

    (async () => {
      try {
        const alphaTab = await import("@coderline/alphatab");
        if (disposed || !hostRef.current) return;
        alphaTabRef.current = alphaTab;

        // Turbopack rewrites `import.meta.url` inside alphaTab's ESM build so it
        // fails to recognise itself as a browser module, then falls back to a
        // classic worker that `importScripts()` an ES module and silently hangs.
        // Force the module-worker code path and point its worker/worklet lookups
        // at the copies we serve from `public/alphatab`.
        const NativeURL = window.URL;
        const env = alphaTab.Environment as unknown as { webPlatform: number };
        env.webPlatform = alphaTab.WebPlatform.BrowserModule;
        Object.defineProperty(alphaTab.Environment, "alphaTabUrl", {
          configurable: true,
          get() {
            return function alphaTabUrl(relative: string, base: string) {
              if (
                typeof relative === "string" &&
                /alphaTab\.(worker|worklet)/.test(relative)
              ) {
                return new NativeURL(
                  `${ALPHATAB_ASSETS}/${relative.replace(/^\.?\//, "")}`,
                  window.location.origin,
                );
              }
              return new NativeURL(relative, base);
            };
          },
        });

        api = new alphaTab.AlphaTabApi(hostRef.current, {
          core: {
            fontDirectory: `${ALPHATAB_ASSETS}/font/`,
            scriptFile: `${ALPHATAB_ASSETS}/alphaTab.min.mjs`,
            // Render the whole sheet up front; the lazy viewport-based renderer
            // draws nothing inside this fixed-height scroll container.
            enableLazyLoading: false,
          },
          display: {
            staveProfile: getTabOnly()
              ? alphaTab.StaveProfile.Tab
              : alphaTab.StaveProfile.Default,
          },
          player: {
            // The imported mp3 is the clock; alphaTab follows it and its own
            // synthesizer stays silent. See `backingSync.ts`.
            playerMode: alphaTab.PlayerMode.EnabledExternalMedia,
            enableCursor: true,
            enableAnimatedBeatCursor: true,
            enableElementHighlighting: true,
            scrollElement: viewportRef.current ?? undefined,
            nativeBrowserSmoothScroll: true,
          },
        });
        apiRef.current = api;
        const storedAppearance = getScoreAppearance();
        setScoreAppearanceState(storedAppearance);
        appliedDisplayRef.current = {
          tabOnly: getTabOnly(),
          scale: 0,
          stretch: 0,
          tabNumberSize: 0,
          barNumberSize: 0,
          numberFontFamily: "",
          inkColor: "",
          staffLineColor: "",
          barNumberColor: "",
        };
        if (process.env.NODE_ENV !== "production") {
          // Debug handle for manual sync inspection in the browser console.
          (window as unknown as { __alphaTabApi?: unknown }).__alphaTabApi = api;
        }

        api.error.on((err: unknown) => {
          console.error("[AlphaTabPlayer] alphaTab error", err);
          if (!disposed) setStatus("error");
        });
        api.renderFinished.on(() => {
          if (!disposed) setStatus("ready");
        });
        api.playerReady.on(() => {
          if (!disposed) setPlayerReady(true);
        });
        // Also fires on every loop wrap, which is where the per-repeat
        // count-in hangs off. Through a ref because this handler is registered
        // once per song but has to see the current loop/count-in settings.
        api.playerFinished.on(() => {
          if (!disposed) playerFinishedRef.current();
        });
        api.playerStateChanged.on((e: { state: number }) => {
          if (disposed) return;
          const isPlaying = e.state === 1;
          setPlaying(isPlaying);
          onStateChanged(isPlaying);
          syncSynthPlayback(isPlaying);
        });
        api.playerPositionChanged.on(
          (e: { currentTime: number; endTime: number; isSeek: boolean }) => {
            if (disposed) return;
            setDurationMs(e.endTime);
            if (!scrubbingRef.current) setPositionMs(e.currentTime);
          },
        );
        // Fires for our own range changes *and* for alphaTab's built-in
        // drag-across-the-score selection, so both land in the same state.
        api.playbackRangeChanged.on(
          (e: {
            playbackRange: { startTick: number; endTick: number } | null;
          }) => {
            if (disposed) return;
            setLoopTicks(
              e.playbackRange
                ? {
                    startTick: e.playbackRange.startTick,
                    endTick: e.playbackRange.endTick,
                  }
                : null,
            );
          },
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        api.scoreLoaded.on((score: any) => {
          if (disposed) return;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const scoreTracks: any[] = score.tracks ?? [];
          const names = scoreTracks.map(
            (t, i) => t.name || t.shortName || `Track ${i + 1}`,
          );
          setTrackNames(names);
          setTracks(
            scoreTracks.map((t, i) => ({
              index: i,
              name: names[i],
              volume: 1,
              muted: Boolean(t.playbackInfo?.isMute),
              soloed: Boolean(t.playbackInfo?.isSolo),
            })),
          );

          // Metre is read off the opening bar; a score with none reports
          // nothing and the masthead shows an em dash.
          const firstBar = score.masterBars?.[0];
          const num = firstBar?.timeSignatureNumerator;
          const den = firstBar?.timeSignatureDenominator;
          if (num && den) {
            onScoreMetaRef.current?.({ metre: `${num}/${den}` });
          }

          const stored = getPreferredTrackIndex(songId);
          const initial =
            stored !== undefined && stored >= 0 && stored < scoreTracks.length
              ? stored
              : 0;
          setSelectedTrack(initial);
          renderTrack(initial);
        });

        api.load(base64ToBytes(tabData));
      } catch (err) {
        console.error("[AlphaTabPlayer] setup failed", err);
        if (!disposed) setStatus("error");
      }
    })();

    return () => {
      disposed = true;
      try {
        api?.destroy();
      } catch {
        /* noop */
      }
      apiRef.current = null;
      alphaTabRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabData, songId]);

  // Bar → tick table for the loop section. alphaTab builds its tick cache when
  // it generates the MIDI, which is after `scoreLoaded`, so this waits for the
  // player instead.
  useEffect(() => {
    if (!playerReady) return;
    setBarTicks(barTickRangesFromLookup(apiRef.current?.tickCache?.masterBars));
  }, [playerReady, tabData]);

  /** Push notation size + stave profile into alphaTab, re-rendering only on a
   *  real change (each render redraws the whole sheet). */
  const applyDisplay = useCallback(
    (
      next: {
        tabOnly: boolean;
        scale: number;
        stretch: number;
      } & Pick<
        ScoreAppearance,
        | "tabNumberSize"
        | "barNumberSize"
        | "numberFontFamily"
        | "inkColor"
        | "staffLineColor"
        | "barNumberColor"
      >,
    ) => {
      const api = apiRef.current;
      const alphaTab = alphaTabRef.current;
      if (!api || !alphaTab) return;
      const applied = appliedDisplayRef.current;
      if (
        applied.tabOnly === next.tabOnly &&
        applied.scale === next.scale &&
        applied.stretch === next.stretch &&
        applied.tabNumberSize === next.tabNumberSize &&
        applied.barNumberSize === next.barNumberSize &&
        applied.numberFontFamily === next.numberFontFamily &&
        applied.inkColor === next.inkColor &&
        applied.staffLineColor === next.staffLineColor &&
        applied.barNumberColor === next.barNumberColor
      )
        return;
      appliedDisplayRef.current = next;
      api.settings.display.staveProfile = next.tabOnly
        ? alphaTab.StaveProfile.Tab
        : alphaTab.StaveProfile.Default;
      api.settings.display.scale = next.scale;
      api.settings.display.stretchForce = next.stretch;
      const resources = api.settings.display.resources;
      resources.tablatureFont = new alphaTab.model.Font(
        next.numberFontFamily,
        next.tabNumberSize,
      );
      resources.barNumberFont = new alphaTab.model.Font(
        next.numberFontFamily,
        next.barNumberSize,
      );
      resources.mainGlyphColor = alphaTab.model.Color.fromJson(next.inkColor);
      resources.scoreInfoColor = alphaTab.model.Color.fromJson(next.inkColor);
      resources.staffLineColor = alphaTab.model.Color.fromJson(
        next.staffLineColor,
      );
      resources.barNumberColor = alphaTab.model.Color.fromJson(
        next.barNumberColor,
      );
      api.updateSettings();
      api.render();
    },
    [],
  );

  // Phones get bigger notation, and tab-only by default: two staves per system
  // halves the size of the one that matters. An explicit preference wins.
  // `status` is a dependency so this still lands when the viewport is measured
  // before alphaTab finishes loading.
  useEffect(() => {
    const nextTabOnly = getStoredTabOnly() ?? isMobile;
    setTabOnlyState(nextTabOnly);
    applyDisplay({
      tabOnly: nextTabOnly,
      scale:
        scoreAppearance.scale * (isMobile ? MOBILE_NOTATION_SCALE : 1),
      stretch:
        scoreAppearance.stretch * (isMobile ? MOBILE_STRETCH_FORCE : 1),
      tabNumberSize: scoreAppearance.tabNumberSize,
      barNumberSize: scoreAppearance.barNumberSize,
      numberFontFamily: scoreAppearance.numberFontFamily,
      inkColor: scoreAppearance.inkColor,
      staffLineColor: scoreAppearance.staffLineColor,
      barNumberColor: scoreAppearance.barNumberColor,
    });
  }, [isMobile, status, scoreAppearance, applyDisplay]);

  function updateScoreAppearance(next: ScoreAppearance) {
    const sanitized = sanitizeScoreAppearance(next);
    setScoreAppearanceState(sanitized);
    setScoreAppearance(sanitized);
  }

  function resetScoreAppearance() {
    updateScoreAppearance(DEFAULT_SCORE_APPEARANCE);
  }

  function toggleTabOnly() {
    const next = !tabOnly;
    setTabOnlyState(next);
    setTabOnly(next);
    applyDisplay({
      tabOnly: next,
      scale: appliedDisplayRef.current.scale,
      stretch: appliedDisplayRef.current.stretch,
      tabNumberSize: scoreAppearance.tabNumberSize,
      barNumberSize: scoreAppearance.barNumberSize,
      numberFontFamily: scoreAppearance.numberFontFamily,
      inkColor: scoreAppearance.inkColor,
      staffLineColor: scoreAppearance.staffLineColor,
      barNumberColor: scoreAppearance.barNumberColor,
    });
  }

  // Load the imported mp3 backing track + persisted per-song settings.
  useEffect(() => {
    let url: string | undefined;
    let cancelled = false;
    let metaTimer: ReturnType<typeof setTimeout> | undefined;
    let cleanupAudio: (() => void) | undefined;

    setSyncSettingsLoaded(false);
    const sync = getAudioSync(songId);
    const storedDurationKnown = (sync?.syncMap?.audioDurationSec ?? 0) > 0;
    if (sync) {
      setOffsetMs(sync.offsetMs ?? 0);
      setStoredSyncMap(sync.syncMap ?? null);
      setDtwStatus(sync.dtwStatus);
      setStoredDurationSec(sync.syncMap?.audioDurationSec ?? 0);
      if (typeof sync.backingVol === "number") setBackingVol(sync.backingVol);
      if (typeof sync.backingMuted === "boolean")
        setBackingMuted(sync.backingMuted);
      if (typeof sync.synthVol === "number") setSynthVol(sync.synthVol);
      if (typeof sync.synthMuted === "boolean") setSynthMuted(sync.synthMuted);
    } else {
      setOffsetMs(0);
      setStoredSyncMap(null);
      setDtwStatus(undefined);
      setStoredDurationSec(0);
    }
    setSyncSettingsLoaded(true);

    getBackingAudio(songId).then((blob) => {
      if (cancelled) return;
      if (!blob || !backingAudioRef.current) {
        // No recording stored (e.g. a legacy import) — nothing to wait for.
        setAudioMetaReady(true);
        return;
      }
      // Re-wrap so the object URL always carries a decodable MIME type.
      const typed =
        blob.type && blob.type.startsWith("audio/")
          ? blob
          : new Blob([blob], { type: "audio/mpeg" });
      url = URL.createObjectURL(typed);
      const audio = backingAudioRef.current;
      audio.src = url;
      setPreservesPitch(audio);
      audio.load();
      setHasBacking(true);

      // Ground truth for the recording length is the decoded PCM. A stored
      // length was itself measured that way (by the aligner), so decoding is
      // only worth the memory when there isn't one. Runs in the background
      // either way, so the controls are never gated on it.
      if (!storedDurationKnown) {
        decodeAudio(typed)
          .then((decoded) => {
            if (!cancelled && decoded.duration > 0) {
              setDecodedDurationSec(decoded.duration);
            }
          })
          .catch((err) =>
            console.error("[AlphaTabPlayer] could not decode the recording", err),
          );
      }

      const readDuration = () => {
        setAudioMetaReady(true);
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          setElementDurationSec(audio.duration);
        }
      };
      audio.addEventListener("loadedmetadata", readDuration);
      // Chrome refines an estimated VBR duration later; alphaTab anchors its
      // final segment to this number, so keep taking the latest value.
      audio.addEventListener("durationchange", readDuration);
      cleanupAudio = () => {
        audio.removeEventListener("loadedmetadata", readDuration);
        audio.removeEventListener("durationchange", readDuration);
      };
      // Some browsers stall metadata for blob mp3s; don't block controls forever.
      metaTimer = setTimeout(readDuration, 4000);
    });

    return () => {
      cancelled = true;
      if (metaTimer) clearTimeout(metaTimer);
      cleanupAudio?.();
      if (url) URL.revokeObjectURL(url);
    };
  }, [songId]);

  // The sync-debug page writes anchors and DTW maps to the same store. Arriving
  // back here by navigation remounts the player, which re-reads them — but a
  // player left open in another tab would otherwise keep a stale map *and*
  // write it back over the edit on its next persist. `storage` only fires in
  // the tabs that did not do the writing, so this can't loop with our own
  // persists or fight a slider mid-drag.
  //
  // `patchAudioSync` also fires a same-tab event, which is what makes an anchor
  // edit audible immediately instead of only after a reload.
  useEffect(() => {
    const reload = () => {
      if (selfWritingSyncRef.current) return;
      const sync = getAudioSync(songId);
      setOffsetMs(sync?.offsetMs ?? 0);
      setStoredSyncMap(sync?.syncMap ?? null);
      setDtwStatus(sync?.dtwStatus);
      setStoredDurationSec(sync?.syncMap?.audioDurationSec ?? 0);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== AUDIO_SYNC_KEY) return;
      reload();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(AUDIO_SYNC_EVENT, reload);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(AUDIO_SYNC_EVENT, reload);
    };
  }, [songId]);

  // Alignment progress reaches the UI through the same message channel as the
  // manual controls, so whichever acted last is what the panel shows.
  useEffect(() => {
    if (alignmentJob?.message) setSyncMessage(alignmentJob.message);
  }, [alignmentJob]);

  useEffect(() => {
    scrubbingRef.current = scrubbing;
  }, [scrubbing]);

  // localStorage is read after mount so the server and client first renders agree.
  useEffect(() => {
    setCountInEnabled(getCountIn());
  }, []);

  // --- synthesized reference tone -------------------------------------------

  // iOS will not start the audio hardware until something is played through
  // the context from inside a user gesture, and a gesture anywhere on the page
  // counts — so the whole player unlocks it, not just the play button. Kept
  // live (rather than `once`) because iOS parks the context in `interrupted`
  // after a call or a screen lock, and only another gesture brings it back.
  useEffect(() => {
    const unlock = () => unlockAudio();
    const events = ["pointerdown", "touchend", "keydown"] as const;
    for (const ev of events) {
      window.addEventListener(ev, unlock, { passive: true });
    }
    document.addEventListener("visibilitychange", unlock);
    return () => {
      for (const ev of events) window.removeEventListener(ev, unlock);
      document.removeEventListener("visibilitychange", unlock);
    };
  }, []);

  // Take the recording's output over once — and only once — the context is
  // actually running. Capturing an element is a one-way door: from then on it
  // plays *only* through the graph, so doing it against a suspended context
  // would silence the recording outright.
  useEffect(() => {
    if (mediaVolumeIsSettable() || backingGainRef.current) return;
    if (audioContextState !== "running") return;
    const audio = backingAudioRef.current;
    if (!audio || !hasBacking) return;
    const gain = captureMediaElement(audio);
    if (!gain) return;
    gain.gain.value = backingMuted ? 0 : Math.min(1, backingVol);
    backingGainRef.current = gain;
    if (IS_DEV) {
      (window as unknown as { __backingGain?: GainNode }).__backingGain = gain;
    }
    // The element's own volume is meaningless now; leave it wide open so the
    // gain node is the only thing attenuating.
    audio.volume = 1;
  }, [audioContextState, hasBacking, backingVol, backingMuted]);

  // One synth for the life of the player, on the context shared with the
  // recording — see `audioEngine.ts`.
  useEffect(() => {
    const ctx = getAudioContext();
    if (!ctx) return;
    const synth = new TrackSynth(ctx);
    synthRef.current = synth;
    if (IS_DEV) {
      // Debug handles: the live instance, plus the class so the engine can be
      // rendered offline (see docs/sync-audit-2.md "verifying the synth").
      const w = window as unknown as { __trackSynth?: unknown; __TrackSynth?: unknown };
      w.__trackSynth = synth;
      w.__TrackSynth = TrackSynth;
    }
    return () => {
      synth.dispose();
      synthRef.current = null;
    };
  }, []);

  // Notes follow whichever track is on screen.
  useEffect(() => {
    let cancelled = false;
    extractTrackNotes(base64ToBytes(tabData), selectedTrack)
      .then((notes: SynthNote[]) => {
        if (cancelled) return;
        synthRef.current?.setNotes(notes);
        setSynthNoteCount(notes.length);
        syncSynthPlayback();
      })
      .catch((err) => {
        console.error("[AlphaTabPlayer] track notes failed", err);
        if (!cancelled) setSynthNoteCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [tabData, selectedTrack, syncSynthPlayback]);

  // The synth is positioned by the same mapping as the cursor.
  useEffect(() => {
    synthRef.current?.setSyncMap(syncMap);
    syncSynthPlayback();
  }, [syncMap, syncSynthPlayback]);

  useEffect(() => {
    synthRef.current?.setVolume(synthMuted ? 0 : synthVol);
    if (synthPersistTimer.current) clearTimeout(synthPersistTimer.current);
    synthPersistTimer.current = setTimeout(() => {
      persistSync({ synthVol, synthMuted });
    }, PERSIST_DEBOUNCE_MS);
  }, [synthVol, synthMuted, persistSync]);

  // Re-anchor on every transport event so seeks, loop wraps and speed changes
  // never leave the synth running against a stale time reference.
  useEffect(() => {
    const audio = backingAudioRef.current;
    if (!audio) return;
    const sync = () => syncSynthPlayback();
    for (const ev of ["play", "playing", "pause", "seeked", "ratechange", "ended"]) {
      audio.addEventListener(ev, sync);
    }
    sync();
    return () => {
      for (const ev of ["play", "playing", "pause", "seeked", "ratechange", "ended"]) {
        audio.removeEventListener(ev, sync);
      }
    };
  }, [hasBacking, syncSynthPlayback]);

  // Bar/tempo timeline straight from the GP file. Needed to place sync points on
  // (barIndex, barPosition) and to know the score length before playback starts.
  useEffect(() => {
    let cancelled = false;
    extractScoreTimeline(base64ToBytes(tabData))
      .then((tl) => {
        if (cancelled) return;
        setBarTimeline({
          bars: tl.bars.map((b) => ({
            barIndex: b.barIndex,
            occurence: b.occurence,
            startSec: b.scoreTimeSec,
            beats: b.beats,
          })),
          endSec: tl.endSec,
          // Beat-level sync points: alphaTab interpolates linearly between
          // consecutive points, so bar downbeats alone leave a whole 1.4 s bar
          // (at 170 BPM) modelled as one constant tempo.
          beatSec: tl.beatSec,
        });
      })
      .catch((err) =>
        console.error("[AlphaTabPlayer] score timeline failed", err),
      );
    return () => {
      cancelled = true;
    };
  }, [tabData]);

  // Dev-only `window.__syncDebug()` for measuring alignment error.
  const syncMapRef = useRef<SyncMap | null>(syncMap);
  const positionMsRef = useRef(positionMs);
  const syncSourceRef = useRef(syncSource);
  const scoreDurRef = useRef(scoreDurationSec);
  const audioDurRef = useRef(audioDurationSec);
  const barTimelineRef = useRef(barTimeline);
  syncMapRef.current = syncMap;
  positionMsRef.current = positionMs;
  syncSourceRef.current = syncSource;
  scoreDurRef.current = scoreDurationSec;
  audioDurRef.current = audioDurationSec;
  barTimelineRef.current = barTimeline;

  /**
   * Reads the points back out of alphaTab and diffs them against the map they
   * came from. A faithful transfer means any remaining error is alignment
   * quality; a lossy one means points are being dropped or mis-addressed on the
   * way in — which is exactly how manual anchors used to disappear.
   */
  const verifyTransfer = useCallback(() => {
    const map = syncMapRef.current;
    const timeline = barTimelineRef.current;
    if (!map) return { error: "no sync map yet" };
    if (!timeline) return { error: "no bar timeline yet" };
    return verifySyncTransfer(apiRef.current, map, timeline);
  }, []);

  useEffect(() => {
    return installSyncDebug({
      getMap: () => syncMapRef.current,
      getScoreTimeSec: () => positionMsRef.current / 1000,
      getAudioTimeSec: () => backingAudioRef.current?.currentTime ?? 0,
      getSource: () => syncSourceRef.current,
      getScoreDurationSec: () => scoreDurRef.current,
      getAudioDurationSec: () => audioDurRef.current,
      verifyTransfer,
    });
  }, [verifyTransfer]);

  // Per-instrument mix (kept for a possible future synth mode; inert while the
  // recording is the clock, but harmless).
  useEffect(() => {
    const api = apiRef.current;
    if (!api?.score) return;
    for (const t of tracks) {
      const track = api.score.tracks[t.index];
      if (!track) continue;
      api.changeTrackVolume([track], t.volume);
      api.changeTrackMute([track], t.muted);
      api.changeTrackSolo([track], t.soloed);
    }
  }, [tracks, playerReady]);

  // Recording level → the <audio> element, and persist (debounced).
  //
  // iOS ignores writes to `audio.volume` (level is the hardware buttons' job
  // there), which left the recording slider and its mute button doing nothing
  // on a phone. Where the write doesn't stick, the element is routed through
  // the Web Audio graph instead and a `GainNode` carries the level.
  useEffect(() => {
    const audio = backingAudioRef.current;
    const level = backingMuted ? 0 : Math.min(1, backingVol);
    const gain = backingGainRef.current;
    if (gain) {
      const ctx = getAudioContext()!;
      gain.gain.setTargetAtTime(level, ctx.currentTime, 0.015);
    } else if (audio) {
      audio.volume = level;
    }

    if (backingPersistTimer.current) clearTimeout(backingPersistTimer.current);
    backingPersistTimer.current = setTimeout(() => {
      persistSync({ backingVol, backingMuted });
    }, PERSIST_DEBOUNCE_MS);
  }, [backingVol, backingMuted, hasBacking, playerReady, persistSync]);

  useEffect(() => {
    return () => {
      if (offsetPersistTimer.current) clearTimeout(offsetPersistTimer.current);
      if (backingPersistTimer.current) clearTimeout(backingPersistTimer.current);
    };
  }, []);

  const countingIn = countInLeft > 0;
  const waitingForImportAlignment = dtwStatus === "pending";
  const controlsDisabled =
    !playerReady ||
    !audioMetaReady ||
    !syncSettingsLoaded ||
    waitingForImportAlignment;

  const cancelCountIn = useCallback(() => {
    cancelCountInRef.current?.();
    cancelCountInRef.current = null;
    for (const t of countInTimers.current) clearTimeout(t);
    countInTimers.current = [];
    setCountInLeft(0);
  }, []);

  /**
   * Click the count-in, then start playback. Returns false when no count-in
   * could be built (no tempo grid, or a nonsensical one), so the caller can
   * just start playing.
   */
  const startCountIn = useCallback(() => {
    const api = apiRef.current;
    const ctx = synthRef.current?.context;
    if (!api || !ctx || !barTimeline?.beatSec?.length) return false;

    const startScoreSec = (api.timePosition ?? 0) / 1000;
    const bar = [...barTimeline.bars]
      .reverse()
      .find((b) => b.startSec <= startScoreSec + 1e-3);
    const plan = buildCountInPlan({
      beatSec: barTimeline.beatSec,
      barStartSec: barTimeline.bars.map((b) => b.startSec),
      startScoreSec,
      beats: bar?.beats ?? 4,
      toAudioTime: syncMap
        ? (t: number) => syncMap.scoreTimeToAudioTime(t)
        : undefined,
      playbackRate: backingAudioRef.current?.playbackRate || speed,
    });
    if (!plan) return false;

    setCountInLeft(plan.clicks.length);
    // Purely cosmetic countdown; the clicks themselves are on the audio clock.
    plan.clicks.forEach((c, i) => {
      const delayMs = (plan.durationSec - c.leadSec) * 1000;
      countInTimers.current.push(
        setTimeout(
          () => setCountInLeft(plan.clicks.length - i),
          Math.max(0, delayMs),
        ),
      );
    });
    cancelCountInRef.current = playCountIn(ctx, plan.clicks, {
      onComplete: () => {
        cancelCountInRef.current = null;
        for (const t of countInTimers.current) clearTimeout(t);
        countInTimers.current = [];
        setCountInLeft(0);
        apiRef.current?.playPause();
      },
    });
    return true;
  }, [barTimeline, syncMap, speed]);

  /**
   * Count the loop back in on every repeat, not just the first play.
   *
   * alphaTab fires `playerFinished` on each wrap and *then* rewinds to the
   * start of the loop, so the recording is paused here and the count-in is
   * built a tick later, once the playhead is back at the top of the section.
   */
  playerFinishedRef.current = () => {
    const api = apiRef.current;
    if (!api || !looping || !countInEnabled) return;
    api.pause();
    countInTimers.current.push(
      setTimeout(() => {
        // No usable count-in (odd tempo map) — just carry on looping.
        if (!startCountIn()) apiRef.current?.playPause();
      }, 0),
    );
  };

  const togglePlay = useCallback(() => {
    if (controlsDisabled) return;
    // Start the audio hardware on the click itself. Browsers create the context
    // suspended, and the path click → alphaTab → <audio> play event is too many
    // async hops to reliably keep the user activation that unlocking needs.
    unlockAudio();
    // Pressing play again during the count-in aborts it rather than stacking a
    // second one on top.
    if (cancelCountInRef.current) {
      cancelCountIn();
      return;
    }
    if (!playing && countInEnabled && startCountIn()) return;
    apiRef.current?.playPause();
  }, [controlsDisabled, playing, countInEnabled, startCountIn, cancelCountIn]);

  const stop = useCallback(() => {
    cancelCountIn();
    const api = apiRef.current;
    api?.stop();
    synthRef.current?.stop();
    const audio = backingAudioRef.current;
    if (audio) {
      audio.pause();
      // alphaTab rewinds to the start of the loop section (or to 0 without
      // one) and seeks the recording with it; forcing 0 here would drop the
      // playhead out of the section the user is practising.
      if (!api?.playbackRange) audio.currentTime = 0;
    }
    setPositionMs(api?.timePosition ?? 0);
  }, [cancelCountIn]);

  // A count-in left running past unmount would start playback on a dead api.
  useEffect(() => cancelCountIn, [cancelCountIn]);

  const loopRange = useMemo(
    () => ticksToBarRange(barTicks, loopTicks),
    [barTicks, loopTicks],
  );

  /**
   * Paint alphaTab's own selection markers over the looped bars, so a range
   * typed into the control looks identical to one dragged out on the score.
   * Best-effort: the markers are cosmetic, the range itself is the tick range.
   */
  const highlightBars = useCallback(
    (range: BarRange) => {
      const api = apiRef.current;
      const staff = api?.score?.tracks?.[selectedTrack]?.staves?.[0];
      if (!api?.highlightPlaybackRange || !staff) return;
      const beatsIn = (barNumber: number) =>
        staff.bars?.[barNumber - 1]?.voices?.[0]?.beats ?? [];
      const startBeat = beatsIn(range.startBar)[0];
      const endBeats = beatsIn(range.endBar);
      const endBeat = endBeats[endBeats.length - 1];
      if (!startBeat || !endBeat) return;
      api.highlightPlaybackRange(startBeat, endBeat);
    },
    [selectedTrack],
  );

  /** Loop the given bars. Setting the range also seeks alphaTab to its start. */
  const applyLoopRange = useCallback(
    (range: BarRange) => {
      const api = apiRef.current;
      const alphaTab = alphaTabRef.current;
      if (!api || !alphaTab) return;
      const clamped = clampBarRange(barTicks, range);
      const ticks = clamped && barRangeToTicks(barTicks, clamped);
      if (!clamped || !ticks) return;
      const playbackRange = new alphaTab.synth.PlaybackRange();
      playbackRange.startTick = ticks.startTick;
      playbackRange.endTick = ticks.endTick;
      api.playbackRange = playbackRange;
      highlightBars(clamped);
    },
    [barTicks, highlightBars],
  );

  const clearLoopRange = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    api.playbackRange = null;
    api.clearPlaybackRangeHighlight?.();
    setLoopTicks(null);
  }, []);

  function toggleLoop() {
    const api = apiRef.current;
    const next = !looping;
    setLooping(next);
    if (!api) return;
    api.isLooping = next;
    if (next) {
      // Looping the whole song is rarely what's wanted while practising, so
      // with no section picked yet the bar under the cursor becomes the loop.
      if (!loopTicks) {
        const bar = barAtTick(barTicks, api.tickPosition ?? 0);
        if (bar !== null) applyLoopRange({ startBar: bar, endBar: bar });
      }
    } else {
      // A playback range restricts playback whether or not it loops, so leaving
      // it behind would look like the song had silently got shorter.
      clearLoopRange();
    }
  }

  function toggleCountIn() {
    const next = !countInEnabled;
    setCountInEnabled(next);
    setCountIn(next);
  }

  const changeSpeed = useCallback((value: number) => {
    const next = clampSpeed(value);
    setSpeed(next);
    // alphaTab forwards the rate to our media handler (which keeps pitch).
    if (apiRef.current) apiRef.current.playbackSpeed = next;
  }, []);

  const adjustSpeed = useCallback(
    (direction: "slower" | "faster") => {
      setSpeed((prev) => {
        const delta =
          direction === "slower" ? -SPEED_PERCENT_STEP : SPEED_PERCENT_STEP;
        const next = percentToSpeed(speedToPercent(prev) + delta);
        if (apiRef.current) apiRef.current.playbackSpeed = next;
        return next;
      });
    },
    [],
  );

  function selectTrack(index: number) {
    setSelectedTrack(index);
    setPreferredTrackIndex(songId, index);
    renderTrack(index);
  }

  function updateTrack(index: number, patch: Partial<MixerTrack>) {
    setTracks((prev) =>
      prev.map((t) => (t.index === index ? { ...t, ...patch } : t)),
    );
  }

  function handleOffsetChange(nextMs: number) {
    const clamped = Math.max(
      -OFFSET_CLAMP_MS,
      Math.min(OFFSET_CLAMP_MS, Math.round(nextMs)),
    );
    const deltaSec = (clamped - offsetMs) / 1000;
    setOffsetMs(clamped);

    // When a nonlinear map is loaded, a nudge slides the whole curve (points and
    // anchors together) so manual trim still works on top of DTW.
    let nextMap = storedSyncMap;
    if (storedSyncMap && deltaSec !== 0) {
      nextMap = {
        ...storedSyncMap,
        points: storedSyncMap.points.map((p) => ({
          ...p,
          audioTime: Math.max(0, p.audioTime + deltaSec),
        })),
        anchors: storedSyncMap.anchors?.map((a) => ({
          ...a,
          audioTime: Math.max(0, a.audioTime + deltaSec),
        })),
      };
      setStoredSyncMap(nextMap);
    }
    applySync();

    if (offsetPersistTimer.current) clearTimeout(offsetPersistTimer.current);
    offsetPersistTimer.current = setTimeout(() => {
      persistSync({
        offsetMs: clamped,
        ...(nextMap ? { syncMap: nextMap } : {}),
      });
    }, PERSIST_DEBOUNCE_MS);
  }

  function handleOffsetReset() {
    setStoredSyncMap(null);
    persistSync({ offsetMs: 0, syncMap: undefined });
    setOffsetMs(0);
    setSyncMessage(undefined);
    applySync();
  }

  /** Fast in-browser alignment: first-onset offset + global linear fit. */
  async function handleAutoAlign() {
    setAutoAligning(true);
    setSyncMessage(undefined);
    try {
      const blob = await getBackingAudio(songId);
      if (!blob) return;
      const result = await new OffsetSyncGenerator().generate({
        songId,
        gpBytes: base64ToBytes(tabData),
        audioBlob: blob,
        scoreDurationSec,
        audioDurationSec,
      });
      const offsetSec =
        (result.diagnostics?.offsetSec as number | undefined) ?? 0;
      setStoredSyncMap(null);
      handleOffsetChange(Math.round(offsetSec * 1000));
      if (result.status === "low-confidence") setSyncMessage(result.message);
    } finally {
      setAutoAligning(false);
    }
  }

  /**
   * Re-run offline DTW alignment via the shared queue. The result is written to
   * the sync store, which this player reloads through `AUDIO_SYNC_EVENT` —
   * the same path a background job started at import time takes.
   */
  async function handleDtwAlign() {
    setSyncMessage(undefined);
    const blob = await getBackingAudio(songId);
    if (!blob) {
      setSyncMessage("No recording to align against.");
      return;
    }
    await queueAlignment({
      songId,
      gpBytes: base64ToBytes(tabData),
      audioBlob: blob,
      scoreDurationSec,
      audioDurationSec,
      // Existing manual anchors are sent along so the refiner can solve
      // between them instead of re-solving the whole song globally.
      anchors: storedSyncMap?.anchors ?? [],
      force: true,
    });
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (controlsDisabled || isEditableTarget(e.target)) return;

      switch (e.code) {
        case "Space":
          e.preventDefault();
          togglePlay();
          return;
        case "Backspace":
          e.preventDefault();
          stop();
          return;
        case "Minus":
        case "NumpadSubtract":
          e.preventDefault();
          adjustSpeed("slower");
          return;
        case "Equal":
        case "NumpadAdd":
          e.preventDefault();
          adjustSpeed("faster");
          return;
        default:
          return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [controlsDisabled, togglePlay, stop, adjustSpeed]);

  const overlayVisible =
    status === "error" ||
    status !== "ready" ||
    !audioMetaReady ||
    !syncSettingsLoaded ||
    waitingForImportAlignment;
  const overlayText =
    status === "error"
      ? "Could not render this tab file."
      : status !== "ready"
        ? "Rendering tab…"
        : !audioMetaReady || !syncSettingsLoaded
          ? "Loading recording…"
          : "Aligning tab to recording…";
  const overlayDetail =
    status === "error"
      ? "Try importing the tab again."
      : waitingForImportAlignment
        ? "Preparing synced playback."
        : undefined;
  const seekProgress =
    durationMs > 0 ? Math.min(1, Math.max(0, positionMs / durationMs)) : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 md:gap-3">
      {/* On phones the bar drops below the score (`order-2`) so the controls
          sit under the thumb and the tab gets the top of the screen. */}
      <div className="order-2 flex flex-col rounded-sm border border-rule-strong bg-paper-raised md:order-none">
        {/* Row one: transport, instrument, position and speed. */}
        <div className="flex flex-col gap-2 px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] md:flex-row md:flex-wrap md:items-center md:gap-2.5 md:border-b md:border-rule md:pb-2.5">
          {/* `md:contents` dissolves this phone-only row on desktop, so the
              toolbar stays one flowing line there. */}
          <div className="flex items-center gap-2 md:contents">
            <MotionButton
              size="icon"
              aria-label={
                countingIn ? "Cancel count-in" : playing ? "Pause" : "Play"
              }
              disabled={controlsDisabled}
              onClick={togglePlay}
              className="h-12 w-12 shrink-0 md:h-8 md:w-8"
              whileHover={controlsDisabled ? undefined : { scale: 1.04 }}
              whileTap={controlsDisabled ? undefined : { scale: 0.94 }}
            >
              {/* Playback is armed during the count-in, so the button reads as
                  "stop what's happening" rather than offering to start again. */}
              {playing || countingIn ? (
                <Pause className="h-5 w-5 md:h-4 md:w-4" />
              ) : (
                <Play className="h-5 w-5 md:h-4 md:w-4" />
              )}
            </MotionButton>
            <MotionButton
              variant="outline"
              size="icon"
              aria-label="Stop"
              disabled={controlsDisabled}
              onClick={stop}
              className="hidden md:inline-flex"
              whileHover={controlsDisabled ? undefined : { scale: 1.04 }}
              whileTap={controlsDisabled ? undefined : { scale: 0.94 }}
            >
              <Square className="h-4 w-4" />
            </MotionButton>

            {trackNames.length > 0 && (
              <label className="flex min-w-0 flex-1 items-center gap-2 md:flex-none">
                <Select
                  aria-label="Instrument"
                  value={selectedTrack}
                  onChange={(e) => selectTrack(Number(e.target.value))}
                  className="h-10 w-full min-w-0 md:h-8 md:w-auto md:max-w-[13rem]"
                >
                  {trackNames.map((name, i) => (
                    <option key={i} value={i}>
                      {name}
                    </option>
                  ))}
                </Select>
                {tuning && (
                  <span className="hidden font-mono text-[9.5px] uppercase tracking-label text-ink-faint lg:inline">
                    {tuning}
                  </span>
                )}
              </label>
            )}

            {/* Phone speed readout — the slider itself lives in the sheet. */}
            <MotionButton
              variant="outline"
              size="sm"
              aria-label="Playback speed"
              onClick={() => setMixerOpen(true)}
              className="h-10 shrink-0 tabular-nums md:hidden"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
            >
              {speedToPercent(speed)}%
            </MotionButton>

            <LoopControl
              looping={looping}
              onToggle={toggleLoop}
              range={loopRange}
              onRangeChange={applyLoopRange}
              onClear={clearLoopRange}
              firstBar={barTicks[0]?.barNumber ?? 1}
              lastBar={barTicks[barTicks.length - 1]?.barNumber ?? 1}
              disabled={controlsDisabled || barTicks.length === 0}
            />
            <MotionButton
              variant="outline"
              size="icon"
              aria-label="Count-in before playing"
              title="Count-in before playing"
              aria-pressed={countInEnabled}
              disabled={controlsDisabled}
              className={cn(
                "h-10 w-10 shrink-0 md:h-[30px] md:w-[30px]",
                countInEnabled && engagedKey,
              )}
              onClick={toggleCountIn}
              whileHover={controlsDisabled ? undefined : { scale: 1.04 }}
              whileTap={controlsDisabled ? undefined : { scale: 0.94 }}
            >
              <Timer className="h-5 w-5 md:h-4 md:w-4" />
            </MotionButton>
            <MotionButton
              variant="outline"
              size="icon"
              aria-label="Tab only (hide standard notation)"
              title="Tab only (hide standard notation)"
              aria-pressed={tabOnly}
              disabled={status !== "ready"}
              className={cn("hidden md:inline-flex", tabOnly && engagedKey)}
              onClick={toggleTabOnly}
              whileHover={status !== "ready" ? undefined : { scale: 1.04 }}
              whileTap={status !== "ready" ? undefined : { scale: 0.94 }}
            >
              <Music className="h-4 w-4" />
            </MotionButton>
            <MotionButton
              variant="outline"
              size="icon"
              aria-label="Toggle mixer"
              aria-pressed={mixerOpen}
              className={cn(
                "h-10 w-10 shrink-0 md:h-[30px] md:w-[30px]",
                mixerOpen && engagedKey,
              )}
              onClick={() => setMixerOpen((o) => !o)}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.94 }}
            >
              <SlidersHorizontal className="h-5 w-5 md:h-4 md:w-4" />
            </MotionButton>
          </div>

          {/* Scrubber above the buttons on a phone: it reads as a continuation
              of the score, and keeps the tappable row at the bottom edge. On
              desktop `flex-[1_1_2.5rem] min-w-0` lets it give up width first,
              so the speed group never orphans its percentage onto a new line. */}
          <div className="order-first flex items-center gap-2.5 font-mono text-xs md:order-none md:min-w-0 md:flex-[1_1_2.5rem] md:gap-3">
            <span className="shrink-0 font-semibold tabular-nums text-accent">
              {formatMs(positionMs)}
            </span>
            <span className="relative flex min-w-0 flex-1 items-center">
              <span className="pointer-events-none absolute left-0 right-0 top-1/2 h-0.5 -translate-y-1/2 bg-track" />
              <motion.span
                className="pointer-events-none absolute left-0 top-1/2 h-0.5 origin-left -translate-y-1/2 bg-accent"
                animate={{ scaleX: seekProgress }}
                transition={{ type: "spring", stiffness: 280, damping: 34 }}
                style={{ width: "100%" }}
              />
              <motion.span
                className="pointer-events-none absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-accent bg-paper"
                animate={{ left: `${seekProgress * 100}%` }}
                transition={{ type: "spring", stiffness: 280, damping: 34 }}
                style={{ marginLeft: "-5px" }}
              />
              <input
                type="range"
                min={0}
                max={durationMs || 1}
                value={Math.min(positionMs, durationMs || 1)}
                disabled={controlsDisabled || durationMs === 0}
                onMouseDown={() => setScrubbing(true)}
                onTouchStart={() => setScrubbing(true)}
                onChange={(e) => setPositionMs(Number(e.target.value))}
                onMouseUp={(e) => {
                  setScrubbing(false);
                  if (apiRef.current) {
                    apiRef.current.timePosition = Number(
                      (e.target as HTMLInputElement).value,
                    );
                  }
                }}
                onTouchEnd={(e) => {
                  setScrubbing(false);
                  if (apiRef.current) {
                    apiRef.current.timePosition = Number(
                      (e.target as HTMLInputElement).value,
                    );
                  }
                }}
                className="relative h-5 w-full cursor-pointer opacity-0 disabled:cursor-not-allowed disabled:opacity-0"
                aria-label="Seek"
              />
            </span>
            <span className="shrink-0 tabular-nums text-ink-muted">
              {formatMs(durationMs)}
            </span>
          </div>

          <label className="hidden shrink-0 flex-nowrap items-center gap-2 font-mono text-xs md:flex">
            <span className="shrink-0 text-[9.5px] uppercase tracking-label text-ink-faint">
              Speed
            </span>
            <input
              type="range"
              min={SPEED_PERCENT_MIN}
              max={SPEED_SLIDER_MAX}
              step={SPEED_PERCENT_STEP}
              value={speedToSliderPercent(speed)}
              disabled={controlsDisabled}
              onChange={(e) =>
                changeSpeed(percentToSpeed(Number(e.target.value)))
              }
              className="slider-hairline h-0.5 w-[82px] shrink-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-45"
              aria-label="Playback speed"
              aria-valuetext={`${speedToPercent(speed)}%`}
            />
            <span className="w-9 shrink-0 tabular-nums text-ink">
              {speedToPercent(speed)}%
            </span>
          </label>
          </div>

        {/* Row two: levels, alignment and printing — desktop only; on a phone
            these live in the mixer sheet. */}
        <div className="hidden flex-wrap items-center gap-2 px-3 py-2.5 md:flex">
          {hasBacking && (
            <>
              <span className="font-mono text-[9.5px] uppercase tracking-label text-ink-faint">
                Rec
              </span>
              <BackingVolumeControl
                volume={backingVol}
                muted={backingMuted}
                onVolume={setBackingVol}
                onMuteToggle={() => setBackingMuted((m) => !m)}
                disabled={controlsDisabled}
              />
            </>
          )}
          {synthNoteCount > 0 && (
            <>
              <span className="ml-1.5 font-mono text-[9.5px] uppercase tracking-label text-ink-faint">
                Ref
              </span>
              <SynthVolumeControl
                volume={synthVol}
                muted={synthMuted}
                onVolume={setSynthVol}
                onMuteToggle={() => setSynthMuted((m) => !m)}
                trackName={trackNames[selectedTrack]}
                disabled={controlsDisabled}
              />
            </>
          )}

          {hasBacking && (
            <>
              <span aria-hidden className="mx-1 h-5 w-px bg-dot" />
              <span className="font-mono text-[9.5px] uppercase tracking-label text-ink-faint">
                Offset
              </span>
              <AudioOffsetControl
                compact
                offsetMs={offsetMs}
                onChange={handleOffsetChange}
                onReset={handleOffsetReset}
                onAutoAlign={handleAutoAlign}
                autoAligning={autoAligning}
                disabled={controlsDisabled}
              />
            </>
          )}

          <span className="ml-auto flex items-center gap-2">
            {IS_DEV && hasBacking && (
              <MotionButton
                variant="outline"
                size="icon"
                aria-label={
                  dtwRunning
                    ? "Aligning… (sync diagnostics)"
                    : "Sync diagnostics"
                }
                aria-pressed={diagOpen}
                className={cn((diagOpen || dtwRunning) && engagedKey)}
                onClick={() => setDiagOpen((o) => !o)}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.94 }}
              >
                <Activity
                  className={cn("h-4 w-4", dtwRunning && "animate-pulse")}
                />
              </MotionButton>
            )}
            <MotionButton
              variant="outline"
              size="icon"
              aria-label="Print"
              disabled={status !== "ready"}
              onClick={() => apiRef.current?.print()}
              whileHover={status !== "ready" ? undefined : { scale: 1.04 }}
              whileTap={status !== "ready" ? undefined : { scale: 0.94 }}
            >
              <Printer className="h-4 w-4" />
            </MotionButton>
          </span>
        </div>
      </div>

      <div
        ref={viewportRef}
        className="relative order-1 min-h-[16rem] flex-1 overflow-auto overscroll-contain rounded-sm border border-rule-strong bg-paper-sheet text-[#16181c] shadow-sheet md:order-none md:min-h-[360px]"
        style={{ backgroundColor: scoreAppearance.sheetColor }}
      >
        {overlayVisible && (
          <LoadingScoreOverlay
            title={overlayText}
            detail={overlayDetail}
            error={status === "error"}
          />
        )}
        {countInLeft > 0 && (
          <div
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
            role="status"
            aria-live="assertive"
            aria-label={`Count-in, ${countInLeft} to go`}
          >
            <span className="flex h-24 w-24 items-center justify-center rounded-full bg-ink/85 font-display text-5xl font-bold tabular-nums text-paper">
              {countInLeft}
            </span>
          </div>
        )}
        <div
          ref={hostRef}
          className={cn(
            "alphatab-host p-1 md:px-[22px] md:py-5",
            overlayVisible && "invisible",
          )}
        />
      </div>

      {mixerOpen && (
        <Mixer
          recordMode
          speedPercent={speedToPercent(speed)}
          speedSliderPercent={speedToSliderPercent(speed)}
          onSpeedPercent={(p) => changeSpeed(percentToSpeed(p))}
          speedDisabled={controlsDisabled}
          tabOnly={tabOnly}
          onTabOnlyToggle={toggleTabOnly}
          tabOnlyDisabled={status !== "ready"}
          scoreAppearance={scoreAppearance}
          onScoreAppearance={updateScoreAppearance}
          onScoreAppearanceReset={resetScoreAppearance}
          countIn={countInEnabled}
          onCountInToggle={toggleCountIn}
          countInDisabled={controlsDisabled}
          offsetMs={offsetMs}
          onOffsetChange={handleOffsetChange}
          onOffsetReset={handleOffsetReset}
          onAutoAlign={handleAutoAlign}
          autoAligning={autoAligning}
          hasBacking={hasBacking}
          backing={backingVol}
          backingMuted={backingMuted}
          onBacking={setBackingVol}
          onBackingMute={setBackingMuted}
          hasSynth={synthNoteCount > 0}
          synth={synthVol}
          synthMuted={synthMuted}
          onSynth={setSynthVol}
          onSynthMute={setSynthMuted}
          synthTrackName={trackNames[selectedTrack]}
          tracks={tracks}
          shownTrackIndex={selectedTrack}
          onShowTrack={selectTrack}
          onTrackVolume={(i, v) => updateTrack(i, { volume: v })}
          onTrackMute={(i, m) => updateTrack(i, { muted: m })}
          onTrackSolo={(i, s) => updateTrack(i, { soloed: s })}
          onClose={() => setMixerOpen(false)}
        />
      )}

      {IS_DEV && diagOpen && (
        <SyncDiagnostics
          songId={songId}
          map={syncMap}
          method={syncMap?.diagnostics?.method ?? "offset"}
          syncSource={syncSource}
          syncWarning={syncWarning}
          scoreDurationSec={scoreDurationSec}
          audioDurationSec={audioDurationSec}
          appliedPointCount={flatSyncPoints?.length ?? 0}
          scoreTimeSec={positionMs / 1000}
          audioTimeSec={backingAudioRef.current?.currentTime ?? 0}
          anchors={anchors}
          onVerifyTransfer={verifyTransfer}
          onRunDtw={handleDtwAlign}
          dtwRunning={dtwRunning}
          message={syncMessage}
          onClose={() => setDiagOpen(false)}
        />
      )}

      <audio ref={backingAudioRef} preload="auto" className="hidden" />
    </div>
  );
}
