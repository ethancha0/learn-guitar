"use client";

import type { OnsetEnvelope } from "./onsetDetect";

export interface OnsetHistogram {
  /** Per-bucket max novelty in 0..1 (normalised to global max). */
  values: Float32Array;
  bucketCount: number;
  secondsPerBucket: number;
  durationSec: number;
  /** Local-max peak positions in seconds (above relThreshold). */
  peaksSec: number[];
}

/**
 * Bucket an onset envelope to match waveform pixel width for drawing.
 */
export function computeOnsetHistogram(
  env: OnsetEnvelope,
  bucketCount: number,
  durationSec: number,
  peakRelThreshold = 0.35,
): OnsetHistogram {
  const n = Math.max(1, Math.floor(bucketCount));
  const values = new Float32Array(n);
  const { novelty, hopSec } = env;
  let globalMax = 0;

  for (let b = 0; b < n; b++) {
    const t0 = (b / n) * durationSec;
    const t1 = ((b + 1) / n) * durationSec;
    const f0 = Math.max(0, Math.floor(t0 / hopSec));
    const f1 = Math.min(novelty.length, Math.ceil(t1 / hopSec));
    let max = 0;
    for (let f = f0; f < f1; f++) {
      if (novelty[f] > max) max = novelty[f];
    }
    values[b] = max;
    if (max > globalMax) globalMax = max;
  }

  if (globalMax > 0) {
    for (let b = 0; b < n; b++) values[b] /= globalMax;
  }

  const peaksSec: number[] = [];
  const thresh = peakRelThreshold;
  for (let f = 1; f + 1 < novelty.length; f++) {
    const v = globalMax > 0 ? novelty[f] / globalMax : novelty[f];
    if (
      v >= thresh &&
      novelty[f] >= novelty[f - 1] &&
      novelty[f] >= novelty[f + 1]
    ) {
      peaksSec.push(f * hopSec);
    }
  }

  return {
    values,
    bucketCount: n,
    secondsPerBucket: durationSec / n,
    durationSec,
    peaksSec,
  };
}

export function drawOnsetHistogram(
  ctx: CanvasRenderingContext2D,
  hist: OnsetHistogram,
  width: number,
  height: number,
): void {
  const { values, bucketCount } = hist;
  const barW = width / bucketCount;

  ctx.fillStyle = "rgba(251, 191, 36, 0.35)";
  for (let b = 0; b < bucketCount; b++) {
    const h = values[b] * (height - 4);
    const x = b * barW;
    ctx.fillRect(x, height - h - 2, Math.max(1, barW), h);
  }

  ctx.fillStyle = "rgba(251, 191, 36, 0.95)";
  const peakSet = new Set(
    hist.peaksSec.map((t) => Math.round((t / hist.durationSec) * bucketCount)),
  );
  for (const b of peakSet) {
    if (b < 0 || b >= bucketCount) continue;
    const x = (b + 0.5) * barW;
    ctx.beginPath();
    ctx.arc(x, height - values[b] * (height - 4) - 2, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Nearest onset peak to `targetSec` within `windowSec`. */
export function nearestPeakSec(
  hist: OnsetHistogram,
  targetSec: number,
  windowSec = 0.35,
): number | null {
  let best: number | null = null;
  let bestDist = windowSec;
  for (const p of hist.peaksSec) {
    const d = Math.abs(p - targetSec);
    if (d <= bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}
