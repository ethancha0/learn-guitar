import { describe, expect, it } from "vitest";
import {
  onsetEnvelope,
  nearestOnset,
  summariseResiduals,
  type OnsetHit,
} from "./onsetDetect";

function fakeBuffer(data: Float32Array, sampleRate = 24_000): AudioBuffer {
  return {
    numberOfChannels: 1,
    length: data.length,
    sampleRate,
    duration: data.length / sampleRate,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

/** Silence with a short decaying tone burst at `atSec`. */
function bufferWithBurst(atSec: number, durSec = 4, sr = 24_000): AudioBuffer {
  const data = new Float32Array(Math.round(durSec * sr));
  const start = Math.round(atSec * sr);
  for (let i = 0; i < 0.05 * sr && start + i < data.length; i++) {
    const env = Math.exp(-i / (0.01 * sr));
    data[start + i] = 0.8 * env * Math.sin((2 * Math.PI * 220 * i) / sr);
  }
  return fakeBuffer(data, sr);
}

describe("onset detection", () => {
  it("finds a burst near the target and reports the residual", () => {
    const env = onsetEnvelope(bufferWithBurst(1.0));
    const hit = nearestOnset(env, 1.06, 0.3);
    expect(hit.found).toBe(true);
    expect(hit.onsetSec).toBeCloseTo(1.0, 1);
    // target 1.06, onset ~1.00 -> residual ~ -0.06 s
    expect(hit.residualSec).toBeLessThan(0);
    expect(hit.residualSec).toBeGreaterThan(-0.12);
  });

  it("returns not-found in a silent window", () => {
    const env = onsetEnvelope(bufferWithBurst(1.0));
    const hit = nearestOnset(env, 3.0, 0.25);
    expect(hit.found).toBe(false);
    expect(hit.residualSec).toBe(0);
  });

  it("does not reach across the window to a far burst", () => {
    const env = onsetEnvelope(bufferWithBurst(2.5, 5));
    const hit = nearestOnset(env, 1.0, 0.3);
    expect(hit.found).toBe(false);
  });
});

describe("summariseResiduals", () => {
  it("aggregates only the measured hits", () => {
    const hits: OnsetHit[] = [
      { onsetSec: 1.0, strength: 1, residualSec: 0.02, found: true },
      { onsetSec: 2.0, strength: 1, residualSec: -0.05, found: true },
      { onsetSec: 3.0, strength: 1, residualSec: 0.2, found: true },
      { onsetSec: 0, strength: 0, residualSec: 0, found: false },
    ];
    const s = summariseResiduals(hits);
    expect(s.count).toBe(4);
    expect(s.measured).toBe(3);
    expect(s.maxAbsMs).toBe(200);
    expect(s.meanSignedMs).toBeCloseTo((20 - 50 + 200) / 3, 1);
    expect(s.meanAbsMs).toBeCloseTo((20 + 50 + 200) / 3, 1);
  });

  it("is safe with no measured hits", () => {
    const s = summariseResiduals([
      { onsetSec: 0, strength: 0, residualSec: 0, found: false },
    ]);
    expect(s.measured).toBe(0);
    expect(s.meanAbsMs).toBe(0);
  });
});
