import { describe, expect, it } from "vitest";
import { collectVideoRenderers, parseLengthText, textFrom } from "./innertube";
import { validateYouTubeVideoIdOrUrl } from "./metadata";
import { YouTubeToolError } from "./types";

describe("validateYouTubeVideoIdOrUrl", () => {
  it("accepts bare video IDs", () => {
    expect(validateYouTubeVideoIdOrUrl("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts watch, short, and embed URLs", () => {
    expect(
      validateYouTubeVideoIdOrUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toBe("dQw4w9WgXcQ");
    expect(
      validateYouTubeVideoIdOrUrl("https://youtu.be/dQw4w9WgXcQ"),
    ).toBe("dQw4w9WgXcQ");
    expect(
      validateYouTubeVideoIdOrUrl("https://www.youtube.com/embed/dQw4w9WgXcQ"),
    ).toBe("dQw4w9WgXcQ");
  });

  it("rejects playlists", () => {
    expect(() =>
      validateYouTubeVideoIdOrUrl(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123",
      ),
    ).toThrow(YouTubeToolError);
    expect(() =>
      validateYouTubeVideoIdOrUrl("https://www.youtube.com/playlist?list=PL123"),
    ).toThrow("Playlists are not supported yet.");
  });

  it("rejects non-YouTube URLs", () => {
    expect(() =>
      validateYouTubeVideoIdOrUrl("https://example.com/watch?v=dQw4w9WgXcQ"),
    ).toThrow("Only YouTube video URLs are supported.");
  });
});

describe("innertube helpers", () => {
  it("parses length strings", () => {
    expect(parseLengthText("3:45")).toBe(225);
    expect(parseLengthText("1:02:03")).toBe(3723);
    expect(parseLengthText("")).toBe(0);
  });

  it("reads title runs and walks videoRenderer nodes", () => {
    expect(textFrom({ runs: [{ text: "Hello" }, { text: " World" }] })).toBe(
      "Hello World",
    );
    const videos = collectVideoRenderers({
      contents: [
        { videoRenderer: { videoId: "dQw4w9WgXcQ", title: { simpleText: "A" } } },
        { item: { videoRenderer: { videoId: "xxxxxxxxxxx", title: { simpleText: "B" } } } },
      ],
    });
    expect(videos.map((video) => video.videoId)).toEqual([
      "dQw4w9WgXcQ",
      "xxxxxxxxxxx",
    ]);
  });
});
