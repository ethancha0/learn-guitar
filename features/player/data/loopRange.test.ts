import { describe, expect, it } from "vitest";
import {
  barAtTick,
  barRangeToTicks,
  barTickRangesFromLookup,
  clampBarRange,
  ticksToBarRange,
  type BarTickRange,
} from "./loopRange";

/** Four 4/4 bars at 960 ticks per quarter. */
const BARS: BarTickRange[] = [
  { barNumber: 1, startTick: 0, endTick: 3840 },
  { barNumber: 2, startTick: 3840, endTick: 7680 },
  { barNumber: 3, startTick: 7680, endTick: 11520 },
  { barNumber: 4, startTick: 11520, endTick: 15360 },
];

const lookupBar = (index: number, start: number, end: number) => ({
  start,
  end,
  masterBar: { index },
});

describe("barTickRangesFromLookup", () => {
  it("converts alphaTab's lookup to 1-based bar numbers", () => {
    expect(
      barTickRangesFromLookup([
        lookupBar(0, 0, 3840),
        lookupBar(1, 3840, 7680),
      ]),
    ).toEqual([
      { barNumber: 1, startTick: 0, endTick: 3840 },
      { barNumber: 2, startTick: 3840, endTick: 7680 },
    ]);
  });

  it("keeps the first pass of a repeated bar", () => {
    // Playback order for |: bar1 bar2 :| — bar 1 and 2 are each played twice.
    const ranges = barTickRangesFromLookup([
      lookupBar(0, 0, 3840),
      lookupBar(1, 3840, 7680),
      lookupBar(0, 7680, 11520),
      lookupBar(1, 11520, 15360),
    ]);
    expect(ranges).toHaveLength(2);
    expect(ranges[0].startTick).toBe(0);
    expect(ranges[1].startTick).toBe(3840);
  });

  it("tolerates a missing lookup", () => {
    expect(barTickRangesFromLookup(undefined)).toEqual([]);
    expect(barTickRangesFromLookup([])).toEqual([]);
  });
});

describe("barAtTick", () => {
  it("finds the bar containing a tick", () => {
    expect(barAtTick(BARS, 0)).toBe(1);
    expect(barAtTick(BARS, 3839)).toBe(1);
    expect(barAtTick(BARS, 3840)).toBe(2);
    expect(barAtTick(BARS, 9000)).toBe(3);
  });

  it("clamps past the end of the score", () => {
    expect(barAtTick(BARS, 999999)).toBe(4);
    expect(barAtTick([], 0)).toBeNull();
  });
});

describe("clampBarRange", () => {
  it("keeps the range inside the score", () => {
    expect(clampBarRange(BARS, { startBar: -3, endBar: 99 })).toEqual({
      startBar: 1,
      endBar: 4,
    });
  });

  it("orders a backwards range", () => {
    expect(clampBarRange(BARS, { startBar: 4, endBar: 2 })).toEqual({
      startBar: 2,
      endBar: 4,
    });
  });
});

describe("barRangeToTicks", () => {
  it("spans from the first bar's start to the last bar's end", () => {
    expect(barRangeToTicks(BARS, { startBar: 2, endBar: 3 })).toEqual({
      startTick: 3840,
      endTick: 11520,
    });
  });

  it("plays a single bar in full", () => {
    expect(barRangeToTicks(BARS, { startBar: 4, endBar: 4 })).toEqual({
      startTick: 11520,
      endTick: 15360,
    });
  });
});

describe("ticksToBarRange", () => {
  it("round-trips a range built from bars", () => {
    const ticks = barRangeToTicks(BARS, { startBar: 2, endBar: 3 })!;
    expect(ticksToBarRange(BARS, ticks)).toEqual({ startBar: 2, endBar: 3 });
  });

  it("resolves alphaTab's drag selection, which stops short of the boundary", () => {
    // alphaTab subtracts 50 ticks from the end of the selected bar.
    expect(
      ticksToBarRange(BARS, { startTick: 3840, endTick: 11520 - 50 }),
    ).toEqual({ startBar: 2, endBar: 3 });
  });

  it("is null without a range", () => {
    expect(ticksToBarRange(BARS, null)).toBeNull();
    expect(ticksToBarRange([], { startTick: 0, endTick: 10 })).toBeNull();
  });
});
