import { describe, expect, it } from "vitest";
import { projectMediaTime } from "./audioClock";

describe("projectMediaTime", () => {
  it("advances media time by elapsed context time at rate 1", () => {
    const anchor = { mediaTime: 10, ctxTime: 100, rate: 1, running: true };
    expect(projectMediaTime(anchor, 100)).toBeCloseTo(10, 9);
    expect(projectMediaTime(anchor, 100.5)).toBeCloseTo(10.5, 9);
    expect(projectMediaTime(anchor, 102)).toBeCloseTo(12, 9);
  });

  it("scales by playback rate", () => {
    const anchor = { mediaTime: 4, ctxTime: 0, rate: 0.5, running: true };
    expect(projectMediaTime(anchor, 2)).toBeCloseTo(5, 9);
    const fast = { mediaTime: 4, ctxTime: 0, rate: 1.5, running: true };
    expect(projectMediaTime(fast, 2)).toBeCloseTo(7, 9);
  });

  it("freezes when paused", () => {
    const anchor = { mediaTime: 30, ctxTime: 0, rate: 1, running: false };
    expect(projectMediaTime(anchor, 999)).toBe(30);
  });

  it("never projects backward before the anchor", () => {
    const anchor = { mediaTime: 5, ctxTime: 10, rate: 1, running: true };
    // ctxNow < ctxTime (clock skew) -> clamp elapsed at 0
    expect(projectMediaTime(anchor, 9)).toBe(5);
  });
});
