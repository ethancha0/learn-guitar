import { afterEach, describe, expect, it } from "vitest";
import { resolveYouTubeProvider } from "./provider";
import { YouTubeToolError } from "./types";

const KEYS = [
  "YOUTUBE_WORKER_URL",
  "YOUTUBE_WORKER_TOKEN",
  "YOUTUBE_PROVIDER",
  "VERCEL",
] as const;

const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

function env(values: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const key of KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

describe("resolveYouTubeProvider", () => {
  it("uses local tools when nothing is configured", () => {
    env({});
    expect(resolveYouTubeProvider()).toEqual({ kind: "local" });
  });

  it("uses the worker when a URL is set, trimming trailing slashes", () => {
    env({
      YOUTUBE_WORKER_URL: "https://worker.example.com/",
      YOUTUBE_WORKER_TOKEN: "secret",
    });
    expect(resolveYouTubeProvider()).toEqual({
      kind: "worker",
      config: { baseUrl: "https://worker.example.com", token: "secret" },
    });
  });

  it("refuses to fall back to local tools on managed serverless", () => {
    env({ VERCEL: "1" });
    expect(() => resolveYouTubeProvider()).toThrow(YouTubeToolError);
    expect(() => resolveYouTubeProvider()).toThrow(/YOUTUBE_WORKER_URL/);
  });

  it("lets YOUTUBE_PROVIDER=local win over a configured worker", () => {
    env({
      YOUTUBE_PROVIDER: "local",
      YOUTUBE_WORKER_URL: "https://worker.example.com",
    });
    expect(resolveYouTubeProvider()).toEqual({ kind: "local" });
  });

  it("errors when YOUTUBE_PROVIDER=worker but no URL is set", () => {
    env({ YOUTUBE_PROVIDER: "worker" });
    expect(() => resolveYouTubeProvider()).toThrow(YouTubeToolError);
  });
});
