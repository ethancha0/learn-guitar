"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { SyncAnchor } from "@/features/library/data/songStore";
import type { SyncMap } from "@/features/player/data/syncMap";
import type { SyncVerifyReport } from "@/features/player/data/syncVerify";
import { ALIGNMENT_ENABLED } from "@/features/player/data/alignmentQueue";

/** An anchor counts as honoured when the live map lands this close to it. */
const ANCHOR_TOLERANCE_MS = 20;

interface SyncDiagnosticsProps {
  songId: string;
  map: SyncMap | null;
  method: string;
  /** Which mapping is actually driving playback right now. */
  syncSource: "dtw" | "offset" | "none";
  /** Set when a stored map was rejected and we silently degraded. */
  syncWarning?: string;
  scoreDurationSec: number;
  audioDurationSec: number;
  /** Number of points actually handed to alphaTab. */
  appliedPointCount: number;
  /** Live score position (seconds). */
  scoreTimeSec: number;
  /** Live recording position (seconds). */
  audioTimeSec: number;
  /** Manual corrections, so each one can be shown as honoured or not. */
  anchors: SyncAnchor[];
  /** Reads the sync points back out of alphaTab and compares them to the map. */
  onVerifyTransfer: () => SyncVerifyReport | { error: string };
  onRunDtw: () => void;
  dtwRunning: boolean;
  message?: string;
  onClose: () => void;
}

/**
 * Alignment inspector: the score→audio warping curve (diagonal = identical
 * tempo), the live error, nearest sync points and diagnostics.
 *
 * Shipped to production but hidden there unless a viewer opts in — see
 * `syncDiagnosticsFlag.ts`. Everything it shows is read out of the running
 * player, so it works anywhere; the one thing it cannot do off a dev machine is
 * re-run DTW alignment, and that button is hidden rather than left to 404.
 */
