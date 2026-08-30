/**
 * GP → MIDI + bar timeline, using the SAME alphaTab parser the player uses so
 * the bar / tempo / repeat model matches exactly.
 *
 *   node align/gp-to-midi.mjs <score.gp> <outDir>
 *
 * Writes:
 *   <outDir>/score.mid    SMF 1.0 of the full arrangement (all tracks)
 *   <outDir>/bars.json    { bars: [{ barIndex, startSec }], endSec, tempo, trackCount }
 *
 * The MIDI is the DTW *reference*: render it to audio (align.py) and align that
 * against the recording. `bars.json` lets the sync map be converted to alphaTab
 * `FlatSyncPoint`s (barIndex + 0..1 position).
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
const division = midi.division; // ticks per quarter note
const masterBars = gen.tickLookup.masterBars;
let ms = 0;
const bars = [];
// A bar with no tempo change inherits the tempo still in force — matches
// scoreTimeline.ts / extractScoreTimeline() in the browser player.
let activeTempo = score.tempo;
for (let i = 0; i < masterBars.length; i++) {
  const b = masterBars[i];
  bars.push({ barIndex: i, startSec: Number((ms / 1000).toFixed(6)) });
  const changes =
    b.tempoChanges && b.tempoChanges.length
      ? b.tempoChanges
      : [{ tick: b.start, tempo: activeTempo }];
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
      endSec: Number((ms / 1000).toFixed(6)),
      tempo: score.tempo,
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
    endSec: Number((ms / 1000).toFixed(3)),
  }),
);
