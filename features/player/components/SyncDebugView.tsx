"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { ArrowLeft, Play, Pause, Square, Loader2, Ruler } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/cn";
import { base64ToBytes } from "@/features/library/data/tabFile";
import {
  useSongById,
  getAudioSync,
  getPreferredTrackIndex,
  upsertSyncAnchor,
  AUDIO_SYNC_EVENT,
  type SyncAnchor,
} from "@/features/library/data/songStore";
import { getBackingAudio } from "@/features/player/data/audioStore";
import { buildPlaybackSyncMap } from "@/features/player/data/buildSyncMap";
import type { SyncMap } from "@/features/player/data/syncMap";
import {
  extractScoreTimeline,
  type ScoreTimeline,
} from "@/features/player/data/scoreTimeline";
import { computePeaks, decodeAudio, type Peaks } from "@/features/player/data/waveform";
import {
  onsetEnvelope,
  nearestOnset,
  summariseResiduals,
  type OnsetHit,
  type OnsetEnvelope,
} from "@/features/player/data/onsetDetect";
import { SyncDebugSession } from "@/features/player/data/syncDebugSession";
import { SyncAnchorEditor } from "@/features/player/components/SyncAnchorEditor";
import {
  alignmentLayout,
  drawAlignmentStack,
  hitAlignmentRegion,
  hitAnchor,
  hitScoreEvent,
  type ScoreMarker,
} from "@/features/player/components/SyncAlignmentCanvas";
import {
  extractTrackTab,
  type SynthNote,
} from "@/features/player/data/trackSynth";

interface Marker extends ScoreMarker {}

/** An anchor is "applied" if the built map lands within this of its audio time. */
export const ANCHOR_TOLERANCE_SEC = 0.02;

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

function residualColour(absMs: number): string {
  if (absMs < 40) return "#16181c";
  if (absMs < 100) return "#fbbf24";
  return "#f87171";
}

