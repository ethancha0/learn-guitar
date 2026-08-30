"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Pause,
  Square,
  Repeat,
  Printer,
  Loader2,
  SlidersHorizontal,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/cn";
import { base64ToBytes } from "@/features/library/data/tabFile";
import {
  getPreferredTrackIndex,
  setPreferredTrackIndex,
  AUDIO_SYNC_KEY,
  getAudioSync,
  patchAudioSync,
  type StoredSyncMap,
} from "@/features/library/data/songStore";
import { getBackingAudio } from "@/features/player/data/audioStore";
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
import { extractScoreTimeline } from "@/features/player/data/scoreTimeline";
import {
  OffsetSyncGenerator,
  DtwSyncGenerator,
} from "@/features/player/data/syncGenerator";
import { installSyncDebug } from "@/features/player/data/syncDebug";
import { verifySyncTransfer } from "@/features/player/data/syncVerify";
import {
  TrackSynth,
  extractTrackNotes,
  type SynthNote,
} from "@/features/player/data/trackSynth";
import { Mixer, type MixerTrack } from "./Mixer";
import { AudioOffsetControl } from "./AudioOffsetControl";
import { BackingVolumeControl } from "./BackingVolumeControl";
import { SynthVolumeControl } from "./SynthVolumeControl";
import { SyncDiagnostics } from "./SyncDiagnostics";

const IS_DEV = process.env.NODE_ENV !== "production";

// alphaTab's worker/worklet scripts must be same-origin, so its runtime assets
// (script, worker, worklet, music font) are copied to `public/alphatab` and
// served locally. See README.
const ALPHATAB_ASSETS = "/alphatab";

const OFFSET_CLAMP_MS = 5000;
const PERSIST_DEBOUNCE_MS = 400;
const SPEED_MULT_MIN = 0.25;
const SPEED_MULT_MAX = 2;
const SPEED_PERCENT_MIN = 0;
const SPEED_SLIDER_MAX = 100;
const SPEED_KEYBOARD_PERCENT_MAX = 200;
const SPEED_PERCENT_STEP = 5;

function snapSpeedPercent(
  percent: number,
  max = SPEED_SLIDER_MAX,
): number {
  return (
    Math.round(
      Math.max(SPEED_PERCENT_MIN, Math.min(max, percent)) / SPEED_PERCENT_STEP,
    ) * SPEED_PERCENT_STEP
  );
}

/** Slider percent (0–100) → playback multiplier; 100% = normal speed. */
function percentToSpeed(percent: number): number {
  const p = snapSpeedPercent(percent);
  if (p === 0) return SPEED_MULT_MIN;
  return clampSpeed(p / 100);
}

/** Playback multiplier → percent label (up to 200% / 2x). */
function speedToPercent(speed: number): number {
  return snapSpeedPercent(speed * 100, SPEED_KEYBOARD_PERCENT_MAX);
}

/** Slider position; pins at 100% once speed exceeds 1x. */
function speedToSliderPercent(speed: number): number {
  return snapSpeedPercent(
    Math.min(SPEED_SLIDER_MAX, speed * 100),
    SPEED_SLIDER_MAX,
  );
}

function clampSpeed(value: number): number {
  return (
    Math.round(Math.max(SPEED_MULT_MIN, Math.min(SPEED_MULT_MAX, value)) * 100) /
    100
  );
}

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

interface AlphaTabPlayerProps {
  /** Song id, used to load the backing track and remember per-song settings. */
  songId: string;
  /** Base64-encoded Guitar Pro / PowerTab file bytes. */
  tabData: string;
}

/**
 * Renders an imported multi-track tab with alphaTab in `EnabledExternalMedia`
 * mode: the imported mp3 is the time source and alphaTab's cursor is locked to
 * it (see `backingSync.ts`). Includes an instrument picker (drives which staff is
 * shown), a per-song alignment offset (Auto-align + nudge), and a prominent
 * recording-volume control. alphaTab's synthesizer is silent in this mode.
 */
