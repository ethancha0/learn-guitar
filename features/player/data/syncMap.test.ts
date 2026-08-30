import { describe, expect, it } from "vitest";
import {
  SyncMap,
  SyncMapError,
  toAlphaTabBarSyncPoints,
  toAlphaTabFlatSyncPoints,
  type SyncPoint,
} from "./syncMap";

describe("SyncMap interpolation", () => {
  const map = SyncMap.fromPoints([
    { scoreTime: 0, audioTime: 1 },
    { scoreTime: 10, audioTime: 11.5 },
  ]);

  it("maps exact sync points", () => {
    expect(map.scoreTimeToAudioTime(0)).toBeCloseTo(1, 9);
    expect(map.scoreTimeToAudioTime(10)).toBeCloseTo(11.5, 9);
  });

  it("linearly interpolates between points", () => {
    // slope = (11.5 - 1) / 10 = 1.05
    expect(map.scoreTimeToAudioTime(5)).toBeCloseTo(6.25, 9);
    expect(map.scoreTimeToAudioTime(2)).toBeCloseTo(3.1, 9);
  });

  it("uses different slopes per region for a nonlinear map", () => {
    const nl = SyncMap.fromPoints([
      { scoreTime: 0, audioTime: 0 },
      { scoreTime: 10, audioTime: 10 }, // slope 1.0
      { scoreTime: 20, audioTime: 22 }, // slope 1.2
      { scoreTime: 30, audioTime: 31 }, // slope 0.9
    ]);
    expect(nl.slopeAtScoreTime(5)).toBeCloseTo(1.0, 6);
    expect(nl.slopeAtScoreTime(15)).toBeCloseTo(1.2, 6);
    expect(nl.slopeAtScoreTime(25)).toBeCloseTo(0.9, 6);
    expect(nl.scoreTimeToAudioTime(15)).toBeCloseTo(16, 6);
  });
});

describe("SyncMap reverse mapping round-trips", () => {
  const map = SyncMap.fromPoints([
    { scoreTime: 0, audioTime: 1.284 },
    { scoreTime: 10, audioTime: 11.341 },
    { scoreTime: 20, audioTime: 21.428 },
    { scoreTime: 30, audioTime: 31.563 },
  ]);

  it("score -> audio -> score is approximately identity", () => {
    for (const s of [0, 3.7, 10, 14.2, 21.9, 30]) {
      const a = map.scoreTimeToAudioTime(s);
      const back = map.audioTimeToScoreTime(a);
      expect(back).toBeCloseTo(s, 6);
    }
  });

  it("audio -> score -> audio is approximately identity", () => {
    for (const a of [1.284, 6.5, 11.341, 18.0, 31.563]) {
      const s = map.audioTimeToScoreTime(a);
      const back = map.scoreTimeToAudioTime(s);
      expect(back).toBeCloseTo(a, 6);
    }
  });
});

describe("SyncMap monotonicity", () => {
  const map = SyncMap.fromPoints([
    { scoreTime: 0, audioTime: 2 },
    { scoreTime: 5, audioTime: 6 },
    { scoreTime: 12, audioTime: 12 }, // slope < 1
    { scoreTime: 40, audioTime: 60 }, // slope > 1
  ]);

  it("never moves backward on either axis", () => {
    let prevA = -Infinity;
    let prevS = -Infinity;
    for (let s = -5; s <= 50; s += 0.25) {
      const a = map.scoreTimeToAudioTime(s);
      expect(a).toBeGreaterThanOrEqual(prevA - 1e-9);
      prevA = a;
    }
    for (let a = 0; a <= 70; a += 0.25) {
      const s = map.audioTimeToScoreTime(a);
      expect(s).toBeGreaterThanOrEqual(prevS - 1e-9);
      prevS = s;
    }
  });

  it("forces a noisy path monotone via fromPoints", () => {
    const noisy: SyncPoint[] = [
      { scoreTime: 0, audioTime: 0 },
      { scoreTime: 1, audioTime: 1.2 },
      { scoreTime: 2, audioTime: 1.1 }, // small local dip
      { scoreTime: 3, audioTime: 2.0 },
    ];
    const m = SyncMap.fromPoints(noisy);
    let prev = -Infinity;
    for (const p of m.points) {
      expect(p.audioTime).toBeGreaterThan(prev);
      prev = p.audioTime;
    }
  });
});

