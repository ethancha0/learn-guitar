import { describe, expect, it } from "vitest";
import {
  REEL_DURATION_MS,
  REEL_SLOW_SPEED,
  REEL_STEPS,
  SWEEP_DURATION_MS,
  SWEEP_END_PCT,
  SWEEP_SLOWS_AT_PCT,
  SWEEP_START_PCT,
  stageDurationMs,
  stepDurationMs,
  stepStartMs,
  sweepTimeMs,
} from "./reelScript";
import {
  REEL_BARS_PCT,
  REEL_NOTES,
  REEL_SPEED_TO_PCT,
} from "./reelFixtures";

describe("the running order", () => {
  it("meets the brief: a five-to-eight second loop", () => {
    expect(REEL_DURATION_MS).toBeGreaterThanOrEqual(5000);
    expect(REEL_DURATION_MS).toBeLessThanOrEqual(8000);
  });

  it("opens each step where the one before it ended", () => {
    expect(REEL_STEPS.map((_, index) => stepStartMs(index))).toEqual([
      0,
      REEL_STEPS[0].durationMs,
      REEL_STEPS[0].durationMs + REEL_STEPS[1].durationMs,
    ]);
    expect(stepStartMs(REEL_STEPS.length)).toBe(REEL_DURATION_MS);
  });

  it("holds the player stage across both of the steps set on it", () => {
    expect(stageDurationMs("player")).toBe(
      stepDurationMs("play") + stepDurationMs("mix"),
    );
    expect(stageDurationMs("library") + stageDurationMs("player")).toBe(
      REEL_DURATION_MS,
    );
  });

  it("gives every step long enough to be read", () => {
    for (const step of REEL_STEPS) {
      expect(step.durationMs).toBeGreaterThanOrEqual(1500);
    }
  });
});

describe("sweepTimeMs", () => {
  it("starts the playhead at zero and lands it as the stage ends", () => {
    expect(sweepTimeMs(SWEEP_START_PCT)).toBe(0);
    expect(sweepTimeMs(SWEEP_END_PCT)).toBeCloseTo(SWEEP_DURATION_MS, 6);
  });

  it("changes gear exactly when the mixer opens", () => {
    expect(sweepTimeMs(SWEEP_SLOWS_AT_PCT)).toBeCloseTo(
      stepDurationMs("play"),
      6,
    );
    expect(SWEEP_SLOWS_AT_PCT).toBeGreaterThan(SWEEP_START_PCT);
    expect(SWEEP_SLOWS_AT_PCT).toBeLessThan(SWEEP_END_PCT);
  });

  it("crosses the second leg slower, by the speed the mixer shows", () => {
    const span = 4;
    const before =
      span / (sweepTimeMs(SWEEP_SLOWS_AT_PCT) - sweepTimeMs(SWEEP_SLOWS_AT_PCT - span));
    const after =
      span / (sweepTimeMs(SWEEP_SLOWS_AT_PCT + span) - sweepTimeMs(SWEEP_SLOWS_AT_PCT));
    expect(after / before).toBeCloseTo(REEL_SLOW_SPEED, 6);
    expect(REEL_SPEED_TO_PCT).toBe(REEL_SLOW_SPEED * 100);
  });

  it("rises monotonically and clamps outside the staff", () => {
    expect(sweepTimeMs(SWEEP_START_PCT - 20)).toBe(0);
    expect(sweepTimeMs(SWEEP_END_PCT + 20)).toBeCloseTo(SWEEP_DURATION_MS, 6);

    let previous = -1;
    for (let x = SWEEP_START_PCT; x <= SWEEP_END_PCT; x += 0.5) {
      const at = sweepTimeMs(x);
      expect(at).toBeGreaterThan(previous);
      previous = at;
    }
  });
});

describe("the engraved score", () => {
  it("lights every note while the stage is still on screen", () => {
    for (const note of REEL_NOTES) {
      expect(note.xPct).toBeGreaterThanOrEqual(SWEEP_START_PCT);
      expect(note.xPct).toBeLessThanOrEqual(SWEEP_END_PCT);
      expect(sweepTimeMs(note.xPct)).toBeLessThan(SWEEP_DURATION_MS);
    }
  });

  it("lays the bars end to end across the whole staff", () => {
    expect(REEL_BARS_PCT[0][0]).toBe(SWEEP_START_PCT);
    expect(REEL_BARS_PCT[REEL_BARS_PCT.length - 1][1]).toBe(SWEEP_END_PCT);
    for (let i = 1; i < REEL_BARS_PCT.length; i += 1) {
      expect(REEL_BARS_PCT[i][0]).toBe(REEL_BARS_PCT[i - 1][1]);
    }
  });

  it("puts every note inside a bar", () => {
    for (const note of REEL_NOTES) {
      const bar = REEL_BARS_PCT.find(
        ([start, end]) => note.xPct > start && note.xPct < end,
      );
      expect(bar, `no bar holds the note at ${note.xPct}%`).toBeDefined();
    }
  });
});
