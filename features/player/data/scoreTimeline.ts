"use client";

/**
 * GP bytes → bar / beat markers on the score timeline (seconds), for the
 * sync-debug page. Uses alphaTab's MIDI generator (pure computation, no DOM /
 * worker) so the bar + tempo model matches playback exactly — the same logic as
 * `align/gp-to-midi.mjs`.
 */

export interface BarMarker {
  /**
   * The bar's index *in the score*. This is what alphaTab's sync points address
   * — NOT the position in playback order, which runs past the end of
   * `score.masterBars` as soon as the song has a repeat.
   */
  barIndex: number;
  /** 0 on the first pass through this bar, 1 on the first repeat, and so on. */
  occurence: number;
  /** Position in playback order, repeats expanded. */
  playbackIndex: number;
  scoreTimeSec: number;
  /** Beats in the bar (time-signature numerator), for optional beat markers. */
  beats: number;
}

export interface ScoreTimeline {
  title: string;
  tempo: number;
  bars: BarMarker[];
  /** True when playback expands repeats, i.e. some bar is played more than once. */
  hasRepeats: boolean;
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

  // `gen.tickLookup.masterBars` is in PLAYBACK order with repeats expanded, so
  // `i` is not the bar's index in the score. Carry the real one (and which pass
  // we are on) — alphaTab drops any sync point whose barIndex is past the end of
  // `score.masterBars`, which silently unsyncs everything after the first repeat.
  const occurences = new Map<number, number>();

  for (let i = 0; i < masterBars.length; i++) {
    const b = masterBars[i];
    const mb = b.masterBar ?? score.masterBars[i];
    const barIndex = mb?.index ?? i;
    const occurence = occurences.get(barIndex) ?? 0;
    occurences.set(barIndex, occurence + 1);
    const numerator = mb?.timeSignatureNumerator ?? 4;
    const denominator = mb?.timeSignatureDenominator ?? 4;
    bars.push({
      barIndex,
      occurence,
      playbackIndex: i,
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
    hasRepeats: masterBars.length > score.masterBars.length,
    endSec: ms / 1000,
    beatSec,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trackNames: score.tracks.map(
      (t: { name?: string; shortName?: string }, i: number) =>
        t.name || t.shortName || `Track ${i + 1}`,
    ),
  };
}
