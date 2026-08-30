"use client";

import type { SyncMap } from "./syncMap";
import { probeSyncMap, type SyncProbeReport } from "./syncProbe";

/**
 * Installs `window.__syncDebug()` in development so alignment can be *measured*
 * rather than eyeballed against the cursor. Returns the current score/audio
 * positions, the mapping's prediction for each, the surrounding sync points and
 * the alignment method + diagnostics.
 */
export interface SyncDebugSnapshot {
  method: string;
  pointCount: number;
  /** alphaTab's reported score position (seconds). */
  scoreTimeSec: number;
  /** The `<audio>` element's position (seconds). */
  audioTimeSec: number;
  /** Where the map says this score time should sound. */
  mappedAudioTimeSec: number;
  /** Where the map says this audio time sits in the score. */
  mappedScoreTimeSec: number;
  /** mappedAudioTime − audioTime; the visible alignment error, seconds. */
  errorSec: number;
  localRate: number;
  confidence?: number;
  nearestPoints: Array<{ scoreTime: number; audioTime: number }>;
  diagnostics?: Record<string, unknown>;
}

interface Deps {
  getMap: () => SyncMap | null;
  getScoreTimeSec: () => number;
  getAudioTimeSec: () => number;
  getSource?: () => "dtw" | "offset" | "none";
  getScoreDurationSec?: () => number;
  getAudioDurationSec?: () => number;
  /**
   * Reads the sync points back out of alphaTab and diffs them against the map,
   * which separates a lossy transfer (a code bug) from poor alignment.
   */
  verifyTransfer?: () => unknown;
}

const KEY = "__syncDebug";
const PROBE_KEY = "__syncProbe";
const VERIFY_KEY = "__syncVerify";

export function installSyncDebug(deps: Deps): () => void {
  if (typeof window === "undefined" || process.env.NODE_ENV === "production") {
    return () => {};
  }

  const snapshot = (): SyncDebugSnapshot | { error: string } => {
    const map = deps.getMap();
    if (!map) return { error: "no sync map yet" };
    const scoreTimeSec = deps.getScoreTimeSec();
    const audioTimeSec = deps.getAudioTimeSec();
    const mappedAudioTimeSec = map.scoreTimeToAudioTime(scoreTimeSec);
    const mappedScoreTimeSec = map.audioTimeToScoreTime(audioTimeSec);

    const pts = map.points;
    let i = 0;
    while (i < pts.length - 1 && pts[i + 1].scoreTime < scoreTimeSec) i++;
    const nearestPoints = pts
      .slice(Math.max(0, i - 1), i + 3)
      .map((p) => ({ scoreTime: p.scoreTime, audioTime: p.audioTime }));

    return {
      method: map.diagnostics?.method ?? "unknown",
      pointCount: pts.length,
      scoreTimeSec: round(scoreTimeSec),
      audioTimeSec: round(audioTimeSec),
      mappedAudioTimeSec: round(mappedAudioTimeSec),
      mappedScoreTimeSec: round(mappedScoreTimeSec),
      errorSec: round(mappedAudioTimeSec - audioTimeSec),
      localRate: round(map.slopeAtScoreTime(scoreTimeSec), 4),
      confidence: map.confidenceAtScoreTime(scoreTimeSec),
      nearestPoints,
      diagnostics: map.diagnostics as Record<string, unknown> | undefined,
    };
  };

  /** Fixed-position probes (0/25/50/75/100 %) + drift warnings. */
  const probe = (
    fractions?: number[],
  ): SyncProbeReport | { error: string } => {
    const map = deps.getMap();
    if (!map) return { error: "no sync map yet" };
    return probeSyncMap(map, {
      source: deps.getSource?.() ?? "none",
      scoreDurationSec: deps.getScoreDurationSec?.() ?? map.scoreDuration,
      audioDurationSec: deps.getAudioDurationSec?.() ?? 0,
      fractions,
    });
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any)[KEY] = snapshot;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any)[PROBE_KEY] = probe;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any)[VERIFY_KEY] =
    deps.verifyTransfer ?? (() => ({ error: "no verifier installed" }));
  return () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any)[KEY];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any)[PROBE_KEY];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any)[VERIFY_KEY];
  };
}

function round(n: number, dp = 3): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