describe("SyncMap boundary behaviour", () => {
  const map = SyncMap.fromPoints([
    { scoreTime: 10, audioTime: 12 },
    { scoreTime: 20, audioTime: 25 },
  ]);

  it("extrapolates before the first point with the first segment slope", () => {
    // slope 1.3; at scoreTime 5 -> 12 - 6.5 = 5.5
    expect(map.scoreTimeToAudioTime(5)).toBeCloseTo(5.5, 6);
  });

  it("clamps output to >= 0", () => {
    expect(map.scoreTimeToAudioTime(-100)).toBe(0);
  });

  it("extrapolates after the last point with the last segment slope", () => {
    // at scoreTime 30 -> 25 + 13 = 38
    expect(map.scoreTimeToAudioTime(30)).toBeCloseTo(38, 6);
  });

  it("hits endpoints exactly", () => {
    expect(map.scoreTimeToAudioTime(10)).toBeCloseTo(12, 9);
    expect(map.audioTimeToScoreTime(25)).toBeCloseTo(20, 9);
  });
});

describe("SyncMap invalid data", () => {
  it("rejects empty maps", () => {
    expect(() => SyncMap.fromPoints([])).toThrow(SyncMapError);
  });

  it("rejects a single point", () => {
    expect(() => SyncMap.fromPoints([{ scoreTime: 0, audioTime: 0 }])).toThrow(
      /at least 2/,
    );
  });

  it("rejects NaN / Infinity", () => {
    expect(() =>
      SyncMap.fromPoints([
        { scoreTime: 0, audioTime: 0 },
        { scoreTime: NaN, audioTime: 5 },
      ]),
    ).toThrow(/NaN/);
    expect(() =>
      SyncMap.fromPoints([
        { scoreTime: 0, audioTime: 0 },
        { scoreTime: 5, audioTime: Infinity },
      ]),
    ).toThrow(SyncMapError);
  });

  it("rejects a mostly-decreasing audio timeline", () => {
    expect(() =>
      SyncMap.fromPoints([
        { scoreTime: 0, audioTime: 100 },
        { scoreTime: 1, audioTime: 80 },
        { scoreTime: 2, audioTime: 60 },
        { scoreTime: 3, audioTime: 40 },
      ]),
    ).toThrow(/decreases/);
  });

  it("de-duplicates identical score timestamps rather than dividing by zero", () => {
    const m = SyncMap.fromPoints([
      { scoreTime: 0, audioTime: 0 },
      { scoreTime: 5, audioTime: 5 },
      { scoreTime: 5, audioTime: 6 },
      { scoreTime: 10, audioTime: 11 },
    ]);
    expect(Number.isFinite(m.scoreTimeToAudioTime(5))).toBe(true);
    expect(Number.isFinite(m.scoreTimeToAudioTime(7.5))).toBe(true);
  });
});

describe("SyncMap.fromOffset matches alphaTab single-anchor behaviour", () => {
  it("is a straight line from the lead-in to (just inside) the recording end", () => {
    const m = SyncMap.fromOffset(1.2, 200, 205);
    expect(m.scoreTimeToAudioTime(0)).toBeCloseTo(1.2, 9);
    // 5 ms short of the media duration on purpose: a terminal point sitting
    // exactly on `backingTrackDuration` makes alphaTab's tail branch divide 0/0.
    expect(m.scoreTimeToAudioTime(200)).toBeCloseTo(204.995, 6);
    expect(m.scoreTimeToAudioTime(200)).toBeLessThan(205);
    expect(m.slopeAtScoreTime(100)).toBeCloseTo(1.019, 3);
  });
});

describe("SyncMap.withAnchor", () => {
  it("passes through the anchor and stays monotone", () => {
    const base = SyncMap.fromPoints([
      { scoreTime: 0, audioTime: 0 },
      { scoreTime: 100, audioTime: 100 },
    ]);
    const corrected = base.withAnchor(50, 52);
    expect(corrected.scoreTimeToAudioTime(50)).toBeCloseTo(52, 6);
    let prev = -Infinity;
    for (let s = 0; s <= 100; s += 1) {
      const a = corrected.scoreTimeToAudioTime(s);
      expect(a).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = a;
    }
  });
});

