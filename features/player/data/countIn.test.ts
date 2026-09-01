import { describe, expect, it } from "vitest";
import { buildCountInPlan } from "./countIn";

/** 8 quarter-note beats at 120 BPM (0.5 s each) = two 4/4 bars. */
const BEATS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
const BAR_STARTS = [0, 2];

describe("buildCountInPlan", () => {
  it("counts the bar leading into a mid-song start", () => {
    const plan = buildCountInPlan({
      beatSec: BEATS,
      barStartSec: BAR_STARTS,
      startScoreSec: 2,
      beats: 4,
    })!;
    expect(plan.clicks.map((c) => c.leadSec)).toEqual([2, 1.5, 1, 0.5]);
    expect(plan.durationSec).toBe(2);
    // Beat 0 is the previous bar's downbeat.
    expect(plan.clicks.map((c) => c.accent)).toEqual([true, false, false, false]);
  });

  it("extrapolates backwards when starting at the top of the song", () => {
    const plan = buildCountInPlan({
      beatSec: BEATS,
      barStartSec: BAR_STARTS,
      startScoreSec: 0,
      beats: 4,
    })!;
    expect(plan.clicks.map((c) => c.leadSec)).toEqual([2, 1.5, 1, 0.5]);
    // Nothing before the score can be a known downbeat, so the "1" is implied.
    expect(plan.clicks.map((c) => c.accent)).toEqual([true, false, false, false]);
  });

  it("counts at the recording's tempo, not the score's", () => {
    // The recording runs at half the score's speed.
    const plan = buildCountInPlan({
      beatSec: BEATS,
      startScoreSec: 2,
      beats: 4,
      toAudioTime: (t) => t * 2,
    })!;
    expect(plan.clicks.map((c) => c.leadSec)).toEqual([4, 3, 2, 1]);
  });

  it("stretches the count-in when playing back slowly", () => {
    // Lead times are wall-clock: at 0.5× the same four recording beats take
    // twice as long to play, so the count-in has to last twice as long too.
    const plan = buildCountInPlan({
      beatSec: BEATS,
      startScoreSec: 2,
      beats: 4,
      playbackRate: 0.5,
    })!;
    expect(plan.clicks.map((c) => c.leadSec)).toEqual([4, 3, 2, 1]);
  });

  it("honours an odd time signature", () => {
    const plan = buildCountInPlan({
      beatSec: BEATS,
      startScoreSec: 3.5,
      beats: 3,
    })!;
    expect(plan.clicks.map((c) => c.leadSec)).toEqual([1.5, 1, 0.5]);
  });

  it("gives up rather than counting in for ever", () => {
    // A degenerate tempo grid: one beat every minute.
    expect(
      buildCountInPlan({
        beatSec: [0, 60, 120],
        startScoreSec: 120,
        beats: 4,
      }),
    ).toBeNull();
  });

  it("is null without a beat grid", () => {
    expect(
      buildCountInPlan({ beatSec: [], startScoreSec: 0, beats: 4 }),
    ).toBeNull();
  });
});
