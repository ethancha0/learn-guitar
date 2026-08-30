"use client";

import { nearestOnset, type OnsetEnvelope } from "./onsetDetect";
import type { SyncPoint } from "./syncMap";

export interface BarSnapResult {
  points: SyncPoint[];
  shiftsMs: number[];
}

/**
 * Nudge each bar's audio time toward the nearest onset peak (±windowSec).
 * Re-enforces strict monotonicity on the audio axis.
 */
export function snapBarsToOnsets(
  points: readonly SyncPoint[],
  env: OnsetEnvelope,
  windowSec = 0.1,
  minStrength = 0.2,
): BarSnapResult {
  if (points.length < 2) {
    return { points: [...points], shiftsMs: points.map(() => 0) };
  }

  const out: SyncPoint[] = [];
  const shiftsMs: number[] = [];
  let prevAudio = -Infinity;

  for (const p of points) {
    const hit = nearestOnset(env, p.audioTime, windowSec);
    let audioTime = p.audioTime;
    let shiftMs = 0;
    if (hit.found && hit.strength >= minStrength) {
      audioTime = hit.onsetSec;
      shiftMs = (audioTime - p.audioTime) * 1000;
    }
    audioTime = Math.max(audioTime, prevAudio + 1e-3);
    out.push({ ...p, audioTime });
    shiftsMs.push(shiftMs);
    prevAudio = audioTime;
  }

  return { points: out, shiftsMs };
}
