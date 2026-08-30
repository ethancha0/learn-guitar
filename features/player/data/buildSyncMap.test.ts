import { describe, expect, it } from "vitest";
import { buildPlaybackSyncMap } from "./buildSyncMap";
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