describe("SyncMap.smoothed", () => {
  it("produces a monotone curve close to the input trend", () => {
    const pts: SyncPoint[] = [];
    for (let i = 0; i <= 60; i++) {
      // ~1.05x with +-30ms jitter
      pts.push({
        scoreTime: i,
        audioTime: i * 1.05 + (Math.sin(i * 7.13) * 0.03),
      });
    }
    const m = SyncMap.fromPoints(pts).smoothed();
    let prev = -Infinity;
    for (const p of m.points) {
      expect(p.audioTime).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = p.audioTime;
    }
    expect(m.scoreTimeToAudioTime(30)).toBeCloseTo(31.5, 1);
  });
});

describe("SyncMap.withTerminalAnchor (end-of-song regression)", () => {
  // alphaTab maps everything after the LAST sync point onto the score end using
  // `backingTrackDuration`. If the map stops early, that tail is at the mercy of
  // a possibly-wrong media duration — the cause of "mp3 ends before the cursor".
  it("extends the curve to the score end using the final local slope", () => {
    const map = SyncMap.fromPoints([
      { scoreTime: 0, audioTime: 1 },
      { scoreTime: 100, audioTime: 101 }, // slope 1.0
    ]).withTerminalAnchor(203.29);
    const last = map.points[map.points.length - 1];
    expect(last.scoreTime).toBeCloseTo(203.29, 6);
    expect(last.audioTime).toBeCloseTo(204.29, 6);
  });

  it("never extrapolates past the real recording duration", () => {
    const map = SyncMap.fromPoints([
      { scoreTime: 0, audioTime: 0 },
      { scoreTime: 100, audioTime: 120 }, // slope 1.2
    ]).withTerminalAnchor(200, 150);
    const last = map.points[map.points.length - 1];
    // clamped to just inside 150 (not the 240 the slope would imply)
    expect(last.audioTime).toBeGreaterThan(149.9);
    expect(last.audioTime).toBeLessThan(150);
    expect(last.scoreTime).toBeCloseTo(200, 6);
  });

  it("is a no-op when the map already reaches the end", () => {
    const base = SyncMap.fromPoints([
      { scoreTime: 0, audioTime: 1 },
      { scoreTime: 200, audioTime: 201 },
    ]);
    expect(base.withTerminalAnchor(200)).toBe(base);
    expect(base.withTerminalAnchor(199)).toBe(base);
  });

  it("keeps the result monotonic", () => {
    const map = SyncMap.fromPoints([
      { scoreTime: 0, audioTime: 2 },
      { scoreTime: 50, audioTime: 51 },
      { scoreTime: 90, audioTime: 95 },
    ]).withTerminalAnchor(140, 200);
    let prevS = -Infinity;
    let prevA = -Infinity;
    for (const p of map.points) {
      expect(p.scoreTime).toBeGreaterThan(prevS);
      expect(p.audioTime).toBeGreaterThan(prevA);
      prevS = p.scoreTime;
      prevA = p.audioTime;
    }
  });
});

