import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlignmentRequest } from "./alignmentQueue";
import type { StoredSyncMap } from "@/features/library/data/songStore";

/**
 * The queue reaches Supabase to save maps and to watch for one CI is solving.
 * Neither belongs in these tests, so the module is stubbed for the whole file
 * and the dispatch test drives `fetchSyncMapFromAccount` directly.
 */
const fetchSyncMapFromAccount = vi.fn<() => Promise<StoredSyncMap | null>>();
vi.mock("@/features/library/data/supabaseSongStore", () => ({
  fetchSyncMapFromAccount: () => fetchSyncMapFromAccount(),
  saveSyncMapToAccount: async () => undefined,
  useSupabaseSongs: () => [],
}));

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

/**
 * Stands in for the align endpoint. `GET /api/align` is the capability probe
 * and answers at once; the alignment run itself is gated so a test can hold it
 * open and assert on the in-flight state.
 */
function mockAlignEndpoint(
  body: Record<string, unknown>,
  capability: { mode: string; message?: string } = { mode: "local" },
) {
  const calls: Array<{ release: () => void; url: string }> = [];
  const fetchMock = vi.fn(async (input: unknown, init?: { method?: string }) => {
    if (!init?.method || init.method === "GET") {
      return { ok: true, json: async () => capability } as unknown as Response;
    }
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    calls.push({ release, url: String(input) });
    await gate;
    return {
      ok: true,
      status: 202,
      json: async () => body,
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

/** Only the align run, ignoring the capability probe that precedes it. */
function alignCalls(fetchMock: { mock: { calls: unknown[][] } }) {
  return fetchMock.mock.calls.filter(
    (c) => (c[1] as { method?: string } | undefined)?.method,
  );
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
    fetchSyncMapFromAccount.mockReset();
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

  /**
   * This used to assert the opposite: in production the queue returned `null`
   * without asking anyone. That is precisely what made a misconfigured
   * deployment indistinguishable from a working one — no request, no error, no
   * map. The server is asked now, and its reason is reported.
   */
  it("reports the server's reason when alignment is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { queue, songStore } = await load();
    mockAlignEndpoint(OK_RESPONSE, {
      mode: "unavailable",
      message: "Set ALIGN_GITHUB_REPO to align by GitHub Action.",
    });

    expect(await queue.queueAlignment(request("song"))).toMatchObject({
      state: "failed",
      message: "Set ALIGN_GITHUB_REPO to align by GitHub Action.",
    });
    // Not left `pending`, which would hold the player behind its overlay.
    expect(songStore.getAudioSync("song")?.dtwStatus).toBe("failed");
  });

  it("hands off to CI and installs the map the run writes", async () => {
    vi.useFakeTimers();
    try {
      const { queue, songStore } = await load();
      const { calls, fetchMock } = mockAlignEndpoint(
        { status: "queued" },
        { mode: "dispatch" },
      );
      const remote: StoredSyncMap = {
        points: OK_RESPONSE.points,
        method: "dtw:mrmsdtw",
        status: "ok",
        createdAt: Date.now(),
      };
      // Nothing there on the first look; the run lands before the second.
      fetchSyncMapFromAccount
        .mockResolvedValueOnce(null)
        .mockResolvedValue(remote);

      const done = queue.queueAlignment(request("song"));

      // The dispatch POST carries the id only — never the recording, which
      // would not fit through a serverless request body.
      await vi.waitFor(() => expect(alignCalls(fetchMock)).toHaveLength(1));
      const [url, init] = alignCalls(fetchMock)[0] as [string, { body: string }];
      expect(url).toBe("/api/align/dispatch");
      expect(JSON.parse(init.body)).toEqual({ songId: "song" });
      calls[0].release();

      // Queued, not pending: a multi-minute CI run must not block playback.
      await vi.waitFor(() =>
        expect(songStore.getAudioSync("song")?.dtwStatus).toBe("queued"),
      );

      await vi.advanceTimersByTimeAsync(25_000);
      expect(await done).toMatchObject({ state: "done" });
      expect(songStore.getAudioSync("song")?.syncMap?.points).toHaveLength(2);
      expect(songStore.getAudioSync("song")?.dtwStatus).toBe("ready");
    } finally {
      vi.useRealTimers();
    }
  });
});
