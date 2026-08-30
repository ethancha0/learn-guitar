/**
 * GP → MIDI + bar timeline, using the SAME alphaTab parser the player uses so
 * the bar / tempo / repeat model matches exactly.
 *
 *   node align/gp-to-midi.mjs <score.gp> <outDir>
 *
 * Writes:
 *   <outDir>/score.mid    SMF 1.0 of the full arrangement (all tracks)
 *   <outDir>/bars.json    { bars: [{ barIndex, occurence, playbackIndex, startSec, beats }],
 *                           beats: [sec], endSec, tempo, trackCount }
 *
 * The MIDI is the DTW *reference*: render it to audio (align.py) and align that
 * against the recording. `bars.json` lets the sync map be converted to alphaTab
 * `FlatSyncPoint`s (barIndex + 0..1 position), and its `beats` grid is what
 * `align.py` resamples the warping path onto — bar downbeats alone are ~1.4 s
 * apart on a fast song, which is far coarser than the path's own resolution.
 */
import * as at from "@coderline/alphatab";
import fs from "node:fs";
import path from "node:path";

function fail(msg) {
  console.error(JSON.stringify({ status: "failed", stage: "gp-to-midi", message: msg }));
  process.exit(1);
}

const [, , gpPath, outDir] = process.argv;
if (!gpPath || !outDir) fail("usage: gp-to-midi.mjs <score.gp> <outDir>");
if (!fs.existsSync(gpPath)) fail(`no such file: ${gpPath}`);
fs.mkdirSync(outDir, { recursive: true });

let score;
try {
  const bytes = new Uint8Array(fs.readFileSync(gpPath));
  score = at.importer.ScoreLoader.loadScoreFromBytes(bytes, new at.Settings());
} catch (err) {
  if (err instanceof at.importer.UnsupportedFormatError) {
    fail("unsupported or corrupt Guitar Pro file");
  }
  fail(`could not parse Guitar Pro file: ${err?.message ?? err}`);
}
if (!score || score.masterBars.length === 0) fail("score has no bars");

const settings = new at.Settings();
const midi = new at.midi.MidiFile();
let gen;
try {
  gen = new at.midi.MidiFileGenerator(
    score,
    settings,
    new at.midi.AlphaSynthMidiFileHandler(midi),
  );
  gen.generate();
} catch (err) {
  fail(`MIDI generation failed: ${err?.message ?? err}`);
}

// alphaTab emits MIDI 2.0 per-note pitch bends for bends/vibrato; SMF 1.0 can't
// hold them and the reference render doesn't need micro-pitch anyway.
const drop = [at.midi.NoteBendEvent, at.midi.Midi20PerNotePitchBendEvent].filter(
  Boolean,
);
for (const track of midi.tracks) {
  for (let i = track.events.length - 1; i >= 0; i--) {
    if (drop.some((C) => track.events[i] instanceof C)) {
      track.events.splice(i, 1);
    }
  }
}

let binary;
try {
  binary = midi.toBinary();
} catch (err) {
  fail(`MIDI serialization failed: ${err?.message ?? err}`);
}
fs.writeFileSync(path.join(outDir, "score.mid"), Buffer.from(binary));

// Bar start times (seconds) from the tick lookup, integrating tempo per bar.
// Mirrors extractScoreTimeline() in features/player/data/scoreTimeline.ts — the
// two must agree or the offline map lands on different score times than the
// browser samples it at.
const division = midi.division; // ticks per quarter note
const masterBars = gen.tickLookup.masterBars;
let ms = 0;
const bars = [];
const beatSec = [];
// A bar with no tempo change inherits the tempo still in force — matches
// scoreTimeline.ts / extractScoreTimeline() in the browser player.
let activeTempo = score.tempo;
// `tickLookup.masterBars` is in PLAYBACK order with repeats expanded, so `i` is
// not the bar's index in the score. alphaTab addresses sync points by
// (score barIndex, occurence), so carry both.
const occurences = new Map();
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
    startSec: Number((ms / 1000).toFixed(6)),
    beats: numerator,
  });

  const changes =
    b.tempoChanges && b.tempoChanges.length
      ? b.tempoChanges
      : [{ tick: b.start, tempo: activeTempo }];

  // Beat grid inside the bar (quarter-note beats scaled by the denominator).
  const barStartMs = ms;
  const beatTicks = (division * 4) / denominator;
  for (let beat = 0; beat < numerator; beat++) {
    const tickInBar = b.start + beat * beatTicks;
    let tempo = changes[0].tempo;
    for (const c of changes) if (c.tick <= tickInBar) tempo = c.tempo;
    const beatMsFromBarStart = ((tickInBar - b.start) / division) * (60000 / tempo);
    beatSec.push(Number(((barStartMs + beatMsFromBarStart) / 1000).toFixed(6)));
  }

  let segStart = b.start;
  for (let j = 0; j < changes.length; j++) {
    const segEnd = j + 1 < changes.length ? changes[j + 1].tick : b.end;
    const beats = (segEnd - segStart) / division;
    ms += beats * (60000 / changes[j].tempo);
    segStart = segEnd;
    activeTempo = changes[j].tempo;
  }
}

fs.writeFileSync(
  path.join(outDir, "bars.json"),
  JSON.stringify(
    {
      bars,
      beats: beatSec,
      endSec: Number((ms / 1000).toFixed(6)),
      tempo: score.tempo,
      hasRepeats: masterBars.length > score.masterBars.length,
      trackCount: score.tracks.length,
      title: score.title ?? "",
    },
    null,
    2,
  ),
);

console.log(
  JSON.stringify({
    status: "ok",
    midi: path.join(outDir, "score.mid"),
    bars: path.join(outDir, "bars.json"),
    barCount: bars.length,
    beatCount: beatSec.length,
    endSec: Number((ms / 1000).toFixed(3)),
  }),
);