describe("SyncMap.sanitize (reported end-of-song failure)", () => {
  /**
   * Reproduces the map from the diagnostics panel: a healthy body at ~+0.48s lag
   * (slope 1.0015) followed by a DTW end-effect that maps the score end to
   * 212.29s of a 205.5s recording.
   */
  function brokenMap() {
    const pts: SyncPoint[] = [];
    for (let s = 0; s <= 200; s += 5) {
      pts.push({ scoreTime: s, audioTime: s * 1.0015 + 0.48 });
    }
    pts.push({ scoreTime: 201.35, audioTime: 201.94 });
    pts.push({ scoreTime: 203.29, audioTime: 212.29 }); // slope ~5.3x
    return SyncMap.fromPoints(pts, { method: "dtw:mrmsdtw" });
  }

  it("maps past the end of the recording before repair", () => {
    expect(brokenMap().scoreTimeToAudioTime(203.29)).toBeCloseTo(212.29, 2);
  });

  it("brings the score end back inside the recording", () => {
    const { map } = brokenMap().sanitize({
      scoreEndSec: 203.29,
      audioDurationSec: 205.5,
    });
    const end = map.scoreTimeToAudioTime(203.29);
    expect(end).toBeLessThan(205.5);
    expect(end).toBeGreaterThan(203); // still lands near the end, not early
  });

  it("reports what it repaired", () => {
    const { repairs } = brokenMap().sanitize({
      scoreEndSec: 203.29,
      audioDurationSec: 205.5,
    });
    expect(repairs.join(" ")).toMatch(/end-effect|past the recording/);
  });

  it("leaves the healthy body untouched", () => {
    const { map } = brokenMap().sanitize({
      scoreEndSec: 203.29,
      audioDurationSec: 205.5,
    });
    for (const s of [50.82, 101.65, 152.47]) {
      expect(map.scoreTimeToAudioTime(s)).toBeCloseTo(s * 1.0015 + 0.48, 1);
    }
  });

  it("never maps any score position past the recording", () => {
    const { map } = brokenMap().sanitize({
      scoreEndSec: 203.29,
      audioDurationSec: 205.5,
    });
    for (let s = 0; s <= 203.29; s += 0.5) {
      expect(map.scoreTimeToAudioTime(s)).toBeLessThanOrEqual(205.5);
    }
  });

  it("is a no-op on an already-healthy map", () => {
    const good = SyncMap.fromPoints([
      { scoreTime: 0, audioTime: 0.48 },
      { scoreTime: 100, audioTime: 100.63 },
      { scoreTime: 203.29, audioTime: 203.79 },
    ]);
    const { map, repairs } = good.sanitize({
      scoreEndSec: 203.29,
      audioDurationSec: 205.5,
    });
    expect(repairs).toHaveLength(0);
    expect(map.points).toHaveLength(3);
  });

  it("does not mistake a real tempo change for an end-effect", () => {
    // 1.0x for the first half, 1.15x for the second — musical, not a defect.
    const pts: SyncPoint[] = [];
    for (let s = 0; s <= 100; s += 5) pts.push({ scoreTime: s, audioTime: s });
    for (let s = 105; s <= 200; s += 5) {
      pts.push({ scoreTime: s, audioTime: 100 + (s - 100) * 1.15 });
    }
    const { map, repairs } = SyncMap.fromPoints(pts).sanitize({
      scoreEndSec: 200,
      audioDurationSec: 260,
    });
    expect(repairs).toHaveLength(0);
    expect(map.slopeAtScoreTime(150)).toBeCloseTo(1.15, 2);
  });

  it("survives a map where everything is past the recording", () => {
    const { map, repairs } = SyncMap.fromPoints([
      { scoreTime: 0, audioTime: 500 },
      { scoreTime: 100, audioTime: 600 },
    ]).sanitize({ scoreEndSec: 100, audioDurationSec: 205.5 });
    expect(repairs.join(" ")).toMatch(/collapsed/);
    expect(Number.isFinite(map.scoreTimeToAudioTime(50))).toBe(true);
  });
});

describe("SyncMap.medianSlope", () => {
  it("ignores a single pathological segment", () => {
    const pts: SyncPoint[] = [];
    for (let s = 0; s <= 100; s += 5) pts.push({ scoreTime: s, audioTime: s * 1.02 });
    pts.push({ scoreTime: 101, audioTime: 130 }); // outlier
    expect(SyncMap.fromPoints(pts).medianSlope()).toBeCloseTo(1.02, 2);
  });
});

describe("SyncMap.simplify", () => {
  it("collapses a straight line to its endpoints", () => {
    const pts: SyncPoint[] = [];
    for (let i = 0; i <= 200; i++) {
      pts.push({ scoreTime: i, audioTime: 1 + i * 1.02 });
    }
    const simplified = SyncMap.fromPoints(pts).simplify(0.02);
    expect(simplified.points.length).toBe(2);
  });

  it("stays within tolerance of the original curve", () => {
    const pts: SyncPoint[] = [];
    for (let i = 0; i <= 240; i++) {
      // real tempo drift + small jitter
      const drift = i < 120 ? i * 1.0 : 120 + (i - 120) * 1.08;
      pts.push({ scoreTime: i, audioTime: 1 + drift + Math.sin(i * 5.1) * 0.01 });
    }
    const dense = SyncMap.fromPoints(pts);
    const simple = dense.simplify(0.02);
    expect(simple.points.length).toBeLessThan(pts.length / 4);
    for (let s = 0; s <= 240; s += 0.5) {
      const err = Math.abs(
        simple.scoreTimeToAudioTime(s) - dense.scoreTimeToAudioTime(s),
      );
      expect(err).toBeLessThanOrEqual(0.03);
    }
  });

  it("preserves a genuine tempo change rather than averaging it away", () => {
    const pts: SyncPoint[] = [];
    for (let i = 0; i <= 100; i++) pts.push({ scoreTime: i, audioTime: i });
    for (let i = 1; i <= 100; i++) {
      pts.push({ scoreTime: 100 + i, audioTime: 100 + i * 1.15 });
    }
    const simple = SyncMap.fromPoints(pts).simplify(0.02);
    // the elbow at score 100 must survive
    expect(simple.slopeAtScoreTime(50)).toBeCloseTo(1.0, 2);
    expect(simple.slopeAtScoreTime(150)).toBeCloseTo(1.15, 2);
  });

  it("keeps short maps untouched", () => {
    const m = SyncMap.fromPoints([
      { scoreTime: 0, audioTime: 0 },
      { scoreTime: 10, audioTime: 10 },
    ]);
    expect(m.simplify().points.length).toBe(2);
  });
});

