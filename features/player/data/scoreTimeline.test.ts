import { describe, expect, it } from "vitest";
import { extractScoreTimeline } from "./scoreTimeline";

/**
 * Build GP-equivalent bytes is overkill here — alphaTex exercises the same
 * importer + MidiFileGenerator path that `extractScoreTimeline` walks.
 */
async function texScore(tex: string): Promise<Uint8Array> {
  const alphaTab = await import("@coderline/alphatab");
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(tex, new alphaTab.Settings());
  const score = importer.readScore();
  return alphaTab.exporter.Gp7Exporter
    ? new alphaTab.exporter.Gp7Exporter().export(score, new alphaTab.Settings())
    : new Uint8Array();
}

const REPEATED = `\\title "rep"
.
\\ro 3.3.4 3.3.4 3.3.4 3.3.4 | 5.3.4 5.3.4 5.3.4 5.3.4 \\rc 2 |
7.3.4 7.3.4 7.3.4 7.3.4 |`;

describe("extractScoreTimeline with repeats", () => {
  it("expands repeats but keeps bar indices addressable by alphaTab", async () => {
    const bytes = await texScore(REPEATED);
    const tl = await extractScoreTimeline(bytes);

    // 4 written bars, 7 played (bars 0-2 twice).
    expect(tl.hasRepeats).toBe(true);
    expect(tl.bars.length).toBe(7);

    // alphaTab drops any sync point whose barIndex >= score.masterBars.length,
    // so every emitted index must stay inside the written score.
    const scoreBarCount = 4;
    for (const b of tl.bars) {
      expect(b.barIndex).toBeLessThan(scoreBarCount);
      expect(b.barIndex).toBeGreaterThanOrEqual(0);
    }

    expect(tl.bars.map((b) => b.barIndex)).toEqual([0, 1, 2, 0, 1, 2, 3]);
    expect(tl.bars.map((b) => b.occurence)).toEqual([0, 0, 0, 1, 1, 1, 0]);
    expect(tl.bars.map((b) => b.playbackIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);

    // Score time still advances monotonically through the expansion.
    for (let i = 1; i < tl.bars.length; i++) {
      expect(tl.bars[i].scoreTimeSec).toBeGreaterThan(tl.bars[i - 1].scoreTimeSec);
    }
  });
});
