import { describe, expect, it } from "vitest";
import * as alphaTab from "@coderline/alphatab";
import { convertRevisionToGp7 } from "./gp7";
import { fetchRevisionParts, resolveRevisionMeta } from "./revision";

describe("live songsterr download", () => {
  it("converts a real song", { timeout: 60_000 }, async () => {
    const { meta } = await resolveRevisionMeta(
      "https://www.songsterr.com/a/wsa/nirvana-come-as-you-are-tab-s14",
    );
    console.log("meta", {
      songId: meta.songId,
      revisionId: meta.revisionId,
      image: meta.image,
      title: meta.title,
      artist: meta.artist,
      tracks: meta.tracks.length,
    });

    const { parts, warnings: fetchWarnings } = await fetchRevisionParts(meta);
    console.log("parts fetched", parts.length, "fetch warnings", fetchWarnings.length);

    const { data, warnings } = convertRevisionToGp7({ meta, parts });
    console.log("gp bytes", data.byteLength, "convert warnings", warnings.length);
    console.log("warning sample", warnings.slice(0, 5));

    const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(
      data,
      new alphaTab.Settings(),
    );
    console.log("reimported", {
      title: score.title,
      artist: score.artist,
      tracks: score.tracks.length,
      masterBars: score.masterBars.length,
      tempo: score.tempo,
    });
    for (const track of score.tracks) {
      const staff = track.staves[0];
      let notes = 0;
      for (const bar of staff.bars) {
        for (const voice of bar.voices) {
          for (const beat of voice.beats) notes += beat.notes.length;
        }
      }
      console.log(
        `  track ${track.index}: "${track.name}" strings=${staff.stringTuning.tunings.length}` +
          ` percussion=${staff.isPercussion} channel=${track.playbackInfo.primaryChannel}` +
          ` program=${track.playbackInfo.program} bars=${staff.bars.length} notes=${notes}`,
      );
    }

    expect(data.byteLength).toBeGreaterThan(1000);
  });
});
