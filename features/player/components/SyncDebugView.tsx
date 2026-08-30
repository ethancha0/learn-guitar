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
import { useSongById, getAudioSync, type SyncAnchor } from "@/features/library/data/songStore";
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
import {
  computeOnsetHistogram,
  drawOnsetHistogram,
  nearestPeakSec,
  type OnsetHistogram,
} from "@/features/player/data/onsetHistogram";
import { upsertSyncAnchor } from "@/features/library/data/songStore";
import { SyncDebugSession } from "@/features/player/data/syncDebugSession";
import { SyncAnchorEditor } from "@/features/player/components/SyncAnchorEditor";

const WAVE_H = 120;
const HIST_H = 60;
const CANVAS_H = WAVE_H + HIST_H;
const MARKER_SOURCES = ["bars", "beats", "syncMap"] as const;
type MarkerSource = (typeof MARKER_SOURCES)[number];

interface Marker {
  label: string;
  scoreTimeSec: number;
  audioTimeSec: number;
  isDownbeat: boolean;
}

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

function residualColour(absMs: number): string {
  if (absMs < 40) return "#4ade80";
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

  const [pxPerSec, setPxPerSec] = useState(80);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(0.85);
  const [markerSource, setMarkerSource] = useState<MarkerSource>("bars");
  const [clickMode, setClickMode] = useState<"off" | "bars" | "beats">("off");
  const [clickVol, setClickVol] = useState(0.4);
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
          const tl = await extractScoreTimeline(base64ToBytes(song.tabData));
          if (!cancelled) setTimeline(tl);
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
    window.addEventListener("learn-bass:audio-sync-changed", bump);
    window.addEventListener("storage", bump);
    return () => {
      window.removeEventListener("learn-bass:audio-sync-changed", bump);
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

  // --- markers -----------------------------------------------------------------
  const markers = useMemo<Marker[]>(() => {
    if (!timeline || !syncMap) return [];
    if (markerSource === "syncMap") {
      return syncMap.points.map((p, i) => ({
        label: `p${i}`,
        scoreTimeSec: p.scoreTime,
        audioTimeSec: p.audioTime,
        isDownbeat: true,
      }));
    }
    if (markerSource === "beats") {
      const downbeats = new Set(timeline.bars.map((b) => b.scoreTimeSec.toFixed(3)));
      return timeline.beatSec.map((s, i) => ({
        label: downbeats.has(s.toFixed(3)) ? `${i}` : "",
        scoreTimeSec: s,
        audioTimeSec: syncMap.scoreTimeToAudioTime(s),
        isDownbeat: downbeats.has(s.toFixed(3)),
      }));
    }
    return timeline.bars.map((b) => ({
      label: `${b.barIndex + 1}`,
      scoreTimeSec: b.scoreTimeSec,
      audioTimeSec: syncMap.scoreTimeToAudioTime(b.scoreTimeSec),
      isDownbeat: true,
    }));
  }, [timeline, syncMap, markerSource]);

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

  useEffect(() => setHits(null), [markerSource, syncMap]);

  // --- peaks + base render -------------------------------------------------
  const peaks = useMemo<Peaks | null>(() => {
    if (!buffer) return null;
    const width = Math.ceil(buffer.duration * pxPerSec);
    return computePeaks(buffer, Math.min(width, 200_000));
  }, [buffer, pxPerSec]);

  const onsetHist = useMemo<OnsetHistogram | null>(() => {
    if (!buffer || !peaks) return null;
    if (!envRef.current) envRef.current = onsetEnvelope(buffer);
    return computeOnsetHistogram(
      envRef.current,
      peaks.bucketCount,
      buffer.duration,
    );
  }, [buffer, peaks]);

  const suspectRegions = useMemo(() => {
    const raw = syncSettings?.syncMap?.diagnostics?.suspectRegions;
    if (!Array.isArray(raw) || !syncMap) return [];
    return raw as Array<{ scoreStart: number; scoreEnd: number; reason: string }>;
  }, [syncSettings, syncMap]);

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
    base.height = CANVAS_H;
    const g = base.getContext("2d");
    if (!g) return;
    g.fillStyle = "#0f1115";
    g.fillRect(0, 0, width, CANVAS_H);

    // suspect regions (red tint on waveform)
    if (syncMap && suspectRegions.length) {
      g.fillStyle = "rgba(248,113,113,0.12)";
      for (const r of suspectRegions) {
        const x0 = syncMap.scoreTimeToAudioTime(r.scoreStart) * pxPerSec;
        const x1 = syncMap.scoreTimeToAudioTime(r.scoreEnd) * pxPerSec;
        g.fillRect(x0, 0, x1 - x0, WAVE_H);
      }
    }

    // waveform
    const mid = WAVE_H / 2;
    g.strokeStyle = "#3f5f46";
    g.beginPath();
    for (let b = 0; b < peaks.bucketCount; b++) {
      const x = (b / peaks.bucketCount) * width;
      g.moveTo(x, mid - peaks.minMax[b * 2 + 1] * mid * 0.94);
      g.lineTo(x, mid - peaks.minMax[b * 2] * mid * 0.94);
    }
    g.stroke();

    // beat markers (thin) — only when beats selected
    if (markerSource === "beats") {
      g.strokeStyle = "rgba(148,163,184,0.25)";
      g.beginPath();
      for (const m of markers) {
        if (m.isDownbeat) continue;
        const x = m.audioTimeSec * pxPerSec;
        g.moveTo(x, 12);
        g.lineTo(x, WAVE_H - 12);
      }
      g.stroke();
    }

    // downbeat / bar / point markers
    g.font = "10px ui-monospace, monospace";
    for (const m of markers) {
      if (!m.isDownbeat) continue;
      const x = m.audioTimeSec * pxPerSec;
      g.strokeStyle = "rgba(74,222,128,0.9)";
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, WAVE_H);
      g.stroke();
      if (m.label) {
        g.fillStyle = "rgba(74,222,128,0.9)";
        g.fillText(m.label, x + 2, 11);
      }
    }

    // manual anchor markers (blue)
    for (const a of anchors) {
      const x = a.audioTime * pxPerSec;
      g.strokeStyle = "rgba(96,165,250,0.95)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, WAVE_H);
      g.stroke();
      g.lineWidth = 1;
      g.fillStyle = "#60a5fa";
      g.beginPath();
      g.moveTo(x, 6);
      g.lineTo(x - 5, 16);
      g.lineTo(x + 5, 16);
      g.closePath();
      g.fill();
    }

    // selected beat highlight
    if (selectedScoreTime != null && syncMap) {
      const x = syncMap.scoreTimeToAudioTime(selectedScoreTime) * pxPerSec;
      g.strokeStyle = "rgba(250,204,21,0.8)";
      g.setLineDash([4, 3]);
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, WAVE_H);
      g.stroke();
      g.setLineDash([]);
    }

    // residual ticks (above histogram)
    if (hits) {
      const downbeats = markers.filter((m) => m.isDownbeat);
      hits.forEach((h, i) => {
        const m = downbeats[i];
        if (!m || !h.found) return;
        const px = m.audioTimeSec * pxPerSec;
        const ox = h.onsetSec * pxPerSec;
        const c = residualColour(Math.abs(h.residualSec * 1000));
        g.strokeStyle = c;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(px, WAVE_H - 6);
        g.lineTo(ox, WAVE_H - 20);
        g.stroke();
        g.lineWidth = 1;
        g.fillStyle = c;
        g.beginPath();
        g.arc(ox, WAVE_H - 20, 2.5, 0, Math.PI * 2);
        g.fill();
      });
    }

    // histogram row
    g.fillStyle = "#0a0c0f";
    g.fillRect(0, WAVE_H, width, HIST_H);
    g.strokeStyle = "rgba(255,255,255,0.06)";
    g.beginPath();
    g.moveTo(0, WAVE_H);
    g.lineTo(width, WAVE_H);
    g.stroke();
    if (onsetHist) {
      g.save();
      g.translate(0, WAVE_H);
      drawOnsetHistogram(g, onsetHist, width, HIST_H);
      g.restore();
    }
  }, [
    peaks,
    buffer,
    pxPerSec,
    markers,
    hits,
    markerSource,
    anchors,
    suspectRegions,
    syncMap,
    onsetHist,
    selectedScoreTime,
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
          g.lineTo(x, CANVAS_H);
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
  const seekToClientX = (clientX: number, e?: React.MouseEvent) => {
    const sc = scrollRef.current;
    if (!sc || !sessionRef.current) return;
    const rect = sc.getBoundingClientRect();
    const x = clientX - rect.left + sc.scrollLeft;
    const audioTime = x / pxPerSec;

    const inHistogram = e
      ? (() => {
          const canvas = canvasRef.current;
          if (!canvas) return false;
          const cr = canvas.getBoundingClientRect();
          return e.clientY - cr.top > WAVE_H;
        })()
      : false;

    if (inHistogram && onsetHist) {
      const peak = nearestPeakSec(onsetHist, audioTime, 0.2);
      const target = peak ?? audioTime;
      if (e?.shiftKey && selectedScoreTime != null) {
        upsertSyncAnchor(songId, {
          scoreTime: selectedScoreTime,
          audioTime: target,
          label: `bar @ ${selectedScoreTime.toFixed(2)}s`,
        });
        setSyncVersion((v) => v + 1);
      } else {
        sessionRef.current.seek(target);
        setPosSec(target);
      }
      return;
    }

    if (e?.shiftKey && selectedScoreTime != null) {
      let audio = audioTime;
      if (envRef.current) {
        const hit = nearestOnset(envRef.current, audioTime, 0.35);
        if (hit.found) audio = hit.onsetSec;
      }
      upsertSyncAnchor(songId, {
        scoreTime: selectedScoreTime,
        audioTime: audio,
        label: `bar @ ${selectedScoreTime.toFixed(2)}s`,
      });
      setSyncVersion((v) => v + 1);
      return;
    }

    sessionRef.current.seek(audioTime);
    setPosSec(audioTime);
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
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <Link
            href={`/player/${songId}`}
            className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Player
          </Link>
          <h1 className="mt-1 text-lg font-semibold">
            Sync debug{song ? ` · ${song.title}` : ""}
          </h1>
          <p className="text-sm text-zinc-400">
            GP markers vs recording waveform. Method:{" "}
            <span className="text-zinc-200">{method}</span>
            {syncSource === "dtw" && (
              <span className="ml-2 text-accent">(DTW active)</span>
            )}
            {syncMap && ` · ${syncMap.points.length} sync points`}
            {liveErrorMs != null && (
              <span
                className={cn(
                  "ml-2 tabular-nums",
                  Math.abs(liveErrorMs) < 40
                    ? "text-accent"
                    : Math.abs(liveErrorMs) < 100
                      ? "text-amber-400"
                      : "text-red-400",
                )}
              >
                Error: {liveErrorMs >= 0 ? "+" : ""}
                {liveErrorMs.toFixed(0)} ms
              </span>
            )}
          </p>
          {syncWarning && (
            <p className="mt-1 text-[11px] text-amber-300">{syncWarning}</p>
          )}
        </div>
      </div>

      {loadError && (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
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
          {/* controls */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-white/5 bg-surface-raised px-4 py-3 text-xs text-zinc-400">
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
                className="w-28 accent-accent"
                aria-label="Zoom px per second"
              />
              <span className="w-10 tabular-nums">{pxPerSec}px/s</span>
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
                className="w-20 accent-accent"
                aria-label="Recording volume"
              />
            </label>

            <label className="flex items-center gap-1">
              Markers
              <Select
                value={markerSource}
                onChange={(e) => setMarkerSource(e.target.value as MarkerSource)}
              >
                <option value="bars">Score bars</option>
                <option value="beats">Score beats</option>
                <option value="syncMap">Sync-map points</option>
              </Select>
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
              {clickMode !== "off" && (
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={clickVol}
                  onChange={(e) => setClickVol(Number(e.target.value))}
                  className="w-16 accent-accent"
                  aria-label="Click volume"
                />
              )}
            </label>

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

          {/* waveform */}
          <div
            ref={scrollRef}
            className="overflow-x-auto rounded-lg border border-white/5 bg-surface"
          >
            <canvas
              ref={canvasRef}
              width={width}
              height={CANVAS_H}
              style={{ width, height: CANVAS_H, display: "block" }}
              onClick={(e) => seekToClientX(e.clientX, e)}
              className="cursor-crosshair"
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
            onAnchorsChange={() => setSyncVersion((v) => v + 1)}
            onSelectScoreTime={setSelectedScoreTime}
          />

          {syncSettings?.syncMap?.diagnostics && (
            <div className="rounded-lg border border-white/5 bg-surface-raised p-4 text-xs text-zinc-400">
              <h3 className="mb-2 text-sm font-semibold text-zinc-200">
                Alignment quality
              </h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                {[
                  ["residualRmsMs", "RMS residual", "ms", 80],
                  ["residualMaxMs", "Max residual", "ms", 120],
                  ["pathStability", "Path stability", "", 0.6],
                  ["referenceRender", "Reference", "", null],
                ].map(([key, label, unit, threshold]) => {
                  const val = syncSettings.syncMap!.diagnostics![key as string];
                  if (val == null) return null;
                  const num = typeof val === "number" ? val : null;
                  const ok =
                    threshold == null
                      ? true
                      : key === "pathStability"
                        ? num! >= (threshold as number)
                        : num! < (threshold as number);
                  return (
                    <div key={key as string}>
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
              <p className="mt-2 text-[11px] text-zinc-500">
                Green = within target (RMS &lt; 80 ms, stability ≥ 0.6). Use
                manual anchors in suspect regions if live Error stays red.
              </p>
            </div>
          )}

          {/* residual report */}
          {stats && (
            <div className="flex flex-col gap-3 rounded-lg border border-white/5 bg-surface-raised p-4">
              <div className="flex flex-wrap gap-4 text-sm">
                <Stat label="Measured" value={`${stats.measured}/${stats.count}`} />
                <Stat
                  label="Mean |err|"
                  value={`${stats.meanAbsMs} ms`}
                  tone={stats.meanAbsMs}
                />
                <Stat label="Median |err|" value={`${stats.medianAbsMs} ms`} tone={stats.medianAbsMs} />
                <Stat label="p90 |err|" value={`${stats.p90AbsMs} ms`} tone={stats.p90AbsMs} />
                <Stat label="Max |err|" value={`${stats.maxAbsMs} ms`} tone={stats.maxAbsMs} />
                <Stat
                  label="Mean signed"
                  value={`${stats.meanSignedMs >= 0 ? "+" : ""}${stats.meanSignedMs} ms`}
                />
              </div>

              <ResidualScatter hits={hits!} markers={markers} endSec={timeline.endSec} />

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
                      <tr key={i} className="border-t border-white/5">
                        <td className="py-1 pr-3">{m.label}</td>
                        <td className="py-1 pr-3">{m.scoreTimeSec.toFixed(3)}s</td>
                        <td className="py-1 pr-3">{m.audioTimeSec.toFixed(3)}s</td>
                        <td className="py-1 pr-3">{h.onsetSec.toFixed(3)}s</td>
                        <td
                          className="py-1 pr-3 font-medium"
                          style={{ color: residualColour(Math.abs(h.residualSec * 1000)) }}
                        >
                          {h.residualSec >= 0 ? "+" : ""}
                          {(h.residualSec * 1000).toFixed(0)} ms
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="text-[11px] text-zinc-500">
                Residual = detected recording onset − predicted marker time.
                Positive = the recording hits <em>after</em> the marker. Onset
                detection is energy-flux based; sparse / legato bars may show
                &ldquo;not measured&rdquo;.
              </p>
            </div>
          )}
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
                : "text-red-400",
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
