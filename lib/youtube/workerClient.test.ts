import { afterEach, describe, expect, it, vi } from "vitest";
import { workerDownload, workerSearch } from "./workerClient";
import { type YouTubeAudioMeta, YouTubeToolError } from "./types";

const CONFIG = { baseUrl: "https://worker.example.com", token: "secret" };

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy as unknown as typeof fetch);
  return spy;
}

function metaHeader(meta: YouTubeAudioMeta) {
  return Buffer.from(JSON.stringify(meta), "utf8").toString("base64");
}

const META: YouTubeAudioMeta = {
  videoId: "dQw4w9WgXcQ",
  title: "Song",
  uploader: "Channel",
  durationSec: 212,
  fileName: "Song-dQw4w9WgXcQ.m4a",
  extension: "m4a",
  contentType: "audio/mp4",
  sizeBytes: 999,
  metadata: { durationSec: 212, codec: "aac" },
};

describe("workerSearch", () => {
  it("sends the bearer token and returns results", async () => {
    const spy = stubFetch(() =>
      Response.json({ results: [{ videoId: "dQw4w9WgXcQ", title: "Song" }] }),
    );

    const results = await workerSearch(CONFIG, "song", { maxResults: 3 });

    expect(results).toHaveLength(1);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://worker.example.com/search?q=song&maxResults=3");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
  });

  it("passes through a worker error code the app knows how to render", async () => {
    stubFetch(() =>
      Response.json({ error: "IP blocked.", code: "BOT_CHECK" }, { status: 502 }),
    );

    await expect(workerSearch(CONFIG, "song")).rejects.toMatchObject({
      code: "BOT_CHECK",
      message: "IP blocked.",
    });
  });

  it("reports an auth failure as a configuration problem", async () => {
    stubFetch(() => Response.json({ error: "nope" }, { status: 401 }));

    await expect(workerSearch(CONFIG, "song")).rejects.toThrow(
      /YOUTUBE_WORKER_TOKEN/,
    );
  });

  it("wraps an unreachable worker", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));

    await expect(workerSearch(CONFIG, "song")).rejects.toMatchObject({
      code: "WORKER_UNAVAILABLE",
    });
  });

  it("maps an unknown worker code to WORKER_UNAVAILABLE", async () => {
    stubFetch(() =>
      Response.json({ error: "boom", code: "SOMETHING_NEW" }, { status: 500 }),
    );

    await expect(workerSearch(CONFIG, "song")).rejects.toMatchObject({
      code: "WORKER_UNAVAILABLE",
    });
  });
});

describe("workerDownload", () => {
  it("decodes the metadata header and keeps the bytes in memory", async () => {
    const body = Buffer.from("fake-audio-bytes");
    stubFetch(
      () =>
        new Response(new Uint8Array(body), {
          headers: {
            "Content-Type": META.contentType,
            "X-Audio-Metadata": metaHeader(META),
          },
        }),
    );

    const audio = await workerDownload(CONFIG, "dQw4w9WgXcQ");

    expect(audio.title).toBe("Song");
    expect(audio.fileName).toBe("Song-dQw4w9WgXcQ.m4a");
    expect(audio.bytes?.equals(body)).toBe(true);
    // The transferred length wins over the worker's pre-stream estimate.
    expect(audio.sizeBytes).toBe(body.byteLength);
    expect(audio.path).toBeUndefined();
    await expect(audio.cleanup()).resolves.toBeUndefined();
  });

  it("fails loudly when the metadata header is missing", async () => {
    stubFetch(() => new Response(new Uint8Array([1, 2, 3])));

    await expect(workerDownload(CONFIG, "dQw4w9WgXcQ")).rejects.toThrow(
      YouTubeToolError,
    );
  });
});