describe("SyncMap.withAnchors", () => {
  it("applies several anchors and passes through each", () => {
    const map = SyncMap.fromPoints([
      { scoreTime: 0, audioTime: 0 },
      { scoreTime: 200, audioTime: 200 },
    ]).withAnchors([
      { scoreTime: 150, audioTime: 152.5 },
      { scoreTime: 82.14, audioTime: 83.72 },
    ]);
    expect(map.scoreTimeToAudioTime(82.14)).toBeCloseTo(83.72, 6);
    expect(map.scoreTimeToAudioTime(150)).toBeCloseTo(152.5, 6);
  });

  it("tags anchor points so later transforms can protect them", () => {
    const map = SyncMap.fromPoints([
      { scoreTime: 0, audioTime: 0 },
      { scoreTime: 100, audioTime: 100 },
    ]).withAnchor(50, 51);
    expect(map.anchorScoreTimes()).toEqual([50]);
  });

  it("re-fits the neighbourhood instead of spiking to the anchor and back", () => {
    // A dense automatic curve: leaving its points in place around the anchor
    // makes the map dive to the correction and jump straight back, which reads
    // as the cursor sprinting then crawling.
    const pts: SyncPoint[] = [];
    for (let s = 0; s <= 100; s += 0.5) pts.push({ scoreTime: s, audioTime: s });
    const map = SyncMap.fromPoints(pts).withAnchor(50, 50.4);

    expect(map.scoreTimeToAudioTime(50)).toBeCloseTo(50.4, 6);
    // No automatic vertex survives inside the window, so the slope either side
    // of the anchor is constant rather than alternating fast/slow.
    expect(map.slopeAtScoreTime(49)).toBeCloseTo(map.slopeAtScoreTime(49.5), 6);
    expect(map.slopeAtScoreTime(51)).toBeCloseTo(map.slopeAtScoreTime(51.5), 6);
    // ...and the curve is untouched well outside it.
    expect(map.scoreTimeToAudioTime(10)).toBeCloseTo(10, 6);
    expect(map.scoreTimeToAudioTime(90)).toBeCloseTo(90, 6);
  });

  it("never lets one anchor's window erase a neighbouring anchor", () => {
    // The real case: three consecutive notes corrected within a single bar.
    const pts: SyncPoint[] = [];
    for (let s = 0; s <= 300; s += 1.8) pts.push({ scoreTime: s, audioTime: s });
    const anchors = [
      { scoreTime: 257.54, audioTime: 257.9 },
      { scoreTime: 257.88, audioTime: 258.24 },
      { scoreTime: 258.23, audioTime: 258.59 },
    ];
    const map = SyncMap.fromPoints(pts).withAnchors(anchors);

    expect(map.anchorScoreTimes()).toHaveLength(3);
    for (const a of anchors) {
      expect(map.scoreTimeToAudioTime(a.scoreTime)).toBeCloseTo(a.audioTime, 6);
    }
  });
});

