import { describe, expect, it } from "vitest";
import { onsetEnvelope } from "./onsetDetect";
import { computeOnsetHistogram, nearestPeakSec } from "./onsetHistogram";

function makeBuffer(durationSec: number, sr = 44100): AudioBuffer {
  const len = Math.ceil(durationSec * sr);
  const ctx = {
    sampleRate: sr,
    numberOfChannels: 1,
    length: len,
    duration: durationSec,
    getChannelData: () => {
      const data = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        data[i] = Math.sin(2 * Math.PI * 4 * t) * (t > 0.5 && t < 0.52 ? 1 : 0.1);
      }
      return data;
    },
  };
  return ctx as unknown as AudioBuffer;
}

describe("onsetHistogram", () => {
  it("buckets novelty to the requested width", () => {
    const buf = makeBuffer(2);
    const env = onsetEnvelope(buf, 0.01);
    const hist = computeOnsetHistogram(env, 100, 2);
    expect(hist.bucketCount).toBe(100);
    expect(hist.values.length).toBe(100);
    expect(Math.max(...hist.values)).toBeLessThanOrEqual(1);
  });

  it("finds nearest peak within window", () => {
    const buf = makeBuffer(2);
    const env = onsetEnvelope(buf, 0.01);
    const hist = computeOnsetHistogram(env, 200, 2);
    const peak = nearestPeakSec(hist, 0.51, 0.1);
    if (hist.peaksSec.length > 0) {
      expect(peak).not.toBeNull();
    }
  });
});
