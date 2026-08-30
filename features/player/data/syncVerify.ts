"use client";

import type { SyncMap, BarTimeline } from "./syncMap";

/**
 * Round-trip check: read the sync points back OUT of alphaTab and compare them
 * to the `SyncMap` they were derived from.
 *
 * The diagnostics panel's live "Error" is `map(scoreTime) − audioTime`, where
 * `scoreTime` comes from alphaTab. It should be ~0, and when it isn't there are
 * two very different explanations:
 *
 *   1. **Transfer bug** — the points reaching alphaTab don't represent the map
 *      (bar/position conversion wrong, points dropped, wrong bar indices).
 *   2. **Alignment quality** — the transfer is faithful but DTW simply aligned
 *      that part of the song badly.
 *
 * Only (1) is a bug I can fix in code; (2) needs a manual anchor or a better
 * reference render. This function distinguishes them without needing playback:
 * it is pure arithmetic over what alphaTab is actually holding.
 */

export interface SyncVerifyRow {
  barIndex: number;
  barPosition: number;
  /** Score time this point represents, per our bar timeline. */
  scoreTimeSec: number;
  /** Recording time alphaTab was given for it. */
  alphaTabAudioSec: number;
  /** Recording time our map says that score position should be. */
  mappedAudioSec: number;
  /** alphaTabAudioSec − mappedAudioSec, milliseconds. */
  deltaMs: number;
}

export interface SyncVerifyReport {
  pointCount: number;
  maxAbsDeltaMs: number;
  meanAbsDeltaMs: number;
  /** True when every point alphaTab holds matches the map within 1 ms. */
  transferFaithful: boolean;
  verdict: string;
  worst: SyncVerifyRow[];
}

/**
 * @param api  the live AlphaTabApi
 * @param map  the SyncMap the points were generated from
 * @param timeline  bar index → score-time, the same one used to build the points
 */
export function verifySyncTransfer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api: any,
  map: SyncMap,
  timeline: BarTimeline,
): SyncVerifyReport | { error: string } {
  const masterBars = api?.score?.masterBars;
  if (!masterBars) return { error: "no score loaded" };

  const barStartSec = (i: number) =>
    i < timeline.bars.length ? timeline.bars[i].startSec : timeline.endSec;

  const rows: SyncVerifyRow[] = [];
  for (let i = 0; i < masterBars.length; i++) {
    const points = masterBars[i].syncPoints;
    if (!points) continue;
    for (const p of points) {
      const ms = p.syncPointValue?.millisecondOffset;
      if (typeof ms !== "number") continue;
      const ratio = typeof p.ratioPosition === "number" ? p.ratioPosition : 0;
      const start = barStartSec(i);
      const span = Math.max(barStartSec(i + 1) - start, 1e-9);
      const scoreTimeSec = start + ratio * span;
      const mappedAudioSec = map.scoreTimeToAudioTime(scoreTimeSec);
      rows.push({
        barIndex: i,
        barPosition: round(ratio, 4),
        scoreTimeSec: round(scoreTimeSec),
        alphaTabAudioSec: round(ms / 1000),
        mappedAudioSec: round(mappedAudioSec),
        deltaMs: round(ms - mappedAudioSec * 1000, 1),
      });
    }
  }

  if (rows.length === 0) {
    return { error: "alphaTab is holding no sync points" };
  }

  const abs = rows.map((r) => Math.abs(r.deltaMs));
  const maxAbsDeltaMs = round(Math.max(...abs), 1);
  const meanAbsDeltaMs = round(abs.reduce((a, b) => a + b, 0) / abs.length, 1);
  const transferFaithful = maxAbsDeltaMs <= 1;

  return {
    pointCount: rows.length,
    maxAbsDeltaMs,
    meanAbsDeltaMs,
    transferFaithful,
    verdict: transferFaithful
      ? "Transfer is faithful — alphaTab holds exactly the map. Any remaining playback error is DTW alignment quality, not plumbing; fix it with a manual anchor near the bad section."
      : `Transfer is LOSSY (max ${maxAbsDeltaMs} ms). The points alphaTab holds do not represent the map — this is a code bug, not alignment quality.`,
    worst: [...rows]
      .sort((a, b) => Math.abs(b.deltaMs) - Math.abs(a.deltaMs))
      .slice(0, 8),
  };
}

function round(n: number, dp = 3): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