describe("manual anchors survive the road to playback", () => {
  // 4 bars of 4 s. The anchor deliberately sits mid-bar, which is where a
  // per-note correction lands and where bar-downbeat sampling used to lose it.
  const timeline = {
    bars: [
      { barIndex: 0, startSec: 0, occurence: 0 },
      { barIndex: 1, startSec: 4, occurence: 0 },
      { barIndex: 2, startSec: 8, occurence: 0 },
      { barIndex: 3, startSec: 12, occurence: 0 },
    ],
    endSec: 16,
  };

  const anchored = () => {
    const pts: SyncPoint[] = [];
    for (let s = 0; s <= 16; s += 1) pts.push({ scoreTime: s, audioTime: s });
    return SyncMap.fromPoints(pts).withAnchor(9.4, 10.15);
  };

  it("reaches alphaTab through the bar-level conversion", () => {
    const map = anchored();
    const pts = toAlphaTabBarSyncPoints(map, timeline);
    // Bar 2 spans 8..12s, so the anchor is at ratio (9.4 - 8) / 4 = 0.35.
    const hit = pts.find(
      (p) => p.barIndex === 2 && Math.abs(p.barPosition - 0.35) < 1e-6,
    );
    expect(hit).toBeDefined();
    expect(hit!.millisecondOffset).toBe(10150);
  });

  it("survives simplification on the offset path", () => {
    const map = anchored();
    const simplified = map.simplify(0.02);
    expect(simplified.scoreTimeToAudioTime(9.4)).toBeCloseTo(10.15, 6);

    const pts = toAlphaTabFlatSyncPoints(simplified, timeline);
    const hit = pts.find(
      (p) => p.barIndex === 2 && Math.abs(p.barPosition - 0.35) < 1e-6,
    );
    expect(hit?.millisecondOffset).toBe(10150);
  });

  it("keeps a correction smaller than the simplify tolerance", () => {
    const pts: SyncPoint[] = [];
    for (let s = 0; s <= 16; s += 1) pts.push({ scoreTime: s, audioTime: s });
    // 10 ms — half the 20 ms tolerance, so plain Douglas–Peucker would drop it.
    const map = SyncMap.fromPoints(pts).withAnchor(9.4, 9.41);
    expect(map.simplify(0.02).scoreTimeToAudioTime(9.4)).toBeCloseTo(9.41, 6);
  });

  it("honours caller-protected score times", () => {
    const pts: SyncPoint[] = [];
    for (let i = 0; i <= 200; i++) pts.push({ scoreTime: i, audioTime: i * 1.02 });
    const map = SyncMap.fromPoints(pts);
    const simplified = map.simplify(0.02, { protectedScoreTimes: [37] });
    expect(simplified.points.some((p) => p.scoreTime === 37)).toBe(true);
  });
});

describe("SyncMap.sanitize protects manual anchors", () => {
  it("does not trim an end-of-song anchor as a steep tail", () => {
    const pts: SyncPoint[] = [];
    for (let s = 0; s <= 250; s += 1) pts.push({ scoreTime: s, audioTime: s });
    // A late correction pushing audio on by 2 s over 0.2 s of score: a local
    // slope of 10 against a median of 1, which the tail trim used to eat.
    const map = SyncMap.fromPoints(pts).withAnchor(250.2, 252);
    const { map: clean } = map.sanitize({
      scoreEndSec: 251,
      audioDurationSec: 261,
    });
    expect(clean.anchorScoreTimes()).toContain(250.2);
    expect(clean.scoreTimeToAudioTime(250.2)).toBeCloseTo(252, 6);
  });

  it("keeps an anchor past an under-reported recording length and says so", () => {
    const pts: SyncPoint[] = [];
    for (let s = 0; s <= 250; s += 10) pts.push({ scoreTime: s, audioTime: s });
    const map = SyncMap.fromPoints(pts).withAnchor(255, 258);
    const { map: clean, repairs } = map.sanitize({
      scoreEndSec: 256,
      // The <audio> element under-reports: the anchor sits past this.
      audioDurationSec: 257,
    });
    expect(clean.scoreTimeToAudioTime(255)).toBeCloseTo(258, 6);
    expect(repairs.join(" ")).toMatch(/kept 1 manual anchor/);
  });

  it("still drops automatic points that run past the recording", () => {
    const map = SyncMap.fromPoints([
      { scoreTime: 0, audioTime: 0 },
      { scoreTime: 100, audioTime: 100 },
      { scoreTime: 110, audioTime: 400 },
    ]);
    const { map: clean } = map.sanitize({
      scoreEndSec: 110,
      audioDurationSec: 120,
    });
    expect(clean.audioDuration).toBeLessThanOrEqual(120);
  });
});

