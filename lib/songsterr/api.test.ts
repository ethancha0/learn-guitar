import { afterEach, describe, expect, it, vi } from "vitest";
import { searchSongsterr } from "./api";

function mockJson(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => payload })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchSongsterr track normalisation", () => {
  it("falls back to the instrument when Songsterr sends an empty track name", async () => {
    mockJson([
      {
        songId: 1,
        title: "Yoru Ni Kakeru",
        artist: "Yoasobi",
        tracks: [{ name: "   ", instrument: "Electric Bass (finger)", instrumentId: 33 }],
      },
    ]);

    const [song] = await searchSongsterr("yoru ni kakeru");
    expect(song.tracks[0].name).toBe("Electric Bass (finger)");
  });

  it("classifies tracks by GM range, not by the sampled instrument label", async () => {
    mockJson([
      {
        songId: 1,
        title: "T",
        artist: "A",
        tracks: [
          { name: "Lead Vocals", instrument: "Tenor Sax", instrumentId: 66 },
          { name: "Bass", instrument: "Electric Bass (pick)", instrumentId: 34 },
          { name: "Drums", instrument: "Drums", instrumentId: 1024 },
        ],
      },
    ]);

    const [song] = await searchSongsterr("t");
    expect(song.tracks.map((t) => t.family)).toEqual(["vocals", "bass", "drums"]);
  });
});
