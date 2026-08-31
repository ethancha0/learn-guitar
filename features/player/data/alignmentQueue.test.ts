import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlignmentRequest } from "./alignmentQueue";

/**
 * The queue and the sync store are both module-level singletons, so every test
 * gets a fresh copy of both plus a throwaway `window`.
 */
async function load() {
  vi.resetModules();
  const store = new Map<string, string>();
  const win = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  Object.defineProperty(globalThis, "window", {
    value: win,
    configurable: true,
    writable: true,
  });
  return {
    queue: await import("./alignmentQueue"),
    songStore: await import("@/features/library/data/songStore"),
  };
}

function request(songId: string): AlignmentRequest {
  return {
    songId,
    gpBytes: new Uint8Array([1, 2, 3]),
    audioBlob: new Blob([new Uint8Array([4, 5, 6])], { type: "audio/mpeg" }),
  };
}

/** Stands in for `POST /api/align`; resolves when the test says so. */
function mockAlignEndpoint(body: Record<string, unknown>) {
  const calls: Array<{ release: () => void }> = [];
  const fetchMock = vi.fn(async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    calls.push({ release });
    await gate;
    return { ok: true, json: async () => body } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

const OK_RESPONSE = {
  status: "ok",
  method: "dtw:mrmsdtw",
  points: [
    { scoreTime: 0, audioTime: 0.5 },
    { scoreTime: 100, audioTime: 100.4 },
  ],
  scoreDurationSec: 100,
  recordingDurationSec: 101,
};

describe("queueAlignment", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("stores the returned mapping and clears the manual offset", async () => {
    const { queue, songStore } = await load();
    songStore.patchAudioSync("song", { offsetMs: 320 });
    const { calls } = mockAlignEndpoint(OK_RESPONSE);

    const done = queue.queueAlignment(request("song"));
    expect(songStore.getAudioSync("song")?.dtwStatus).toBe("pending");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    calls[0].release();

    expect(await done).toMatchObject({ state: "done" });
    const settings = songStore.getAudioSync("song");
    expect(settings?.offsetMs).toBe(0);
    expect(settings?.syncMap?.points).toHaveLength(2);
    expect(settings?.syncMap?.method).toBe("dtw:mrmsdtw");
    expect(settings?.dtwStatus).toBe("ready");
    // Durations come back from the aligner, which is the only party that knows
    // them for a song imported without ever opening the player.
    expect(settings?.syncMap?.scoreEndSec).toBe(100);
    expect(settings?.syncMap?.audioDurationSec).toBe(101);
  });

  it("skips a song that already has a usable map", async () => {
    const { queue, songStore } = await load();
    songStore.patchAudioSync("song", {
      offsetMs: 0,
      syncMap: {
        points: OK_RESPONSE.points,
        method: "dtw:mrmsdtw",
        status: "ok",
        createdAt: Date.now(),
      },
    });
    const { fetchMock } = mockAlignEndpoint(OK_RESPONSE);

    expect(await queue.queueAlignment(request("song"))).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not mark forced realignment as import-pending", async () => {
    const { queue, songStore } = await load();
    songStore.patchAudioSync("song", {
      offsetMs: 0,
      dtwStatus: "ready",
      syncMap: {
        points: OK_RESPONSE.points,
        method: "dtw:mrmsdtw",
        status: "ok",
        createdAt: Date.now(),
      },
    });
    const { calls } = mockAlignEndpoint(OK_RESPONSE);

    const done = queue.queueAlignment({ ...request("song"), force: true });
    expect(songStore.getAudioSync("song")?.dtwStatus).toBe("ready");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    calls[0].release();

    expect(await done).toMatchObject({ state: "done" });
    expect(songStore.getAudioSync("song")?.dtwStatus).toBe("ready");
  });

  it("ignores a second request for a song already in flight", async () => {
    const { queue } = await load();
    const { calls } = mockAlignEndpoint(OK_RESPONSE);

    const first = queue.queueAlignment(request("song"));
    expect(await queue.queueAlignment(request("song"))).toBeNull();

    await vi.waitFor(() => expect(calls).toHaveLength(1));
    calls[0].release();
    await first;
  });

  it("runs one song at a time", async () => {
    const { queue } = await load();
    const { calls } = mockAlignEndpoint(OK_RESPONSE);

    const first = queue.queueAlignment(request("a"));
    const second = queue.queueAlignment(request("b"));

    await vi.waitFor(() => expect(calls).toHaveLength(1));
    calls[0].release();
    await first;

    await vi.waitFor(() => expect(calls).toHaveLength(2));
    calls[1].release();
    await second;
  });

  it("reports failure without touching the stored settings", async () => {
    const { queue, songStore } = await load();
    songStore.patchAudioSync("song", { offsetMs: 120 });
    const { calls } = mockAlignEndpoint({
      status: "failed",
      message: "score and recording look like different songs",
    });

    const done = queue.queueAlignment(request("song"));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    calls[0].release();

    expect(await done).toMatchObject({
      state: "failed",
      message: "score and recording look like different songs",
    });
    expect(songStore.getAudioSync("song")?.offsetMs).toBe(120);
    expect(songStore.getAudioSync("song")?.syncMap).toBeUndefined();
    expect(songStore.getAudioSync("song")?.dtwStatus).toBe("failed");
  });

  it("does nothing in production, where /api/align is disabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { queue } = await load();
    const { fetchMock } = mockAlignEndpoint(OK_RESPONSE);

    expect(await queue.queueAlignment(request("song"))).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
