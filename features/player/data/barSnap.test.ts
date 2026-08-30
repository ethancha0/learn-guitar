import { describe, expect, it } from "vitest";
import { onsetEnvelope } from "./onsetDetect";
import { snapBarsToOnsets } from "./barSnap";

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
        data[i] = t > 0.49 && t < 0.51 ? 0.8 : 0.01;
      }
      return data;
    },
  };
  return ctx as unknown as AudioBuffer;
}

describe("snapBarsToOnsets", () => {
  it("keeps monotonic audio times", () => {
    const buf = makeBuffer(3);
    const env = onsetEnvelope(buf, 0.01);
    const points = [
      { scoreTime: 0, audioTime: 0 },
      { scoreTime: 1, audioTime: 0.48 },
      { scoreTime: 2, audioTime: 1.48 },
    ];
    const { points: snapped } = snapBarsToOnsets(points, env, 0.15);
    for (let i = 1; i < snapped.length; i++) {
      expect(snapped[i].audioTime).toBeGreaterThan(snapped[i - 1].audioTime);
    }
  });
});
