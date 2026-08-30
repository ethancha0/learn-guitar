import { describe, expect, it } from "vitest";
import { buildPlaybackSyncMap } from "./buildSyncMap";
import { toAlphaTabBarSyncPoints } from "./syncMap";
import type { StoredSyncMap } from "@/features/library/data/songStore";

describe("buildPlaybackSyncMap", () => {
  const stored: StoredSyncMap = {
    points: [
      { scoreTime: 0, audioTime: 0 },
      { scoreTime: 100, audioTime: 101 },
    ],
    anchors: [{ scoreTime: 50, audioTime: 51 }],
    method: "dtw:mrmsdtw",
    status: "ok",
    createdAt: Date.now(),
  };

  it("applies anchors and sanitizes DTW maps", () => {
    const result = buildPlaybackSyncMap({
      stored,
      offsetMs: 0,
      scoreEndSec: 100,
      audioDurationSec: 105,
    });
    expect(result.syncSource).toBe("dtw");
    expect(result.syncMap).not.toBeNull();
    expect(result.syncMap!.scoreTimeToAudioTime(50)).toBeCloseTo(51, 3);
  });

  /**
   * The bug this guards: fixing the last few notes in the sync debugger left
   * playback untouched. The anchors were applied to the map but the player fed
   * alphaTab a bar-downbeat resampling of it, so any mid-bar correction was
   * dropped on the way in.
   */
  it("carries end-of-song anchors all the way into alphaTab's points", () => {
    const points = [];
    for (let s = 0; s <= 260; s += 1.8) points.push({ scoreTime: s, audioTime: s });
    const bars = [];
    for (let i = 0; i * 1.8 <= 260; i++) {
      bars.push({ barIndex: i, startSec: i * 1.8, occurence: 0 });
    }

    // Three consecutive notes hand-corrected near the end, all inside one bar.
    const anchors = [
      { scoreTime: 257.4, audioTime: 257.9 },
      { scoreTime: 257.8, audioTime: 258.24 },
      { scoreTime: 258.1, audioTime: 258.59 },
    ];

    const built = buildPlaybackSyncMap({
      stored: {
        points,
        anchors,
        method: "dtw:mrmsdtw",
        status: "ok",
        createdAt: Date.now(),
      },
      offsetMs: 0,
      scoreEndSec: 261,
      audioDurationSec: 261.5,
    });

    expect(built.syncSource).toBe("dtw");
    const flat = toAlphaTabBarSyncPoints(built.syncMap!, {
      bars,
      endSec: 261,
    });

    for (const a of anchors) {
      expect(built.syncMap!.scoreTimeToAudioTime(a.scoreTime)).toBeCloseTo(
        a.audioTime,
        6,
      );
      const wanted = Math.round(a.audioTime * 1000);
      expect(flat.some((p) => Math.abs(p.millisecondOffset - wanted) <= 1)).toBe(
        true,
      );
    }
  });

  it("falls back to offset when points are invalid", () => {
    const bad: StoredSyncMap = {
      ...stored,
      points: [{ scoreTime: 0, audioTime: 10 }],
    };
    const result = buildPlaybackSyncMap({
      stored: bad,
      offsetMs: 200,
      scoreEndSec: 100,
      audioDurationSec: 105,
    });
    expect(result.syncSource).toBe("offset");
  });
});
