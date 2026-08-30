"use client";

/**
 * GP bytes → bar / beat markers on the score timeline (seconds), for the
 * sync-debug page. Uses alphaTab's MIDI generator (pure computation, no DOM /
 * worker) so the bar + tempo model matches playback exactly — the same logic as
 * `align/gp-to-midi.mjs`.
 */

export interface BarMarker {
  barIndex: number;
  scoreTimeSec: number;
  /** Beats in the bar (time-signature numerator), for optional beat markers. */
  beats: number;
}

export interface ScoreTimeline {
  title: string;
  tempo: number;
  bars: BarMarker[];
  endSec: number;
  /** Every beat across the song, seconds — bar downbeats included. */
  beatSec: number[];
  trackNames: string[];
}

export async function extractScoreTimeline(
  gpBytes: Uint8Array,
): Promise<ScoreTimeline> {
  const alphaTab = await import("@coderline/alphatab");
  const settings = new alphaTab.Settings();

  let score;
  try {
    score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(gpBytes, settings);
  } catch (err) {
    if (err instanceof alphaTab.importer.UnsupportedFormatError) {
      throw new Error("Unsupported or corrupt Guitar Pro file.");
    }
    throw new Error(`Could not parse Guitar Pro file: ${(err as Error).message}`);
  }
  if (!score || score.masterBars.length === 0) {
    throw new Error("Score has no bars.");
  }

  const midi = new alphaTab.midi.MidiFile();
  const gen = new alphaTab.midi.MidiFileGenerator(
    score,
    settings,
    new alphaTab.midi.AlphaSynthMidiFileHandler(midi),
  );
  gen.generate();

  const division = midi.division; // ticks per quarter note
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const masterBars: any[] = gen.tickLookup.masterBars;

  let ms = 0;
  const bars: BarMarker[] = [];
  const beatSec: number[] = [];
  // A bar with no tempo change inherits the tempo still in force, NOT the
  // score's opening tempo — otherwise every bar after a tempo change is timed
  // wrongly and the error accumulates toward the end of the song.
  let activeTempo = score.tempo;

  for (let i = 0; i < masterBars.length; i++) {
    const b = masterBars[i];
    const mb = score.masterBars[i];
    const numerator = mb?.timeSignatureNumerator ?? 4;
    const denominator = mb?.timeSignatureDenominator ?? 4;
    bars.push({
      barIndex: i,
      scoreTimeSec: ms / 1000,
      beats: numerator,
    });

    const changes =
      b.tempoChanges && b.tempoChanges.length
        ? b.tempoChanges
        : [{ tick: b.start, tempo: activeTempo }];

    // Beat grid within the bar (quarter-note beats scaled by the denominator).
    const barStartMs = ms;
    const beatTicks = (division * 4) / denominator;
    for (let beat = 0; beat < numerator; beat++) {
      const tickInBar = b.start + beat * beatTicks;
      // tempo active at this tick
      let tempo = changes[0].tempo;
      for (const c of changes) if (c.tick <= tickInBar) tempo = c.tempo;
      const beatMsFromBarStart =
        ((tickInBar - b.start) / division) * (60000 / tempo);
      beatSec.push((barStartMs + beatMsFromBarStart) / 1000);
    }

    // Advance the clock across the bar's tempo segments.
    let segStart = b.start;
    for (let j = 0; j < changes.length; j++) {
      const segEnd = j + 1 < changes.length ? changes[j + 1].tick : b.end;
      const beats = (segEnd - segStart) / division;
      ms += beats * (60000 / changes[j].tempo);
      segStart = segEnd;
      activeTempo = changes[j].tempo;
    }
  }

  return {
    title: score.title ?? "",
    tempo: score.tempo,
    bars,
    endSec: ms / 1000,
    beatSec,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trackNames: score.tracks.map(
      (t: { name?: string; shortName?: string }, i: number) =>
        t.name || t.shortName || `Track ${i + 1}`,
    ),
  };
}
