"use client";

/**
 * Best-effort estimate of how far into a recording the first strong onset sits,
 * used to seed the calibration offset. Decodes the head of the file and scans a
 * short-window RMS envelope for the first hop that clearly rises above the noise
 * floor. Returns 0 on any failure — the user can still nudge by ear.
 */
export async function estimateLeadInMs(
  blob: Blob,
  maxSeconds = 12,
): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Ctx: typeof AudioContext =
    window.AudioContext ??
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).webkitAudioContext;
  if (!Ctx) return 0;

  const ctx = new Ctx();
  try {
    const full = await blob.arrayBuffer();
    const buffer = await ctx.decodeAudioData(full.slice(0));
    const data = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const limit = Math.min(data.length, Math.floor(maxSeconds * sampleRate));

    const hop = 1024;
    let globalPeak = 0;
    const rms: number[] = [];
    for (let start = 0; start < limit; start += hop) {
      let sumSq = 0;
      const end = Math.min(start + hop, limit);
      for (let i = start; i < end; i++) sumSq += data[i] * data[i];
      const value = Math.sqrt(sumSq / (end - start));
      rms.push(value);
      if (value > globalPeak) globalPeak = value;
    }
    if (globalPeak === 0) return 0;

    // Noise floor: median of the quietest quarter of hops.
    const sorted = [...rms].sort((a, b) => a - b);
    const noiseFloor = sorted[Math.floor(sorted.length / 8)] || 0;
    const threshold = Math.max(globalPeak * 0.15, noiseFloor * 4, 1e-4);

    for (let h = 0; h < rms.length; h++) {
      if (rms[h] >= threshold) {
        return Math.round(((h * hop) / sampleRate) * 1000);
      }
    }
    return 0;
  } catch (err) {
    console.error("[autoAlign] estimateLeadInMs failed", err);
    return 0;
  } finally {
    void ctx.close();
  }
}