describe("toAlphaTabBarSyncPoints", () => {
  const timeline = {
    bars: [
      { barIndex: 0, startSec: 0 },
      { barIndex: 1, startSec: 4 },
      { barIndex: 2, startSec: 8 },
    ],
    endSec: 12,
  };

  it("emits one point per bar plus score end", () => {
    const map = SyncMap.fromPoints([
      { scoreTime: 0, audioTime: 0.5 },
      { scoreTime: 12, audioTime: 12.5 },
    ]);
    const pts = toAlphaTabBarSyncPoints(map, timeline);
    expect(pts.length).toBeGreaterThanOrEqual(3);
    expect(pts[0].millisecondOffset).toBe(500);
  });
});

describe("toAlphaTabBarSyncPoints with repeats", () => {
  // Two bars played twice: playback order is 0, 1, 0, 1. alphaTab drops any
  // sync point whose barIndex is past the end of `score.masterBars`, so
  // numbering these 0..3 silently unsynced the whole second pass — the cursor
  // then raced from the last surviving point to the end of the recording.
  const timeline = {
    bars: [
      { barIndex: 0, startSec: 0, occurence: 0 },
      { barIndex: 1, startSec: 4, occurence: 0 },
      { barIndex: 0, startSec: 8, occurence: 1 },
      { barIndex: 1, startSec: 12, occurence: 1 },
    ],
    endSec: 16,
  };

  it("addresses real score bars and tags each pass with its occurrence", () => {
    const map = SyncMap.fromPoints([
      { scoreTime: 0, audioTime: 0 },
      { scoreTime: 16, audioTime: 16 },
    ]);
    const pts = toAlphaTabBarSyncPoints(map, timeline);

    // Nothing may address a bar the score does not have.
    const scoreBarCount = 2;
    for (const p of pts) expect(p.barIndex).toBeLessThan(scoreBarCount);

    // Both passes are represented.
    expect(pts.some((p) => p.barOccurence === 0)).toBe(true);
    expect(pts.some((p) => p.barOccurence === 1)).toBe(true);

    // The second pass keeps its own timing rather than collapsing onto the first.
    const secondPass = pts.filter((p) => p.barOccurence === 1);
    expect(secondPass.length).toBeGreaterThan(0);
    expect(Math.min(...secondPass.map((p) => p.millisecondOffset))).toBeGreaterThanOrEqual(
      8000,
    );
  });

  it("keeps points ordered within each (barIndex, occurrence)", () => {
    const map = SyncMap.fromPoints([
      { scoreTime: 0, audioTime: 0 },
      { scoreTime: 16, audioTime: 16 },
    ]);
    const pts = toAlphaTabBarSyncPoints(map, timeline);
    const seen = new Map<string, number>();
    for (const p of pts) {
      const key = `${p.barIndex}:${p.barOccurence}`;
      const prev = seen.get(key);
      if (prev != null) expect(p.barPosition).toBeGreaterThan(prev);
      seen.set(key, p.barPosition);
    }
  });
});

describe("toAlphaTabFlatSyncPoints", () => {
  const timeline = {
    bars: [
      { barIndex: 0, startSec: 0 },
      { barIndex: 1, startSec: 2 },
      { barIndex: 2, startSec: 4 },
      { barIndex: 3, startSec: 6 },
    ],
    endSec: 8,
  };

  it("emits strictly increasing (barIndex, barPosition) points", () => {
    const map = SyncMap.fromPoints([
      { scoreTime: 0, audioTime: 1 },
      { scoreTime: 8, audioTime: 9.5 },
    ]);
    const flat = toAlphaTabFlatSyncPoints(map, timeline, 1);
    expect(flat.length).toBeGreaterThan(1);
    for (let i = 1; i < flat.length; i++) {
      const a = flat[i - 1];
      const b = flat[i];
      const aKey = a.barIndex + a.barPosition;
      const bKey = b.barIndex + b.barPosition;
      expect(bKey).toBeGreaterThan(aKey);
      expect(b.millisecondOffset).toBeGreaterThanOrEqual(a.millisecondOffset);
    }
  });

  it("places bar positions in [0, 1]", () => {
    const map = SyncMap.fromPoints([
      { scoreTime: 0, audioTime: 0 },
      { scoreTime: 8, audioTime: 8 },
    ]);
    for (const p of toAlphaTabFlatSyncPoints(map, timeline, 0.5)) {
      expect(p.barPosition).toBeGreaterThanOrEqual(0);
      expect(p.barPosition).toBeLessThanOrEqual(1);
    }
  });
});
