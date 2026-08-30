"use client";

/** MP3 → PCM → per-pixel peaks, for drawing the recording as a waveform. */

export async function decodeAudio(
  blob: Blob,
  context?: AudioContext,
): Promise<AudioBuffer> {
  const Ctx: typeof AudioContext =
    window.AudioContext ??
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).webkitAudioContext;
  const ctx = context ?? new Ctx();
  const bytes = await blob.arrayBuffer();
  try {
    return await ctx.decodeAudioData(bytes.slice(0));
  } finally {
    if (!context) void ctx.close();
  }
}

export interface Peaks {
  /** Interleaved [min0, max0, min1, max1, ...] in −1..1, one pair per bucket. */
  minMax: Float32Array;
  bucketCount: number;
  /** Seconds of audio represented by each bucket. */
  secondsPerBucket: number;
  durationSec: number;
}

/**
 * Reduce a decoded buffer to `bucketCount` min/max pairs (mono-mixed). Cheap and
 * resolution-independent — recompute when the zoom / pixel width changes.
 */
export function computePeaks(buffer: AudioBuffer, bucketCount: number): Peaks {
  const n = Math.max(1, Math.floor(bucketCount));
  const minMax = new Float32Array(n * 2);
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }
  const total = buffer.length;
  const per = total / n;

  for (let b = 0; b < n; b++) {
    const start = Math.floor(b * per);
    const end = Math.min(total, Math.floor((b + 1) * per));
    let lo = 1;
    let hi = -1;
    for (let i = start; i < end; i++) {
      let s = 0;
      for (let c = 0; c < channels.length; c++) s += channels[c][i];
      s /= channels.length;
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
    if (end <= start) {
      lo = 0;
      hi = 0;
    }
    minMax[b * 2] = lo;
    minMax[b * 2 + 1] = hi;
  }

  return {
    minMax,
    bucketCount: n,
    secondsPerBucket: buffer.duration / n,
    durationSec: buffer.duration,
  };
}
