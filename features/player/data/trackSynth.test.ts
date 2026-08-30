import { describe, expect, it } from "vitest";
import { buildTempoMap, tickToSec } from "./trackSynth";

const DIVISION = 960; // ticks per quarter note (alphaTab default)

/** Minimal stand-in for alphaTab's MasterBarTickLookup entries. */
function bar(start: number, end: number, tempoChanges?: Array<{ tick: number; tempo: number }>) {
  return { start, end, tempoChanges: tempoChanges ?? [] };
}

describe("buildTempoMap / tickToSec", () => {
  it("converts ticks to seconds at a constant tempo", () => {
    // 120 BPM -> 0.5 s per quarter -> 2 s per 4/4 bar
    const segs = buildTempoMap(
      [bar(0, 3840), bar(3840, 7680)],
      { tempo: 120 },
      DIVISION,
    );
    expect(tickToSec(segs, 0)).toBeCloseTo(0, 9);
    expect(tickToSec(segs, DIVISION)).toBeCloseTo(0.5, 9);
    expect(tickToSec(segs, 3840)).toBeCloseTo(2, 9);
    expect(tickToSec(segs, 7680)).toBeCloseTo(4, 9);
  });

  it("matches the score tempo used elsewhere (170 BPM)", () => {
    // monster.gp: 170 BPM, 4/4 -> bar length 4 * 60/170 = 1.41176 s
    const segs = buildTempoMap([bar(0, 3840)], { tempo: 170 }, DIVISION);
    expect(tickToSec(segs, 3840)).toBeCloseTo(1.411765, 5);
  });

  it("honours a mid-bar tempo change", () => {
    // bar 0: 120 BPM for 2 beats, then 60 BPM for 2 beats
    const segs = buildTempoMap(
      [
        bar(0, 3840, [
          { tick: 0, tempo: 120 },
          { tick: 1920, tempo: 60 },
        ]),
      ],
      { tempo: 120 },
      DIVISION,
    );
    expect(tickToSec(segs, 1920)).toBeCloseTo(1.0, 9); // 2 beats @ 0.5s
    expect(tickToSec(segs, 3840)).toBeCloseTo(3.0, 9); // + 2 beats @ 1.0s
  });

  it("is monotonically increasing across tempo changes", () => {
    const segs = buildTempoMap(
      [
        bar(0, 3840, [{ tick: 0, tempo: 90 }]),
        bar(3840, 7680, [{ tick: 3840, tempo: 160 }]),
        bar(7680, 11520, [{ tick: 7680, tempo: 120 }]),
      ],
      { tempo: 90 },
      DIVISION,
    );
    let prev = -Infinity;
    for (let t = 0; t <= 11520; t += 120) {
      const s = tickToSec(segs, t);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it("clamps before the start and extrapolates past the end", () => {
    const segs = buildTempoMap([bar(0, 3840)], { tempo: 120 }, DIVISION);
    expect(tickToSec(segs, -500)).toBeCloseTo(0, 9);
    // one bar beyond the last segment, same tempo
    expect(tickToSec(segs, 7680)).toBeCloseTo(4, 9);
  });

  it("falls back to the score tempo when a bar has no tempo changes", () => {
    const segs = buildTempoMap([bar(0, 3840)], { tempo: 100 }, DIVISION);
    expect(segs).toHaveLength(1);
    expect(tickToSec(segs, 3840)).toBeCloseTo((4 * 60) / 100, 9);
  });

  it("returns 0 for an empty score", () => {
    expect(tickToSec([], 1000)).toBe(0);
  });
});
