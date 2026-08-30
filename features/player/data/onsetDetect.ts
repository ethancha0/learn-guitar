"use client";

/**
 * Lightweight onset detection for *measuring* alignment: given where a GP marker
 * is predicted to land in the recording, find the nearest real onset and report
 * the residual. Half-wave-rectified energy flux (spectral-flux-lite) — enough
 * for percussive pop / rock / J-rock, no FFT.
 */

export interface OnsetEnvelope {
  /** Novelty value per frame (>= 0). */
  novelty: Float32Array;
  hopSec: number;
  sampleRate: number;
}

/** Frame the mono mix and take positive frame-to-frame energy change. */
export function onsetEnvelope(
  buffer: AudioBuffer,
  hopSec = 0.01,
  winSec = 0.025,
): OnsetEnvelope {
  const sr = buffer.sampleRate;
  const hop = Math.max(1, Math.round(hopSec * sr));
  const win = Math.max(hop, Math.round(winSec * sr));
  const chans: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    chans.push(buffer.getChannelData(c));
  }
  const total = buffer.length;
  const frames = Math.max(1, Math.floor((total - win) / hop));
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    let sum = 0;
    for (let i = start; i < start + win; i++) {
      let s = 0;
      for (let c = 0; c < chans.length; c++) s += chans[c][i];
      s /= chans.length;
      sum += s * s;
    }
    energy[f] = Math.sqrt(sum / win);
  }
  const novelty = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    const d = energy[f] - energy[f - 1];
    novelty[f] = d > 0 ? d : 0;
  }
  return { novelty, hopSec: hop / sr, sampleRate: sr };
}

export interface OnsetHit {
  onsetSec: number;
  /** Novelty strength at the pick, normalised 0..1 by the window max. */
  strength: number;
  /** onsetSec − targetSec, seconds. */
  residualSec: number;
  found: boolean;
}

/**
 * Nearest novelty peak to `targetSec` within ±`windowSec`. A "peak" is a local
 * maximum above `relThreshold` × (window max). Ties break toward `targetSec`.
 */
export function nearestOnset(
  env: OnsetEnvelope,
  targetSec: number,
  windowSec = 0.35,
  relThreshold = 0.25,
): OnsetHit {
  const { novelty, hopSec } = env;
  const centre = targetSec / hopSec;
  const half = windowSec / hopSec;
  const lo = Math.max(1, Math.floor(centre - half));
  const hi = Math.min(novelty.length - 2, Math.ceil(centre + half));
  if (hi <= lo) {
    return { onsetSec: targetSec, strength: 0, residualSec: 0, found: false };
  }

  let windowMax = 0;
  for (let i = lo; i <= hi; i++) if (novelty[i] > windowMax) windowMax = novelty[i];
  if (windowMax <= 1e-8) {
    return { onsetSec: targetSec, strength: 0, residualSec: 0, found: false };
  }
  const abs = windowMax * relThreshold;

  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = lo; i <= hi; i++) {
    if (
      novelty[i] >= abs &&
      novelty[i] >= novelty[i - 1] &&
      novelty[i] >= novelty[i + 1]
    ) {
      const dist = Math.abs(i - centre);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
  }
  if (bestIdx < 0) {
    return { onsetSec: targetSec, strength: 0, residualSec: 0, found: false };
  }

  // Parabolic refinement around the peak for sub-hop precision.
  const y0 = novelty[bestIdx - 1];
  const y1 = novelty[bestIdx];
  const y2 = novelty[bestIdx + 1];
  const denom = y0 - 2 * y1 + y2;
  const shift = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0;
  const onsetSec = (bestIdx + Math.max(-1, Math.min(1, shift))) * hopSec;

  return {
    onsetSec,
    strength: y1 / windowMax,
    residualSec: onsetSec - targetSec,
    found: true,
  };
}

export interface ResidualStats {
  count: number;
  measured: number;
  meanAbsMs: number;
  medianAbsMs: number;
  p90AbsMs: number;
  maxAbsMs: number;
  meanSignedMs: number;
}

export function summariseResiduals(hits: OnsetHit[]): ResidualStats {
  const measured = hits.filter((h) => h.found).map((h) => h.residualSec * 1000);
  if (measured.length === 0) {
    return {
      count: hits.length,
      measured: 0,
      meanAbsMs: 0,
      medianAbsMs: 0,
      p90AbsMs: 0,
      maxAbsMs: 0,
      meanSignedMs: 0,
    };
  }
  const abs = measured.map(Math.abs).sort((a, b) => a - b);
  const at = (q: number) => abs[Math.min(abs.length - 1, Math.floor(q * abs.length))];
  return {
    count: hits.length,
    measured: measured.length,
    meanAbsMs: round(abs.reduce((a, b) => a + b, 0) / abs.length),
    medianAbsMs: round(at(0.5)),
    p90AbsMs: round(at(0.9)),
    maxAbsMs: round(abs[abs.length - 1]),
    meanSignedMs: round(measured.reduce((a, b) => a + b, 0) / measured.length),
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