export function SyncDiagnostics({
  songId,
  map,
  method,
  syncSource,
  syncWarning,
  scoreDurationSec,
  audioDurationSec,
  appliedPointCount,
  scoreTimeSec,
  audioTimeSec,
  anchors,
  onVerifyTransfer,
  onRunDtw,
  dtwRunning,
  message,
  onClose,
}: SyncDiagnosticsProps) {
  const [tick, setTick] = useState(0);
  const [verify, setVerify] = useState<
    SyncVerifyReport | { error: string } | null
  >(null);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const loop = () => {
      setTick((t) => (t + 1) % 1e6);
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
    };
  }, []);
  void tick;

  const mappedAudio = map ? map.scoreTimeToAudioTime(scoreTimeSec) : 0;
  const errorMs = map ? (mappedAudio - audioTimeSec) * 1000 : 0;
  const rate = map ? map.slopeAtScoreTime(scoreTimeSec) : 1;

  const W = 240;
  const H = 160;
  let path = "";
  let diagPath = "";
  let dot = "";
  if (map) {
    const sMax = map.scoreDuration || 1;
    const aMax = map.audioDuration || 1;
    const xs = (s: number) => (s / sMax) * W;
    const ys = (a: number) => H - (a / aMax) * H;
    const N = 120;
    for (let i = 0; i <= N; i++) {
      const s = (i / N) * sMax;
      const a = map.scoreTimeToAudioTime(s);
      path += `${i === 0 ? "M" : "L"}${xs(s).toFixed(1)},${ys(a).toFixed(1)} `;
    }
    // Reference diagonal: identical timelines, offset by the lead-in.
    const lead = map.scoreTimeToAudioTime(0);
    diagPath = `M${xs(0)},${ys(lead)} L${xs(sMax)},${ys(lead + sMax)}`;
    dot = `${xs(scoreTimeSec).toFixed(1)},${ys(mappedAudio).toFixed(1)}`;
  }

  const [dx, dy] = dot ? dot.split(",") : ["0", "0"];

  return (
    <aside className="fixed right-0 top-0 z-50 flex h-dvh w-80 flex-col gap-3 overflow-y-auto border-l border-rule bg-paper-raised p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-200">Sync diagnostics</h2>
        <Button variant="ghost" size="icon" aria-label="Hide" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Unmissable: which mapping is really driving playback. */}
      <div
        className={cn(
          "rounded-sm px-3 py-2 text-xs font-semibold",
          syncSource === "dtw"
            ? "bg-accent/15 text-accent"
            : syncSource === "offset"
              ? "bg-amber-500/15 text-amber-300"
              : "bg-red-500/15 text-red-300",
        )}
      >
        {syncSource === "dtw"
          ? "Nonlinear DTW map ACTIVE"
          : syncSource === "offset"
            ? "FALLBACK: linear offset map (no DTW)"
            : "No sync map yet"}
      </div>
      {syncWarning && (
        <p className="rounded-sm bg-red-500/10 px-3 py-2 text-[11px] leading-snug text-red-300">
          {syncWarning}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-zinc-400">
        <dt>Method</dt>
        <dd className="text-right text-zinc-200">{method}</dd>
        <dt>Sync points (map)</dt>
        <dd className="text-right text-zinc-200">{map?.points.length ?? 0}</dd>
        <dt>→ sent to alphaTab</dt>
        <dd className="text-right text-zinc-200">{appliedPointCount}</dd>
        <dt>Score duration</dt>
        <dd className="text-right tabular-nums text-zinc-200">
          {scoreDurationSec.toFixed(1)}s
        </dd>
        <dt>Audio duration</dt>
        <dd className="text-right tabular-nums text-zinc-200">
          {audioDurationSec.toFixed(1)}s
        </dd>
        <dt>Score time</dt>
        <dd className="text-right tabular-nums text-zinc-200">
          {scoreTimeSec.toFixed(3)}s
        </dd>
        <dt>Audio time</dt>
        <dd className="text-right tabular-nums text-zinc-200">
          {audioTimeSec.toFixed(3)}s
        </dd>
        <dt>Mapped audio</dt>
        <dd className="text-right tabular-nums text-zinc-200">
          {mappedAudio.toFixed(3)}s
        </dd>
        <dt>Error</dt>
        <dd
          className={
            "text-right tabular-nums " +
            (Math.abs(errorMs) < 40 ? "text-accent" : "text-accent")
          }
        >
          {errorMs >= 0 ? "+" : ""}
          {errorMs.toFixed(0)} ms
        </dd>
        <dt>Local rate</dt>
        <dd className="text-right tabular-nums text-zinc-200">
          {rate.toFixed(4)}×
        </dd>
      </dl>

      {/* Probe the mapping at fixed fractions. A pure linear fallback shows a
          constant lag; a real DTW map shows the lag moving. */}
      {map && scoreDurationSec > 0 && (
        <table className="w-full text-left text-[11px] tabular-nums">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-0.5 pr-2 font-normal">Score</th>
              <th className="py-0.5 pr-2 font-normal">→ Audio</th>
              <th className="py-0.5 font-normal">Lag</th>
            </tr>
          </thead>
          <tbody className="text-zinc-300">
            {[0, 0.25, 0.5, 0.75, 1].map((f) => {
              const s = scoreDurationSec * f;
              const a = map.scoreTimeToAudioTime(s);
              return (
                <tr key={f}>
                  <td className="py-0.5 pr-2">{s.toFixed(2)}s</td>
                  <td className="py-0.5 pr-2 text-zinc-100">{a.toFixed(2)}s</td>
                  <td className="py-0.5 text-zinc-500">
                    {a - s >= 0 ? "+" : ""}
                    {(a - s).toFixed(2)}s
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="rounded-sm border border-rule bg-paper p-2">
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label="Score-time to audio-time warping curve"
        >
          <rect x={0} y={0} width={W} height={H} fill="transparent" />
          <path d={diagPath} stroke="#3f3f46" strokeWidth={1} fill="none" strokeDasharray="3 3" />
          <path d={path} stroke="#16181c" strokeWidth={1.5} fill="none" />
          {dot && <circle cx={dx} cy={dy} r={3} fill="#f4f4f5" />}
        </svg>
        <p className="mt-1 text-[10px] text-zinc-500">
          x = score time, y = audio time. Dashed = identical tempo. Slope
          changes = local tempo differences.
        </p>
      </div>

      {/* Does the live map actually pass through the hand-placed corrections?
          This is the check that would have caught anchors being dropped between
          the sync-debug page and playback. */}
      {map && anchors.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Anchors ({anchors.length})
          </h3>
          <table className="w-full text-left text-[11px] tabular-nums">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-0.5 pr-2 font-normal">Score</th>
                <th className="py-0.5 pr-2 font-normal">Target</th>
                <th className="py-0.5 font-normal">Map is off by</th>
              </tr>
            </thead>
            <tbody className="text-zinc-300">
              {anchors.map((a) => {
                const landed = map.scoreTimeToAudioTime(a.scoreTime);
                const deltaMs = (landed - a.audioTime) * 1000;
                return (
                  <tr key={a.scoreTime}>
                    <td className="py-0.5 pr-2">{a.scoreTime.toFixed(2)}s</td>
                    <td className="py-0.5 pr-2 text-zinc-100">
                      {a.audioTime.toFixed(2)}s
                    </td>
                    <td
                      className={cn(
                        "py-0.5",
                        Math.abs(deltaMs) <= ANCHOR_TOLERANCE_MS
                          ? "text-accent"
                          : "text-amber-400",
                      )}
                    >
                      {deltaMs >= 0 ? "+" : ""}
                      {deltaMs.toFixed(0)} ms
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setVerify(onVerifyTransfer())}
        >
          Verify transfer to alphaTab
        </Button>
        {verify && (
          <div className="rounded-sm border border-rule bg-paper p-2 text-[11px] leading-snug">
            {"error" in verify ? (
              <p className="text-amber-300">{verify.error}</p>
            ) : (
              <>
                <p
                  className={
                    verify.transferFaithful ? "text-accent" : "text-accent"
                  }
                >
                  {verify.pointCount} point(s) held by alphaTab · max{" "}
                  {verify.maxAbsDeltaMs} ms / mean {verify.meanAbsDeltaMs} ms off
                  the map
                </p>
                <p className="mt-1 text-zinc-400">{verify.verdict}</p>
              </>
            )}
          </div>
        )}
        {ALIGNMENT_ENABLED ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onRunDtw}
            disabled={dtwRunning}
          >
            {dtwRunning ? "Aligning… (DTW)" : "Run DTW alignment"}
          </Button>
        ) : (
          <p className="text-[11px] leading-snug text-zinc-500">
            Re-running DTW alignment needs the local Python pipeline behind{" "}
            <code>/api/align</code>, which is disabled in this build. The map
            shown here is whatever was solved on a development machine and
            saved to the account.
          </p>
        )}
        {message && (
          <p className="text-[11px] leading-snug text-zinc-400">{message}</p>
        )}
        <Link
          href={`/sync-debug/${songId}`}
          className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          Open sync-debug page (waveform + markers + click overlay)
        </Link>
        <p className="text-[11px] leading-snug text-zinc-500">
          Also available in the console: <code>window.__syncDebug()</code>,{" "}
          <code>window.__syncVerify()</code>
        </p>
      </div>

      {map?.diagnostics && (
        <pre className="max-h-40 overflow-auto rounded-sm bg-paper p-2 text-[10px] text-zinc-400">
          {JSON.stringify(map.diagnostics, null, 2)}
        </pre>
      )}
    </aside>
  );
}
