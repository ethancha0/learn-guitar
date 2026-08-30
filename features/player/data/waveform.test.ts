import { describe, expect, it } from "vitest";
import { computePeaks } from "./waveform";

/** Minimal stand-in for a decoded AudioBuffer (node test env, no Web Audio). */
function fakeBuffer(channelData: Float32Array[], sampleRate = 48_000): AudioBuffer {
  const length = channelData[0].length;
  return {
    numberOfChannels: channelData.length,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (c: number) => channelData[c],
  } as unknown as AudioBuffer;
}

describe("computePeaks", () => {
  it("returns the requested bucket count and sensible metadata", () => {
    const sr = 1000;
    const data = new Float32Array(sr * 4); // 4 seconds
    const peaks = computePeaks(fakeBuffer([data], sr), 400);
    expect(peaks.bucketCount).toBe(400);
    expect(peaks.minMax.length).toBe(800);
    expect(peaks.durationSec).toBeCloseTo(4, 6);
    expect(peaks.secondsPerBucket).toBeCloseTo(4 / 400, 6);
  });

  it("captures a spike in the bucket that contains it", () => {
    const sr = 1000;
    const data = new Float32Array(sr * 2); // 2 s -> 200 buckets @ 100/bucket
    data[1500] = 0.9; // 1.5 s -> bucket 150
    data[1501] = -0.8;
    const peaks = computePeaks(fakeBuffer([data], sr), 200);
    expect(peaks.minMax[150 * 2 + 1]).toBeCloseTo(0.9, 5); // max
    expect(peaks.minMax[150 * 2]).toBeCloseTo(-0.8, 5); // min
    // a quiet bucket stays near zero
    expect(Math.abs(peaks.minMax[10 * 2])).toBeLessThan(1e-6);
  });

  it("mixes channels to mono", () => {
    const sr = 1000;
    const l = new Float32Array(sr);
    const r = new Float32Array(sr);
    l[500] = 1;
    r[500] = -1; // cancels
    const peaks = computePeaks(fakeBuffer([l, r], sr), 100);
    expect(Math.abs(peaks.minMax[50 * 2])).toBeLessThan(1e-6);
    expect(Math.abs(peaks.minMax[50 * 2 + 1])).toBeLessThan(1e-6);
  });
});
