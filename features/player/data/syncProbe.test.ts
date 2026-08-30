import { describe, expect, it } from "vitest";
import { SyncMap } from "./syncMap";
import { probeSyncMap } from "./syncProbe";

describe("probeSyncMap", () => {
  it("flags a linear fallback as linear", () => {
    const map = SyncMap.fromOffset(1.2, 200, 205);
    const r = probeSyncMap(map, {
      source: "offset",
      scoreDurationSec: 200,
      audioDurationSec: 205,
    });
    expect(r.rows).toHaveLength(5);
    expect(r.looksLinear).toBe(false); // fromOffset has a real tempo ratio
    expect(r.warnings.join(" ")).toMatch(/Linear offset fallback/);
  });

  it("reports a constant lag for a pure 1:1 offset", () => {
    const map = SyncMap.fromConstantOffset(1.21, 300);
    const r = probeSyncMap(map, {
      source: "offset",
      scoreDurationSec: 200,
      audioDurationSec: 202,
    });
    for (const row of r.rows) expect(row.lagSec).toBeCloseTo(1.21, 3);
    expect(r.lagSpreadSec).toBeLessThan(0.01);
    expect(r.looksLinear).toBe(true);
  });

  it("shows a moving lag for a nonlinear DTW map", () => {
    const map = SyncMap.fromPoints(
      [
        { scoreTime: 0, audioTime: 1.21 },
        { scoreTime: 60, audioTime: 61.05 },
        { scoreTime: 120, audioTime: 120.63 },
        { scoreTime: 180, audioTime: 180.22 },
      ],
      { method: "dtw:mrmsdtw" },
    );
    const r = probeSyncMap(map, {
      source: "dtw",
      scoreDurationSec: 180,
      audioDurationSec: 185,
    });
    expect(r.method).toBe("dtw:mrmsdtw");
    expect(r.lagSpreadSec).toBeGreaterThan(0.5);
    expect(r.looksLinear).toBe(false);
  });

  it("warns when a DTW map is suspiciously linear", () => {
    const map = SyncMap.fromPoints(
      [
        { scoreTime: 0, audioTime: 1 },
        { scoreTime: 100, audioTime: 101 },
        { scoreTime: 200, audioTime: 201 },
      ],
      { method: "dtw:mrmsdtw" },
    );
    const r = probeSyncMap(map, {
      source: "dtw",
      scoreDurationSec: 200,
      audioDurationSec: 205,
    });
    expect(r.warnings.join(" ")).toMatch(/effectively linear/);
  });

  it("catches the end-of-song failure: score end mapping past the recording", () => {
    // Score is 200 s but the map pushes its end to 210 s of a 205 s recording.
    const map = SyncMap.fromPoints([
      { scoreTime: 0, audioTime: 5 },
      { scoreTime: 200, audioTime: 210 },
    ]);
    const r = probeSyncMap(map, {
      source: "dtw",
      scoreDurationSec: 200,
      audioDurationSec: 205,
    });
    expect(r.warnings.join(" ")).toMatch(/audio will finish before the cursor/);
  });

  it("flags a sudden tempo-ratio jump", () => {
    const map = SyncMap.fromPoints([
      { scoreTime: 0, audioTime: 0 },
      { scoreTime: 100, audioTime: 100 }, // 1.0x
      { scoreTime: 200, audioTime: 260 }, // 1.6x
    ]);
    const r = probeSyncMap(map, {
      source: "dtw",
      scoreDurationSec: 200,
      audioDurationSec: 300,
    });
    expect(r.warnings.join(" ")).toMatch(/Sudden tempo-ratio jump/);
  });
});
