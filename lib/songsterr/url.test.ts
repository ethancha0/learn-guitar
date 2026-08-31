import { describe, expect, it } from "vitest";
import { parseSongsterrUrl } from "./url";
import { SongsterrError } from "./types";

describe("parseSongsterrUrl", () => {
  it("reads the song id out of a slug URL", () => {
    expect(
      parseSongsterrUrl("https://www.songsterr.com/a/wsa/nirvana-come-as-you-are-tab-s14"),
    ).toEqual({ songId: 14, trackIndex: undefined, revisionId: undefined });
  });

  it("reads the track index when the link points at one track", () => {
    expect(
      parseSongsterrUrl("https://www.songsterr.com/a/wsa/nirvana-come-as-you-are-tab-s14t6"),
    ).toMatchObject({ songId: 14, trackIndex: 6 });
  });

  it("keeps track index 0 rather than dropping it as falsy", () => {
    expect(
      parseSongsterrUrl("https://www.songsterr.com/a/wsa/x-tab-s14t0"),
    ).toMatchObject({ songId: 14, trackIndex: 0 });
  });

  it("pins an explicit revision", () => {
    expect(
      parseSongsterrUrl("https://www.songsterr.com/a/wsa/x-tab-s14?revision=8611143"),
    ).toMatchObject({ songId: 14, revisionId: 8611143 });
  });

  it("supports the legacy query form", () => {
    expect(parseSongsterrUrl("https://www.songsterr.com/a/wa/song?id=14&track=6")).toMatchObject({
      songId: 14,
      trackIndex: 6,
    });
  });

  it("accepts a bare song id", () => {
    expect(parseSongsterrUrl("14")).toEqual({ songId: 14 });
  });

  it("accepts a host-only URL without a scheme", () => {
    expect(parseSongsterrUrl("songsterr.com/a/wsa/x-tab-s14")).toMatchObject({ songId: 14 });
  });

  it("rejects other hosts", () => {
    expect(() => parseSongsterrUrl("https://ultimate-guitar.com/x-tab-s14")).toThrow(
      SongsterrError,
    );
  });

  it("rejects a songsterr URL with no id in the slug", () => {
    expect(() => parseSongsterrUrl("https://www.songsterr.com/a/wsa/browse")).toThrow(
      SongsterrError,
    );
  });

  it("rejects empty input", () => {
    expect(() => parseSongsterrUrl("   ")).toThrow(SongsterrError);
  });
});
