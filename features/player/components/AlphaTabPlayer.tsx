"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  Square,
  Repeat,
  Bell,
  Printer,
  Loader2,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/cn";
import { base64ToBytes } from "@/features/library/data/tabFile";
import {
  getPreferredTrackIndex,
  setPreferredTrackIndex,
} from "@/features/library/data/songStore";
import { getBackingAudio } from "@/features/player/data/audioStore";
import { Mixer, type MixerTrack } from "./Mixer";

// alphaTab's worker/worklet scripts must be same-origin, so its runtime assets
// (script, worker, worklet, music font, soundfont) are copied to
// `public/alphatab` and served locally. See README.
const ALPHATAB_ASSETS = "/alphatab";

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
  /** Song id, used to load the backing track and remember the chosen instrument. */
  songId: string;
  /** Base64-encoded Guitar Pro / PowerTab file bytes. */
  tabData: string;
}

/**
 * Renders an imported multi-track tab with alphaTab: instrument picker (drives
 * which staff is shown), synth playback with an animated beat cursor, a channel
 * mixer for every score track plus the imported mp3 backing track. alphaTab
 * needs the DOM, so this is client-only and the module is imported lazily.
 */
export function AlphaTabPlayer({ songId, tabData }: AlphaTabPlayerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const backingAudioRef = useRef<HTMLAudioElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiRef = useRef<any>(null);
  // Read by the position listener so a drag doesn't fight the playhead.
  const scrubbingRef = useRef(false);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [soundFontProgress, setSoundFontProgress] = useState(0);
  const [playerReady, setPlayerReady] = useState(false);
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

  // Mixer state
  const [mixerOpen, setMixerOpen] = useState(false);
  const [master, setMaster] = useState(1);
  const [metronomeVol, setMetronomeVol] = useState(0);
  const [hasBacking, setHasBacking] = useState(false);
  const [backingVol, setBackingVol] = useState(0.8);
  const [backingMuted, setBackingMuted] = useState(false);

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
        ? [...midi].reverse().map((m) => NOTE_NAMES[((m % 12) + 12) % 12]).join(" ")
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
            enablePlayer: true,
            // Playback cursors: the bar wash, the animated beat "slider" that
            // glides toward the next note, and highlighting of the sounding
            // notes. Styled in globals.css under `.alphatab-host`.
            enableCursor: true,
            enableAnimatedBeatCursor: true,
            enableElementHighlighting: true,
            soundFont: `${ALPHATAB_ASSETS}/soundfont/sonivox.sf3`,
            scrollElement: viewportRef.current ?? undefined,
            nativeBrowserSmoothScroll: true,
          },
        });
        apiRef.current = api;

        api.error.on((err: unknown) => {
          console.error("[AlphaTabPlayer] alphaTab error", err);
          if (!disposed) setStatus("error");
        });
        api.renderFinished.on(() => {
          if (!disposed) setStatus("ready");
        });
        api.soundFontLoad.on((e: { loaded: number; total: number }) => {
          if (!disposed && e.total > 0) {
            setSoundFontProgress(Math.round((e.loaded / e.total) * 100));
          }
        });
        api.playerReady.on(() => {
          if (!disposed) setPlayerReady(true);
        });
        api.playerStateChanged.on((e: { state: number }) => {
          if (disposed) return;
          setPlaying(e.state === 1);
          const audio = backingAudioRef.current;
          if (audio) {
            if (e.state === 1) void audio.play().catch(() => {});
            else audio.pause();
          }
        });
        api.playerPositionChanged.on(
          (e: {
            currentTime: number;
            endTime: number;
            isSeek: boolean;
          }) => {
            if (disposed) return;
            setDurationMs(e.endTime);
            if (!scrubbingRef.current) setPositionMs(e.currentTime);

            const audio = backingAudioRef.current;
            if (audio && Number.isFinite(audio.duration)) {
              const target = e.currentTime / 1000;
              if (e.isSeek || Math.abs(audio.currentTime - target) > 0.35) {
                audio.currentTime = target;
              }
            }
          },
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        api.scoreLoaded.on((score: any) => {
          if (disposed) return;
          const scoreTracks: any[] = score.tracks ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
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

  // Load the imported mp3 backing track for this song.
  useEffect(() => {
    let url: string | undefined;
    let cancelled = false;
    getBackingAudio(songId).then((blob) => {
      if (cancelled || !blob || !backingAudioRef.current) return;
      // Re-wrap so the object URL always carries a decodable MIME type.
      const typed =
        blob.type && blob.type.startsWith("audio/")
          ? blob
          : new Blob([blob], { type: "audio/mpeg" });
      url = URL.createObjectURL(typed);
      backingAudioRef.current.src = url;
      backingAudioRef.current.load();
      setHasBacking(true);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [songId]);

  useEffect(() => {
    scrubbingRef.current = scrubbing;
  }, [scrubbing]);

  // Push mixer values into alphaTab once the synth is ready (and on change).
  useEffect(() => {
    if (apiRef.current) apiRef.current.masterVolume = master;
  }, [master, playerReady]);

  useEffect(() => {
    if (apiRef.current) apiRef.current.metronomeVolume = metronomeVol;
  }, [metronomeVol, playerReady]);

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

  useEffect(() => {
    const audio = backingAudioRef.current;
    if (audio) audio.volume = backingMuted ? 0 : Math.min(1, backingVol);
  }, [backingVol, backingMuted, hasBacking]);

  function togglePlay() {
    apiRef.current?.playPause();
  }
  function stop() {
    apiRef.current?.stop();
    setPositionMs(0);
    const audio = backingAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  }
  function toggleLoop() {
    const next = !looping;
    setLooping(next);
    if (apiRef.current) apiRef.current.isLooping = next;
  }
  function toggleMetronome() {
    setMetronomeVol((v) => (v > 0 ? 0 : 1));
  }
  function changeSpeed(value: number) {
    setSpeed(value);
    if (apiRef.current) apiRef.current.playbackSpeed = value;
    if (backingAudioRef.current) backingAudioRef.current.playbackRate = value;
  }

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

  const controlsDisabled = !playerReady;

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

        <div className="flex flex-1 items-center gap-3 text-xs text-zinc-400">
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

        <label className="flex items-center gap-1 text-xs text-zinc-400">
          Speed
          <Select
            value={speed}
            disabled={controlsDisabled}
            onChange={(e) => changeSpeed(Number(e.target.value))}
          >
            {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => (
              <option key={v} value={v}>
                {v}x
              </option>
            ))}
          </Select>
        </label>

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
          aria-label="Toggle metronome"
          aria-pressed={metronomeVol > 0}
          disabled={controlsDisabled}
          className={cn(metronomeVol > 0 && "text-accent")}
          onClick={toggleMetronome}
        >
          <Bell className="h-4 w-4" />
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
        {status !== "ready" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-surface-raised text-sm text-zinc-400">
            {status === "error" ? (
              <p>Could not render this tab file.</p>
            ) : (
              <>
                <Loader2 className="h-6 w-6 animate-spin" />
                <p>
                  {soundFontProgress > 0 && soundFontProgress < 100
                    ? `Loading sounds… ${soundFontProgress}%`
                    : "Rendering tab…"}
                </p>
              </>
            )}
          </div>
        )}
        <div ref={hostRef} className="alphatab-host p-4" />
      </div>

      {mixerOpen && (
        <Mixer
          master={master}
          onMaster={setMaster}
          metronome={metronomeVol}
          onMetronome={setMetronomeVol}
          hasBacking={hasBacking}
          backing={backingVol}
          backingMuted={backingMuted}
          onBacking={setBackingVol}
          onBackingMute={setBackingMuted}
          tracks={tracks}
          shownTrackIndex={selectedTrack}
          onShowTrack={selectTrack}
          onTrackVolume={(i, v) => updateTrack(i, { volume: v })}
          onTrackMute={(i, m) => updateTrack(i, { muted: m })}
          onTrackSolo={(i, s) => updateTrack(i, { soloed: s })}
          onClose={() => setMixerOpen(false)}
        />
      )}

      {!playerReady && status === "ready" && (
        <p className="text-xs text-zinc-500">
          Preparing playback{soundFontProgress ? ` (${soundFontProgress}%)` : ""}…
        </p>
      )}

      <audio ref={backingAudioRef} preload="auto" className="hidden" />
    </div>
  );
}