export function SyncDebugView({ songId }: { songId: string }) {
  const song = useSongById(songId);

  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [timeline, setTimeline] = useState<ScoreTimeline | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncVersion, setSyncVersion] = useState(0);
  const [selectedScoreTime, setSelectedScoreTime] = useState<number | null>(null);
  const [scoreNotes, setScoreNotes] = useState<SynthNote[]>([]);
  const [stringCount, setStringCount] = useState(6);
  const [dragAnchor, setDragAnchor] = useState<{
    scoreTime: number;
    audioTime: number;
  } | null>(null);

  const [pxPerSec, setPxPerSec] = useState(80);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(0.85);
  const [clickMode, setClickMode] = useState<"off" | "bars" | "beats">("off");
  const [clickVol] = useState(0.4);
  const [playing, setPlaying] = useState(false);
  const [posSec, setPosSec] = useState(0);
  const [measuring, setMeasuring] = useState(false);
  const [hits, setHits] = useState<OnsetHit[] | null>(null);

  const sessionRef = useRef<SyncDebugSession | null>(null);
  const envRef = useRef<OnsetEnvelope | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const layout = useMemo(() => alignmentLayout(stringCount), [stringCount]);

  // --- load -----------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setBuffer(null);
    setTimeline(null);
    setHits(null);

    (async () => {
      try {
        const blob = await getBackingAudio(songId);
        if (!blob) throw new Error("No recording stored for this song.");
        if (!cancelled) setAudioBlob(blob);
        const decoded = await decodeAudio(blob);
        if (cancelled) return;
        setBuffer(decoded);

        if (song?.tabData) {
          const gpBytes = base64ToBytes(song.tabData);
          const tl = await extractScoreTimeline(gpBytes);
          if (!cancelled) setTimeline(tl);
          const trackIdx = getPreferredTrackIndex(songId) ?? 0;
          const tab = await extractTrackTab(gpBytes, trackIdx);
          if (!cancelled) {
            setScoreNotes(tab.notes);
            setStringCount(tab.stringCount);
          }
        } else {
          throw new Error("No Guitar Pro file stored for this song.");
        }
      } catch (err) {
        if (!cancelled) setLoadError((err as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [songId, song?.tabData]);

  useEffect(() => {
    const bump = () => setSyncVersion((v) => v + 1);
    window.addEventListener(AUDIO_SYNC_EVENT, bump);
    window.addEventListener("storage", bump);
    return () => {
      window.removeEventListener(AUDIO_SYNC_EVENT, bump);
      window.removeEventListener("storage", bump);
    };
  }, []);

  // --- session ------------------------------------------------------------
  useEffect(() => {
    if (!buffer) return;
    const session = new SyncDebugSession(buffer);
    session.setVolume(volume);
    session.setClickVolume(clickVol);
    session.setEndedCallback(() => setPlaying(false));
    sessionRef.current = session;
    return () => {
      session.dispose();
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer]);

  useEffect(() => {
    sessionRef.current?.setVolume(volume);
  }, [volume]);
  useEffect(() => {
    sessionRef.current?.setClickVolume(clickVol);
  }, [clickVol]);
  useEffect(() => {
    sessionRef.current?.setRate(rate);
  }, [rate]);

  // --- sync map ---------------------------------------------------------------
  const syncSettings = useMemo(
    () => getAudioSync(songId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [songId, syncVersion],
  );

  const { syncMap, syncSource, syncWarning, anchors } = useMemo(() => {
    if (!timeline || !buffer) {
      return {
        syncMap: null as SyncMap | null,
        syncSource: "none" as const,
        syncWarning: undefined,
        anchors: [] as SyncAnchor[],
      };
    }
    const built = buildPlaybackSyncMap({
      stored: syncSettings?.syncMap ?? null,
      offsetMs: syncSettings?.offsetMs ?? 0,
      scoreEndSec: timeline.endSec,
      audioDurationSec: buffer.duration,
    });
    return {
      syncMap: built.syncMap,
      syncSource: built.syncSource,
      syncWarning: built.syncWarning,
      anchors: built.anchors,
    };
  }, [timeline, buffer, syncSettings, syncVersion]);

  // --- bar / beat grid -------------------------------------------------------
  const markers = useMemo<Marker[]>(() => {
    if (!timeline || !syncMap) return [];
    const downbeats = new Set(timeline.bars.map((b) => b.scoreTimeSec.toFixed(3)));
    const barNumber = new Map(
      timeline.bars.map((b) => [b.scoreTimeSec.toFixed(3), `${b.barIndex + 1}`]),
    );
    return timeline.beatSec.map((s) => {
      const key = s.toFixed(3);
      const isDownbeat = downbeats.has(key);
      return {
        label: isDownbeat ? (barNumber.get(key) ?? "") : "",
        scoreTimeSec: s,
        audioTimeSec: syncMap.scoreTimeToAudioTime(s),
        isDownbeat,
      };
    });
  }, [timeline, syncMap]);

  // --- click overlay --------------------------------------------------------
  useEffect(() => {
    const session = sessionRef.current;
    if (!session || !timeline || !syncMap) return;
    if (clickMode === "off") {
      session.setClicks([], new Set());
      return;
    }
    const src =
      clickMode === "bars"
        ? timeline.bars.map((b) => b.scoreTimeSec)
        : timeline.beatSec;
    const downbeats = new Set(timeline.bars.map((b) => b.scoreTimeSec.toFixed(3)));
    const times = src.map((s) => syncMap.scoreTimeToAudioTime(s));
    const accents = new Set<number>();
    src.forEach((s, i) => {
      if (clickMode === "bars" || downbeats.has(s.toFixed(3))) accents.add(i);
    });
    session.setClicks(times, accents);
  }, [clickMode, timeline, syncMap, playing]);

  // --- measure -------------------------------------------------------------
  const measure = useCallback(() => {
    if (!buffer) return;
    setMeasuring(true);
    // Yield so the spinner paints before the (sync) DSP.
    setTimeout(() => {
      if (!envRef.current) envRef.current = onsetEnvelope(buffer);
      const env = envRef.current;
      const targets = markers.filter((m) => m.isDownbeat);
      const results = targets.map((m) => nearestOnset(env, m.audioTimeSec));
      setHits(results);
      setMeasuring(false);
    }, 20);
  }, [buffer, markers]);

  useEffect(() => setHits(null), [syncMap]);

  // --- peaks + base render -------------------------------------------------
  const peaks = useMemo<Peaks | null>(() => {
    if (!buffer) return null;
    const width = Math.ceil(buffer.duration * pxPerSec);
    return computePeaks(buffer, Math.min(width, 200_000));
  }, [buffer, pxPerSec]);

  const suspectRegions = useMemo(() => {
    const raw = syncSettings?.syncMap?.diagnostics?.suspectRegions;
    if (!Array.isArray(raw) || !syncMap) return [];
    return raw as Array<{ scoreStart: number; scoreEnd: number; reason: string }>;
  }, [syncSettings, syncMap]);

  /**
   * Where the built map *actually* sends each anchor's score time. A sync map has
   * to be monotonic, so an anchor that would make audio time run backwards
   * relative to its neighbours gets flattened away by `SyncMap.fromPoints`. It
   * still sits in the list looking authoritative, which reads as "the debugger
   * ignored my edit" — so surface it instead.
   */
  const appliedAudioTimes = useMemo(() => {
    const m = new Map<number, number>();
    if (!syncMap) return m;
    for (const a of anchors) {
      m.set(a.scoreTime, syncMap.scoreTimeToAudioTime(a.scoreTime));
    }
    return m;
  }, [syncMap, anchors]);

  const unappliedAnchors = useMemo(() => {
    const s = new Set<number>();
    for (const a of anchors) {
      const got = appliedAudioTimes.get(a.scoreTime);
      if (got != null && Math.abs(got - a.audioTime) > ANCHOR_TOLERANCE_SEC) {
        s.add(a.scoreTime);
      }
    }
    return s;
  }, [anchors, appliedAudioTimes]);

  const liveErrorMs = useMemo(() => {
    if (!syncMap || !timeline) return null;
    const scoreTime = syncMap.audioTimeToScoreTime(posSec);
    const mapped = syncMap.scoreTimeToAudioTime(scoreTime);
    return (mapped - posSec) * 1000;
  }, [syncMap, timeline, posSec]);

  const renderBase = useCallback(() => {
    if (!peaks || !buffer) return;
    const width = Math.ceil(buffer.duration * pxPerSec);
    let base = baseCanvasRef.current;
    if (!base) {
      base = document.createElement("canvas");
      baseCanvasRef.current = base;
    }
    base.width = width;
    base.height = layout.total;
    const g = base.getContext("2d");
    if (!g) return;

    drawAlignmentStack(g, {
      width,
      pxPerSec,
      layout,
      peaks,
      syncMap,
      anchors,
      notes: scoreNotes,
      markers,
      selectedScoreTime,
      suspectRegions,
      hits,
      unappliedAnchors,
      dragAnchorScoreTime: dragAnchor?.scoreTime ?? null,
      dragAudioTime: dragAnchor?.audioTime ?? null,
    });
  }, [
    peaks,
    buffer,
    pxPerSec,
    layout,
    markers,
    hits,
    anchors,
    suspectRegions,
    syncMap,
    selectedScoreTime,
    scoreNotes,
    dragAnchor,
    unappliedAnchors,
  ]);

  useEffect(() => {
    renderBase();
    // one static blit for the paused state
    const c = canvasRef.current;
    const base = baseCanvasRef.current;
    if (c && base) {
      c.width = base.width;
      c.height = base.height;
      const g = c.getContext("2d");
      g?.drawImage(base, 0, 0);
    }
  }, [renderBase]);

  // --- animation loop -----------------------------------------------------
  useEffect(() => {
    const tick = () => {
      const session = sessionRef.current;
      const c = canvasRef.current;
      const base = baseCanvasRef.current;
      if (session && c && base) {
        const pos = session.positionSec();
        setPosSec(pos);
        const g = c.getContext("2d");
        if (g) {
          g.drawImage(base, 0, 0);
          const x = pos * pxPerSec;
          g.strokeStyle = "#f87171";
          g.lineWidth = 1.5;
          g.beginPath();
          g.moveTo(x, 0);
          g.lineTo(x, base.height);
          g.stroke();
          g.lineWidth = 1;
        }
        // keep playhead in view
        const sc = scrollRef.current;
        if (sc && session.playing) {
          const x = pos * pxPerSec;
          if (x < sc.scrollLeft + 80 || x > sc.scrollLeft + sc.clientWidth - 80) {
            sc.scrollLeft = x - sc.clientWidth * 0.3;
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [pxPerSec]);

  // --- transport -----------------------------------------------------------
  const togglePlay = () => {
    const s = sessionRef.current;
    if (!s) return;
    if (s.playing) {
      s.pause();
      setPlaying(false);
    } else {
      void s.play();
      setPlaying(true);
    }
  };
  const stop = () => {
    sessionRef.current?.pause();
    sessionRef.current?.seek(0);
    setPlaying(false);
    setPosSec(0);
  };
  const dragMovedRef = useRef(false);

  const pointerToAudio = (clientX: number, clientY: number) => {
    const sc = scrollRef.current;
    const canvas = canvasRef.current;
    if (!sc || !canvas) return null;
    const rect = sc.getBoundingClientRect();
    const x = clientX - rect.left + sc.scrollLeft;
    const y = clientY - rect.top;
    return {
      audioTime: x / pxPerSec,
      region: hitAlignmentRegion(y, layout),
    };
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragMovedRef.current = false;
    const hit = pointerToAudio(e.clientX, e.clientY);
    if (!hit || !syncMap) return;

    if (hit.region === "anchor") {
      const anchor = hitAnchor(anchors, hit.audioTime, pxPerSec);
      if (anchor) {
        setDragAnchor({ scoreTime: anchor.scoreTime, audioTime: anchor.audioTime });
        (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
      }
      return;
    }

    if (hit.region === "tab") {
      setSelectedScoreTime(
        hitScoreEvent(scoreNotes, markers, syncMap, hit.audioTime, pxPerSec),
      );
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragAnchor) return;
    dragMovedRef.current = true;
    const hit = pointerToAudio(e.clientX, e.clientY);
    if (!hit) return;
    let audio = hit.audioTime;
    if (envRef.current) {
      const snap = nearestOnset(envRef.current, audio, 0.08);
      if (snap.found && snap.strength > 0.3) audio = snap.onsetSec;
    }
    setDragAnchor({ ...dragAnchor, audioTime: Math.max(0, audio) });
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragAnchor) {
      upsertSyncAnchor(songId, {
        scoreTime: dragAnchor.scoreTime,
        audioTime: dragAnchor.audioTime,
        label: `anchor @ ${fmt(dragAnchor.scoreTime)}`,
      });
      setSyncVersion((v) => v + 1);
      setDragAnchor(null);
      (e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId);
    }
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragMovedRef.current) {
      dragMovedRef.current = false;
      return;
    }
    const hit = pointerToAudio(e.clientX, e.clientY);
    if (!hit || !sessionRef.current) return;

    // The tab row selects; pointerDown already handled it.
    if (hit.region === "tab") return;

    // Shift+click in the waveform anchors the selected note to that attack.
    if (e.shiftKey && selectedScoreTime != null && hit.region === "wave") {
      let audio = hit.audioTime;
      if (!envRef.current && buffer) envRef.current = onsetEnvelope(buffer);
      if (envRef.current) {
        const snap = nearestOnset(envRef.current, audio, 0.25);
        if (snap.found) audio = snap.onsetSec;
      }
      upsertSyncAnchor(songId, {
        scoreTime: selectedScoreTime,
        audioTime: audio,
        label: `anchor @ ${fmt(selectedScoreTime)}`,
      });
      setSyncVersion((v) => v + 1);
      return;
    }

    sessionRef.current.seek(hit.audioTime);
    setPosSec(hit.audioTime);
  };

  const stats = hits ? summariseResiduals(hits) : null;
  const worst = useMemo(() => {
    if (!hits) return [];
    const downbeats = markers.filter((m) => m.isDownbeat);
    return hits
      .map((h, i) => ({ h, m: downbeats[i] }))
      .filter((r) => r.h.found && r.m)
      .sort((a, b) => Math.abs(b.h.residualSec) - Math.abs(a.h.residualSec))
      .slice(0, 12);
  }, [hits, markers]);

  const method = syncMap?.diagnostics?.method ?? "offset";
  const width = buffer ? Math.ceil(buffer.duration * pxPerSec) : 0;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Link
          href={`/player/${songId}`}
          className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Player
        </Link>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-lg font-semibold">
            Sync{song ? ` · ${song.title}` : ""}
          </h1>
          <span className="text-xs text-zinc-500">
            {method}
            {syncSource === "dtw" && " (DTW)"}
            {syncMap && ` · ${syncMap.points.length} points`}
            {timeline?.hasRepeats &&
              ` · repeats expanded (${timeline.bars.length} played bars)`}
          </span>
          {liveErrorMs != null && (
            <span
              className={cn(
                "text-xs tabular-nums",
                Math.abs(liveErrorMs) < 40
                  ? "text-accent"
                  : Math.abs(liveErrorMs) < 100
                    ? "text-amber-400"
                    : "text-accent",
              )}
            >
              {liveErrorMs >= 0 ? "+" : ""}
              {liveErrorMs.toFixed(0)} ms
            </span>
          )}
        </div>
        {syncWarning && (
          <p className="mt-1 text-[11px] text-amber-300">{syncWarning}</p>
        )}
      </div>

      {loadError && (
        <p className="rounded-sm border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {loadError}
        </p>
      )}

      {!buffer || !timeline ? (
        !loadError && (
          <p className="flex items-center gap-2 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Decoding audio &amp;
            reading the score…
          </p>
        )
      ) : (
        <>
          {/* transport */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-sm border border-rule bg-paper-raised px-4 py-2.5 text-xs text-zinc-400">
            <Button size="icon" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button size="icon" variant="ghost" aria-label="Stop" onClick={stop}>
              <Square className="h-4 w-4" />
            </Button>
            <span className="tabular-nums text-zinc-200">
              {fmt(posSec)} / {fmt(buffer.duration)}
            </span>

            <label className="flex items-center gap-1">
              Zoom
              <input
                type="range"
                min={20}
                max={400}
                step={5}
                value={pxPerSec}
                onChange={(e) => setPxPerSec(Number(e.target.value))}
                className="w-28"
                aria-label="Zoom px per second"
              />
            </label>

            <label className="flex items-center gap-1">
              Speed
              <Select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
                {[0.25, 0.5, 0.75, 1].map((v) => (
                  <option key={v} value={v}>
                    {v}x
                  </option>
                ))}
              </Select>
            </label>

            <label className="flex items-center gap-1">
              Vol
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="w-20"
                aria-label="Recording volume"
              />
            </label>

            <label className="flex items-center gap-1">
              Click
              <Select
                value={clickMode}
                onChange={(e) =>
                  setClickMode(e.target.value as "off" | "bars" | "beats")
                }
              >
                <option value="off">off</option>
                <option value="bars">bars</option>
                <option value="beats">beats</option>
              </Select>
            </label>
          </div>

          <p className="text-[11px] text-zinc-500">
            A fret number should sit directly above the attack it plays. Click a
            note to select it, then Shift+click its peak in the waveform to
            anchor. Drag the numbered pins to fine-tune.
          </p>

          <div
            ref={scrollRef}
            className="overflow-x-auto rounded-sm border border-rule bg-paper"
          >
            <canvas
              ref={canvasRef}
              width={width}
              height={layout.total}
              style={{ width, height: layout.total, display: "block" }}
              onClick={handleCanvasClick}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              className="cursor-crosshair touch-none"
            />
          </div>

          <SyncAnchorEditor
            songId={songId}
            tabData={song?.tabData}
            audioBlob={audioBlob}
            timeline={timeline}
            syncMap={syncMap}
            anchors={anchors}
            posSec={posSec}
            onsetEnv={envRef.current}
            selectedScoreTime={selectedScoreTime}
            appliedAudioTimes={appliedAudioTimes}
            onAnchorsChange={() => setSyncVersion((v) => v + 1)}
          />

          <details className="rounded-sm border border-rule bg-paper-raised text-xs text-zinc-400">
            <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-zinc-300">
              Diagnostics
            </summary>
            <div className="flex flex-col gap-4 border-t border-rule p-4">
              {syncSettings?.syncMap?.diagnostics && (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                  {(
                    [
                      ["residualRmsMs", "RMS residual", "ms", 80],
                      ["residualMaxMs", "Max residual", "ms", 120],
                      ["pathStability", "Path stability", "", 0.6],
                      ["referenceRender", "Reference", "", null],
                    ] as const
                  ).map(([key, label, unit, threshold]) => {
                    const val = syncSettings.syncMap!.diagnostics![key];
                    if (val == null) return null;
                    const num = typeof val === "number" ? val : null;
                    const ok =
                      threshold == null || num == null
                        ? true
                        : key === "pathStability"
                          ? num >= threshold
                          : num < threshold;
                    return (
                      <div key={key}>
                        <dt className="text-zinc-500">{label}</dt>
                        <dd
                          className={cn(
                            "tabular-nums",
                            ok ? "text-accent" : "text-amber-400",
                          )}
                        >
                          {String(val)}
                          {unit ? ` ${unit}` : ""}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              )}

              <div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={measure}
                  disabled={measuring}
                >
                  {measuring ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Ruler className="h-3.5 w-3.5" />
                  )}
                  <span className="ml-1">Measure onsets</span>
                </Button>
              </div>

              {stats && (
                <>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <Stat label="Measured" value={`${stats.measured}/${stats.count}`} />
                    <Stat
                      label="Mean |err|"
                      value={`${stats.meanAbsMs} ms`}
                      tone={stats.meanAbsMs}
                    />
                    <Stat
                      label="Median |err|"
                      value={`${stats.medianAbsMs} ms`}
                      tone={stats.medianAbsMs}
                    />
                    <Stat label="p90 |err|" value={`${stats.p90AbsMs} ms`} tone={stats.p90AbsMs} />
                    <Stat label="Max |err|" value={`${stats.maxAbsMs} ms`} tone={stats.maxAbsMs} />
                    <Stat
                      label="Mean signed"
                      value={`${stats.meanSignedMs >= 0 ? "+" : ""}${stats.meanSignedMs} ms`}
                    />
                  </div>

                  <ResidualScatter
                    hits={hits!}
                    markers={markers}
                    endSec={timeline.endSec}
                  />

                  {worst.length > 0 && (
                    <table className="w-full text-left text-xs">
                      <thead className="text-zinc-500">
                        <tr>
                          <th className="py-1 pr-3">Bar</th>
                          <th className="py-1 pr-3">Score t</th>
                          <th className="py-1 pr-3">Predicted audio t</th>
                          <th className="py-1 pr-3">Detected onset</th>
                          <th className="py-1 pr-3">Residual</th>
                        </tr>
                      </thead>
                      <tbody className="tabular-nums text-zinc-300">
                        {worst.map(({ h, m }, i) => (
                          <tr key={i} className="border-t border-rule">
                            <td className="py-1 pr-3">{m.label}</td>
                            <td className="py-1 pr-3">{m.scoreTimeSec.toFixed(3)}s</td>
                            <td className="py-1 pr-3">{m.audioTimeSec.toFixed(3)}s</td>
                            <td className="py-1 pr-3">{h.onsetSec.toFixed(3)}s</td>
                            <td
                              className="py-1 pr-3 font-medium"
                              style={{
                                color: residualColour(Math.abs(h.residualSec * 1000)),
                              }}
                            >
                              {h.residualSec >= 0 ? "+" : ""}
                              {(h.residualSec * 1000).toFixed(0)} ms
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: number;
}) {
  return (
    <div className="flex flex-col">
      <span
        className={cn(
          "text-lg font-semibold tabular-nums",
          tone == null
            ? "text-zinc-100"
            : tone < 40
              ? "text-accent"
              : tone < 100
                ? "text-amber-400"
                : "text-accent",
        )}
      >
        {value}
      </span>
      <span className="text-[11px] text-zinc-500">{label}</span>
    </div>
  );
}

function ResidualScatter({
  hits,
  markers,
  endSec,
}: {
  hits: OnsetHit[];
  markers: Marker[];
  endSec: number;
}) {
  const W = 640;
  const H = 90;
  const downbeats = markers.filter((m) => m.isDownbeat);
  const measured = hits
    .map((h, i) => ({ h, m: downbeats[i] }))
    .filter((r) => r.h.found && r.m);
  const maxAbs = Math.max(
    60,
    ...measured.map((r) => Math.abs(r.h.residualSec * 1000)),
  );
  const x = (s: number) => (s / Math.max(endSec, 1)) * W;
  const y = (ms: number) => H / 2 - (ms / maxAbs) * (H / 2 - 6);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Residual vs score time"
    >
      <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="#3f3f46" strokeWidth={1} />
      {[40, -40].map((v) => (
        <line
          key={v}
          x1={0}
          y1={y(v)}
          x2={W}
          y2={y(v)}
          stroke="#27272a"
          strokeDasharray="2 3"
        />
      ))}
      {measured.map((r, i) => {
        const ms = r.h.residualSec * 1000;
        return (
          <circle
            key={i}
            cx={x(r.m.scoreTimeSec)}
            cy={y(ms)}
            r={2}
            fill={residualColour(Math.abs(ms))}
          />
        );
      })}
      <text x={2} y={10} fontSize={9} fill="#71717a">
        +{Math.round(maxAbs)} ms
      </text>
      <text x={2} y={H - 3} fontSize={9} fill="#71717a">
        −{Math.round(maxAbs)} ms
      </text>
    </svg>
  );
}