export function AlphaTabPlayer({ songId, tabData }: AlphaTabPlayerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const backingAudioRef = useRef<HTMLAudioElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiRef = useRef<any>(null);
  // Read by the position listener so a drag doesn't fight the playhead.
  const scrubbingRef = useRef(false);
  const offsetPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backingPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [playerReady, setPlayerReady] = useState(false);
  const [audioMetaReady, setAudioMetaReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [looping, setLooping] = useState(false);

  // Instrument / track state
  const [tracks, setTracks] = useState<MixerTrack[]>([]);
  const [trackNames, setTrackNames] = useState<string[]>([]);
  const [tuning, setTuning] = useState<string>("");
  const [selectedTrack, setSelectedTrack] = useState(0);

  // Recording + calibration state
  const [mixerOpen, setMixerOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  const [hasBacking, setHasBacking] = useState(false);
  const [backingVol, setBackingVol] = useState(0.85);
  const [backingMuted, setBackingMuted] = useState(false);
  const [offsetMs, setOffsetMs] = useState(0);
  const [storedSyncMap, setStoredSyncMap] = useState<StoredSyncMap | null>(null);
  const [audioDurationSec, setAudioDurationSec] = useState(0);
  const [barTimeline, setBarTimeline] = useState<BarTimeline | null>(null);

  // Synthesized reference tone for the displayed track (see trackSynth.ts).
  const [synthVol, setSynthVol] = useState(0.6);
  const [synthMuted, setSynthMuted] = useState(false);
  const [synthNoteCount, setSynthNoteCount] = useState(0);
  const synthRef = useRef<TrackSynth | null>(null);
  const synthPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoAligning, setAutoAligning] = useState(false);
  const [dtwRunning, setDtwRunning] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | undefined>();

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
  const { syncMap, syncSource, syncWarning } = useMemo(() => {
    return buildPlaybackSyncMap({
      stored: storedSyncMap,
      offsetMs,
      scoreEndSec: scoreDurationSec,
      audioDurationSec,
    });
  }, [storedSyncMap, offsetMs, scoreDurationSec, audioDurationSec]);

  const flatSyncPoints = useMemo(() => {
    if (!syncMap || !barTimeline) return null;
    if (syncSource === "dtw") {
      return toAlphaTabBarSyncPoints(syncMap, barTimeline);
    }
    return toAlphaTabFlatSyncPoints(syncMap.simplify(0.02), barTimeline);
  }, [syncMap, barTimeline, syncSource]);

  const { onStateChanged, applySync } = useBackingSync({
    songId,
    apiRef,
    audioRef: backingAudioRef,
    syncMap,
    flatSyncPoints,
    trustedAudioDurationSec: audioDurationSec || null,
    playerReady,
    audioMetaReady,
  });

  const renderTrack = useCallback((index: number) => {
    const api = apiRef.current;
    if (!api?.score) return;
    const track = api.score.tracks[index];
    if (!track) return;
    api.renderTracks([track]);

    const staff = track.staves?.[0];
    const midi: number[] = staff?.tuning ?? [];
    setTuning(
      midi.length
        ? [...midi]
            .reverse()
            .map((m) => NOTE_NAMES[((m % 12) + 12) % 12])
            .join(" ")
        : "",
    );
  }, []);

  useEffect(() => {
    let disposed = false;
    let api: any; // eslint-disable-line @typescript-eslint/no-explicit-any

    (async () => {
      try {
        const alphaTab = await import("@coderline/alphatab");
        if (disposed || !hostRef.current) return;

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
        api.playerStateChanged.on((e: { state: number }) => {
          if (disposed) return;
          setPlaying(e.state === 1);
          onStateChanged(e.state === 1);
        });
        api.playerPositionChanged.on(
          (e: { currentTime: number; endTime: number; isSeek: boolean }) => {
            if (disposed) return;
            setDurationMs(e.endTime);
            if (!scrubbingRef.current) setPositionMs(e.currentTime);
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabData, songId]);

  // Load the imported mp3 backing track + persisted per-song settings.
  useEffect(() => {
    let url: string | undefined;
    let cancelled = false;
    let metaTimer: ReturnType<typeof setTimeout> | undefined;
    let cleanupAudio: (() => void) | undefined;

    const sync = getAudioSync(songId);
    if (sync) {
      setOffsetMs(sync.offsetMs ?? 0);
      setStoredSyncMap(sync.syncMap ?? null);
      if (typeof sync.backingVol === "number") setBackingVol(sync.backingVol);
      if (typeof sync.backingMuted === "boolean")
        setBackingMuted(sync.backingMuted);
      if (typeof sync.synthVol === "number") setSynthVol(sync.synthVol);
      if (typeof sync.synthMuted === "boolean") setSynthMuted(sync.synthMuted);
    }

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

      const readDuration = () => {
        setAudioMetaReady(true);
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          setAudioDurationSec(audio.duration);
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
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== AUDIO_SYNC_KEY) return;
      const sync = getAudioSync(songId);
      setOffsetMs(sync?.offsetMs ?? 0);
      setStoredSyncMap(sync?.syncMap ?? null);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [songId]);

  useEffect(() => {
    scrubbingRef.current = scrubbing;
  }, [scrubbing]);

  // --- synthesized reference tone -------------------------------------------

  // One synth for the life of the player.
  useEffect(() => {
    const Ctx: typeof AudioContext =
      window.AudioContext ??
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).webkitAudioContext;
    if (!Ctx) return;
    const synth = new TrackSynth(new Ctx());
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
      })
      .catch((err) => {
        console.error("[AlphaTabPlayer] track notes failed", err);
        if (!cancelled) setSynthNoteCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [tabData, selectedTrack]);

  // The synth is positioned by the same mapping as the cursor.
  useEffect(() => {
    synthRef.current?.setSyncMap(syncMap);
  }, [syncMap]);

  useEffect(() => {
    synthRef.current?.setVolume(synthMuted ? 0 : synthVol);
    if (synthPersistTimer.current) clearTimeout(synthPersistTimer.current);
    synthPersistTimer.current = setTimeout(() => {
      patchAudioSync(songId, { synthVol, synthMuted });
    }, PERSIST_DEBOUNCE_MS);
  }, [synthVol, synthMuted, songId]);

  // Re-anchor on every transport event so seeks, loop wraps and speed changes
  // never leave the synth running against a stale time reference.
  useEffect(() => {
    const audio = backingAudioRef.current;
    if (!audio) return;
    const sync = () => {
      const synth = synthRef.current;
      if (!synth) return;
      if (audio.paused) synth.stop();
      else synth.start(audio.currentTime, audio.playbackRate || 1);
    };
    for (const ev of ["play", "playing", "pause", "seeked", "ratechange", "ended"]) {
      audio.addEventListener(ev, sync);
    }
    return () => {
      for (const ev of ["play", "playing", "pause", "seeked", "ratechange", "ended"]) {
        audio.removeEventListener(ev, sync);
      }
    };
  }, [hasBacking]);

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
            startSec: b.scoreTimeSec,
          })),
          endSec: tl.endSec,
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
  syncMapRef.current = syncMap;
  positionMsRef.current = positionMs;
  syncSourceRef.current = syncSource;
  scoreDurRef.current = scoreDurationSec;
  audioDurRef.current = audioDurationSec;
  useEffect(() => {
    return installSyncDebug({
      getMap: () => syncMapRef.current,
      getScoreTimeSec: () => positionMsRef.current / 1000,
      getAudioTimeSec: () => backingAudioRef.current?.currentTime ?? 0,
      getSource: () => syncSourceRef.current,
      getScoreDurationSec: () => scoreDurRef.current,
      getAudioDurationSec: () => audioDurRef.current,
    });
  }, []);

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
  useEffect(() => {
    const audio = backingAudioRef.current;
    if (audio) audio.volume = backingMuted ? 0 : Math.min(1, backingVol);

    if (backingPersistTimer.current) clearTimeout(backingPersistTimer.current);
    backingPersistTimer.current = setTimeout(() => {
      patchAudioSync(songId, { backingVol, backingMuted });
    }, PERSIST_DEBOUNCE_MS);
  }, [backingVol, backingMuted, hasBacking, playerReady, songId]);

  useEffect(() => {
    return () => {
      if (offsetPersistTimer.current) clearTimeout(offsetPersistTimer.current);
      if (backingPersistTimer.current) clearTimeout(backingPersistTimer.current);
    };
  }, []);

  const togglePlay = useCallback(() => {
    // Resume the synth's AudioContext on the click itself. Chrome starts it
    // suspended, and the path click → alphaTab → <audio> play event is too many
    // async hops to reliably keep the user-activation that `resume()` needs.
    synthRef.current?.resume();
    apiRef.current?.playPause();
  }, []);

  const stop = useCallback(() => {
    apiRef.current?.stop();
    setPositionMs(0);
    synthRef.current?.stop();
    const audio = backingAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  }, []);

  function toggleLoop() {
    const next = !looping;
    setLooping(next);
    if (apiRef.current) apiRef.current.isLooping = next;
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
      patchAudioSync(songId, {
        offsetMs: clamped,
        ...(nextMap ? { syncMap: nextMap } : {}),
      });
    }, PERSIST_DEBOUNCE_MS);
  }

  function handleOffsetReset() {
    setStoredSyncMap(null);
    patchAudioSync(songId, { offsetMs: 0, syncMap: undefined });
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

  /** Offline DTW alignment via /api/align; produces a nonlinear map. */
  async function handleDtwAlign() {
    setDtwRunning(true);
    setSyncMessage("Running DTW alignment… (this can take a minute)");
    try {
      const blob = await getBackingAudio(songId);
      if (!blob) {
        setSyncMessage("No recording to align against.");
        return;
      }
      const result = await new DtwSyncGenerator().generate({
        songId,
        gpBytes: base64ToBytes(tabData),
        audioBlob: blob,
        scoreDurationSec,
        audioDurationSec,
        // Existing manual anchors are sent along so the refiner can solve
        // between them instead of re-solving the whole song globally.
        anchors: storedSyncMap?.anchors ?? [],
      });
      if (result.status === "failed" || result.points.length < 2) {
        setSyncMessage(result.message ?? "DTW alignment failed.");
        return;
      }
      const stored: StoredSyncMap = {
        points: result.points,
        // Manual corrections survive a re-run.
        anchors: storedSyncMap?.anchors ?? [],
        method: result.method,
        status: result.status === "low-confidence" ? "low-confidence" : "ok",
        scoreEndSec: scoreDurationSec || undefined,
        audioDurationSec: audioDurationSec || undefined,
        diagnostics: result.diagnostics as Record<string, unknown> | undefined,
        createdAt: Date.now(),
      };
      setStoredSyncMap(stored);
      setOffsetMs(0);
      patchAudioSync(songId, { syncMap: stored, offsetMs: 0 });
      applySync();
      setSyncMessage(
        result.status === "low-confidence"
          ? `Aligned with low confidence — review suspicious sections. ${result.message ?? ""}`
          : `Aligned: ${result.points.length} points via ${result.method}.`,
      );
    } catch (err) {
      setSyncMessage(`DTW alignment error: ${(err as Error).message}`);
    } finally {
      setDtwRunning(false);
    }
  }

  const controlsDisabled = !playerReady || !audioMetaReady;

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
    status === "error" || status !== "ready" || !audioMetaReady;
  const overlayText =
    status === "error"
      ? "Could not render this tab file."
      : status !== "ready"
        ? "Rendering tab…"
        : "Loading recording…";

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/5 bg-surface-raised px-4 py-3">
        <Button
          size="icon"
          aria-label={playing ? "Pause" : "Play"}
          disabled={controlsDisabled}
          onClick={togglePlay}
        >
          {playing ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Stop"
          disabled={controlsDisabled}
          onClick={stop}
        >
          <Square className="h-4 w-4" />
        </Button>

        {trackNames.length > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-zinc-400">
            <Select
              aria-label="Instrument"
              value={selectedTrack}
              onChange={(e) => selectTrack(Number(e.target.value))}
              className="max-w-[13rem]"
            >
              {trackNames.map((name, i) => (
                <option key={i} value={i}>
                  {name}
                </option>
              ))}
            </Select>
            {tuning && (
              <span className="hidden text-[11px] text-zinc-500 sm:inline">
                {tuning}
              </span>
            )}
          </label>
        )}

        <div className="flex min-w-[12rem] flex-1 items-center gap-3 text-xs text-zinc-400">
          <span className="tabular-nums">{formatMs(positionMs)}</span>
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
            className="h-1 flex-1 cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Seek"
          />
          <span className="tabular-nums">{formatMs(durationMs)}</span>
        </div>

        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="shrink-0">Speed</span>
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
            className="h-1 w-24 cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Playback speed"
            aria-valuetext={`${speedToPercent(speed)}%`}
          />
          <span className="w-9 shrink-0 tabular-nums">
            {speedToPercent(speed)}%
          </span>
        </label>

        {/* Recording and synth levels stay side by side; flex-wrap would
            otherwise strand them on separate rows. */}
        {(hasBacking || synthNoteCount > 0) && (
          <div className="flex shrink-0 items-center gap-2">
            {hasBacking && (
              <BackingVolumeControl
                volume={backingVol}
                muted={backingMuted}
                onVolume={setBackingVol}
                onMuteToggle={() => setBackingMuted((m) => !m)}
                disabled={controlsDisabled}
              />
            )}
            {synthNoteCount > 0 && (
              <SynthVolumeControl
                volume={synthVol}
                muted={synthMuted}
                onVolume={setSynthVol}
                onMuteToggle={() => setSynthMuted((m) => !m)}
                trackName={trackNames[selectedTrack]}
                disabled={controlsDisabled}
              />
            )}
          </div>
        )}

        {hasBacking && (
          <AudioOffsetControl
            compact
            offsetMs={offsetMs}
            onChange={handleOffsetChange}
            onReset={handleOffsetReset}
            onAutoAlign={handleAutoAlign}
            autoAligning={autoAligning}
            disabled={controlsDisabled}
          />
        )}

        <Button
          variant="ghost"
          size="icon"
          aria-label="Toggle loop"
          aria-pressed={looping}
          disabled={controlsDisabled}
          className={cn(looping && "text-accent")}
          onClick={toggleLoop}
        >
          <Repeat className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Toggle mixer"
          aria-pressed={mixerOpen}
          className={cn(mixerOpen && "text-accent")}
          onClick={() => setMixerOpen((o) => !o)}
        >
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
        {IS_DEV && hasBacking && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Sync diagnostics"
            aria-pressed={diagOpen}
            className={cn(diagOpen && "text-accent")}
            onClick={() => setDiagOpen((o) => !o)}
          >
            <Activity className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Print"
          disabled={status !== "ready"}
          onClick={() => apiRef.current?.print()}
        >
          <Printer className="h-4 w-4" />
        </Button>
      </div>

      <div
        ref={viewportRef}
        className="relative min-h-[360px] flex-1 overflow-auto rounded-lg border border-white/5 bg-white text-black"
      >
        {overlayVisible && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-surface-raised text-sm text-zinc-400">
            {status !== "error" && <Loader2 className="h-6 w-6 animate-spin" />}
            <p>{overlayText}</p>
          </div>
        )}
        <div ref={hostRef} className="alphatab-host p-4" />
      </div>

      {mixerOpen && (
        <Mixer
          recordMode
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
