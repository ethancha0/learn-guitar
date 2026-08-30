"use client";

import type { SyncMap } from "./syncMap";

/**
 * Fixed-position probes of a `SyncMap`, so alignment is judged by numbers rather
 * than by "it sounds synced". Exposed as `window.__syncProbe()` in dev.
 *
 * Read the `lagSec` column: a linear fallback shows a (near-)constant lag at
 * every fraction; a real nonlinear map shows the lag moving. `rateDeviation`
 * flags sudden jumps, which usually mean a bad DTW region or a missing anchor.
 */

export interface SyncProbeRow {
  fraction: number;
  scoreTimeSec: number;
  audioTimeSec: number;
  /** audioTime − scoreTime. */
  lagSec: number;
  /** Local d(audio)/d(score) at this point. */
  localRate: number;
  nearestPoints: Array<{ scoreTime: number; audioTime: number }>;
}

export interface SyncProbeReport {
  method: string;
  source: "dtw" | "offset" | "none";
  pointCount: number;
  scoreDurationSec: number;
  audioDurationSec: number;
  rows: SyncProbeRow[];
  /** Spread of lag across the song. ~0 means the map is effectively linear. */
  lagSpreadSec: number;
  /** True when the mapping carries no nonlinearity worth having DTW for. */
  looksLinear: boolean;
  warnings: string[];
}

const DEFAULT_FRACTIONS = [0, 0.25, 0.5, 0.75, 1];

export function probeSyncMap(
  map: SyncMap,
  opts: {
    source: "dtw" | "offset" | "none";
    scoreDurationSec: number;
    audioDurationSec: number;
    fractions?: number[];
  },
): SyncProbeReport {
  const fractions = opts.fractions ?? DEFAULT_FRACTIONS;
  const rows: SyncProbeRow[] = fractions.map((f) => {
    const scoreTimeSec = opts.scoreDurationSec * f;
    const audioTimeSec = map.scoreTimeToAudioTime(scoreTimeSec);
    const pts = map.points;
    let i = 0;
    while (i < pts.length - 1 && pts[i + 1].scoreTime < scoreTimeSec) i++;
    return {
      fraction: f,
      scoreTimeSec: round(scoreTimeSec),
      audioTimeSec: round(audioTimeSec),
      lagSec: round(audioTimeSec - scoreTimeSec),
      localRate: round(map.slopeAtScoreTime(scoreTimeSec), 5),
      nearestPoints: pts
        .slice(Math.max(0, i), i + 2)
        .map((p) => ({ scoreTime: round(p.scoreTime), audioTime: round(p.audioTime) })),
    };
  });

  const lags = rows.map((r) => r.lagSec);
  const lagSpreadSec = round(Math.max(...lags) - Math.min(...lags));

  const warnings: string[] = [];
  if (opts.source === "offset") {
    warnings.push(
      "Linear offset fallback is active — this cannot track tempo drift.",
    );
  }
  if (opts.source === "dtw" && lagSpreadSec < 0.05) {
    warnings.push(
      "DTW map is present but effectively linear (lag spread < 50 ms); the alignment may not have found real tempo variation.",
    );
  }
  const endLag = rows[rows.length - 1]?.lagSec ?? 0;
  if (
    opts.audioDurationSec > 0 &&
    opts.scoreDurationSec + endLag > opts.audioDurationSec + 0.25
  ) {
    warnings.push(
      `Score end maps past the recording (${round(opts.scoreDurationSec + endLag)}s > ${round(opts.audioDurationSec)}s): the audio will finish before the cursor does.`,
    );
  }
  for (let i = 1; i < rows.length; i++) {
    const jump = Math.abs(rows[i].localRate - rows[i - 1].localRate);
    if (jump > 0.15) {
      warnings.push(
        `Sudden tempo-ratio jump between ${rows[i - 1].scoreTimeSec}s and ${rows[i].scoreTimeSec}s (${rows[i - 1].localRate}× → ${rows[i].localRate}×).`,
      );
    }
  }

  return {
    method: map.diagnostics?.method ?? "unknown",
    source: opts.source,
    pointCount: map.points.length,
    scoreDurationSec: round(opts.scoreDurationSec),
    audioDurationSec: round(opts.audioDurationSec),
    rows,
    lagSpreadSec,
    looksLinear: lagSpreadSec < 0.05,
    warnings,
  };
}

function round(n: number, dp = 3): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
